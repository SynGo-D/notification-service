import { randomUUID } from "node:crypto";
import type {
    BatchResponse,
    Messaging,
    MulticastMessage,
    SendResponse,
} from "firebase-admin/messaging";
import type { DeviceTokenRepository } from "../repositories/DeviceTokenRepository.js";
import type { DeliveryReport, NotificationRequest } from "../types/notification.js";

const FCM_BATCH_SIZE = 500;
const INVALID_TOKEN_CODES = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
]);
const RETRYABLE_CODES = new Set([
    "messaging/internal-error",
    "messaging/server-unavailable",
    "messaging/unknown-error",
    "messaging/quota-exceeded",
]);

type MessagingClient = Pick<Messaging, "sendEachForMulticast">;
type Sleep = (milliseconds: number) => Promise<void>;

interface BatchDeliveryResult {
    sent: number;
    failed: number;
    invalidTokens: string[];
    errorCounts: Record<string, number>;
}

function mergeErrorCounts(target: Record<string, number>, source: Record<string, number>): void {
    for (const [code, count] of Object.entries(source)) {
        target[code] = (target[code] ?? 0) + count;
    }
}

function errorCode(response: SendResponse): string {
    return response.error?.code ?? "messaging/unknown-error";
}

export class NotificationService {
    constructor(
        private readonly repository: DeviceTokenRepository,
        private readonly messaging: MessagingClient,
        private readonly maxAttempts = 3,
        private readonly sleep: Sleep = (milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ) {}

    async sendToUser(request: NotificationRequest): Promise<DeliveryReport> {
        const notificationId = request.notificationId ?? randomUUID();
        const tokens = [...new Set(await this.repository.findByUserId(request.userId))];

        if (tokens.length === 0) {
            return {
                notificationId,
                targeted: 0,
                sent: 0,
                failed: 0,
                removedInvalidTokens: 0,
                errorCounts: {},
            };
        }

        let sent = 0;
        let failed = 0;
        const invalidTokens: string[] = [];
        const errorCounts: Record<string, number> = {};

        for (let offset = 0; offset < tokens.length; offset += FCM_BATCH_SIZE) {
            const batchResult = await this.sendBatchWithRetry(
                tokens.slice(offset, offset + FCM_BATCH_SIZE),
                request,
                notificationId,
            );
            sent += batchResult.sent;
            failed += batchResult.failed;
            invalidTokens.push(...batchResult.invalidTokens);
            mergeErrorCounts(errorCounts, batchResult.errorCounts);
        }

        let removedInvalidTokens = 0;
        try {
            removedInvalidTokens = await this.repository.removeTokens(invalidTokens);
        } catch (error) {
            // Cleanup is secondary to delivery. Failing the whole operation
            // here would cause queue callers to resend notifications that FCM
            // already accepted.
            console.error("Could not remove invalid FCM device tokens:", error);
            errorCounts["internal/token-cleanup-failed"] = 1;
        }

        return {
            notificationId,
            targeted: tokens.length,
            sent,
            failed,
            removedInvalidTokens,
            errorCounts,
        };
    }

    private async sendBatchWithRetry(
        initialTokens: string[],
        request: NotificationRequest,
        notificationId: string,
    ): Promise<BatchDeliveryResult> {
        let pendingTokens = initialTokens;
        let sent = 0;
        let failed = 0;
        const invalidTokens: string[] = [];
        const errors: Record<string, number> = {};

        for (let attempt = 1; attempt <= this.maxAttempts && pendingTokens.length > 0; attempt += 1) {
            let response: BatchResponse;
            try {
                response = await this.messaging.sendEachForMulticast(
                    this.messageFor(pendingTokens, request, notificationId),
                );
            } catch (error) {
                if (attempt === this.maxAttempts) throw error;
                await this.sleep(100 * (2 ** (attempt - 1)));
                continue;
            }

            const retryTokens: string[] = [];
            response.responses.forEach((result, index) => {
                const token = pendingTokens[index];
                if (!token) return;

                if (result.success) {
                    sent += 1;
                    return;
                }

                const code = errorCode(result);
                if (INVALID_TOKEN_CODES.has(code)) {
                    invalidTokens.push(token);
                    failed += 1;
                    errors[code] = (errors[code] ?? 0) + 1;
                } else if (RETRYABLE_CODES.has(code) && attempt < this.maxAttempts) {
                    retryTokens.push(token);
                } else {
                    failed += 1;
                    errors[code] = (errors[code] ?? 0) + 1;
                }
            });

            pendingTokens = retryTokens;
            if (pendingTokens.length > 0) {
                await this.sleep(100 * (2 ** (attempt - 1)));
            }
        }

        return { sent, failed, invalidTokens, errorCounts: errors };
    }

    private messageFor(
        tokens: string[],
        request: NotificationRequest,
        notificationId: string,
    ): MulticastMessage {
        return {
            tokens,
            notification: {
                title: request.title,
                body: request.body,
            },
            data: {
                ...(request.data ?? {}),
                notificationId,
            },
            android: {
                priority: "high",
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                    },
                },
            },
        };
    }
}
