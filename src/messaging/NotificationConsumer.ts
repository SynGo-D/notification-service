import { randomUUID } from "node:crypto";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { ValidationError } from "../errors/ValidationError.js";
import type { NotificationService } from "../services/NotificationService.js";
import { parseNotificationRequest, type NotificationRequest } from "../types/notification.js";

const RETRY_HEADER = "x-notification-retry-count";

export class NotificationConsumer {
    private readonly deadLetterQueue: string;

    constructor(
        private readonly notificationService: NotificationService,
        private readonly queueName: string,
        private readonly prefetch: number,
        private readonly maxRetries: number,
    ) {
        this.deadLetterQueue = `${queueName}.dead`;
    }

    async start(channel: ConfirmChannel): Promise<void> {
        // No custom arguments are placed on notification_queue, preserving
        // compatibility with the existing RabbitMQ repository's declaration.
        await channel.assertQueue(this.queueName, { durable: true });
        await channel.assertQueue(this.deadLetterQueue, { durable: true });
        await channel.prefetch(this.prefetch);
        await channel.consume(this.queueName, (message) => {
            if (message) {
                void this.handle(channel, message).catch((error) => {
                    console.error("Unexpected RabbitMQ notification-consumer error:", error);
                    try {
                        channel.nack(message, false, true);
                    } catch {
                        // A closed channel automatically requeues an
                        // unacknowledged delivery on the broker.
                    }
                });
            }
        }, { noAck: false });
    }

    private async handle(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
        let request: NotificationRequest;
        try {
            const parsed = parseNotificationRequest(JSON.parse(message.content.toString("utf8")));
            request = {
                ...parsed,
                notificationId: parsed.notificationId ?? message.properties.messageId ?? randomUUID(),
            };
        } catch (error) {
            await this.moveToDeadLetter(
                channel,
                message,
                error instanceof ValidationError || error instanceof SyntaxError
                    ? "invalid-payload"
                    : "payload-processing-error",
            );
            return;
        }

        try {
            const result = await this.notificationService.sendToUser(request);
            if (result.failed > 0) {
                console.warn("Notification event completed with failed deliveries.", {
                    notificationId: result.notificationId,
                    targeted: result.targeted,
                    sent: result.sent,
                    failed: result.failed,
                    errorCounts: result.errorCounts,
                });
            }
            channel.ack(message);
        } catch (error) {
            const retryCount = this.retryCount(message);
            if (retryCount >= this.maxRetries) {
                console.error("Notification event exhausted RabbitMQ retries:", error);
                await this.moveToDeadLetter(channel, message, "delivery-failed");
                return;
            }

            const retryPayload: NotificationRequest = {
                ...request,
                // Consumers can use this stable value to de-duplicate an
                // at-least-once delivery if a broker retry follows an
                // ambiguous FCM network result.
                notificationId: request.notificationId,
            };
            const published = channel.sendToQueue(
                this.queueName,
                Buffer.from(JSON.stringify(retryPayload)),
                {
                    persistent: true,
                    contentType: "application/json",
                    messageId: message.properties.messageId,
                    headers: {
                        ...message.properties.headers,
                        [RETRY_HEADER]: retryCount + 1,
                    },
                },
            );
            if (!published) await new Promise((resolve) => channel.once("drain", resolve));
            await channel.waitForConfirms();
            channel.ack(message);
        }
    }

    private retryCount(message: ConsumeMessage): number {
        const rawValue = message.properties.headers?.[RETRY_HEADER];
        return typeof rawValue === "number" && Number.isInteger(rawValue) ? rawValue : 0;
    }

    private async moveToDeadLetter(
        channel: ConfirmChannel,
        message: ConsumeMessage,
        reason: string,
    ): Promise<void> {
        const published = channel.sendToQueue(this.deadLetterQueue, message.content, {
            persistent: true,
            contentType: message.properties.contentType ?? "application/json",
            messageId: message.properties.messageId,
            headers: {
                ...message.properties.headers,
                "x-dead-letter-reason": reason,
            },
        });
        if (!published) await new Promise((resolve) => channel.once("drain", resolve));
        await channel.waitForConfirms();
        channel.ack(message);
    }
}
