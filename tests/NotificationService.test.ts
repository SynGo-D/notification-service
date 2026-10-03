import type { BatchResponse, MulticastMessage } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";
import type { DeviceTokenRepository } from "../src/repositories/DeviceTokenRepository.js";
import { NotificationService } from "../src/services/NotificationService.js";
import type { RegisterDeviceInput } from "../src/types/notification.js";

class MemoryDeviceTokenRepository implements DeviceTokenRepository {
    readonly removed: string[] = [];

    constructor(private readonly tokens: string[]) {}

    async upsert(_input: RegisterDeviceInput): Promise<void> {}
    async remove(_userId: string, _token: string): Promise<boolean> { return false; }
    async findByUserId(_userId: string): Promise<string[]> { return this.tokens; }
    async removeTokens(tokens: string[]): Promise<number> {
        this.removed.push(...tokens);
        return new Set(tokens).size;
    }
}

function allSuccessful(message: MulticastMessage): BatchResponse {
    return {
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map((_, index) => ({
            success: true,
            messageId: `message-${index}`,
        })),
    };
}

describe("NotificationService", () => {
    it("returns an empty delivery report when the user has no devices", async () => {
        const repository = new MemoryDeviceTokenRepository([]);
        const sendEachForMulticast = vi.fn();
        const service = new NotificationService(repository, { sendEachForMulticast });

        const report = await service.sendToUser({
            userId: "user-1",
            title: "Analysis complete",
            body: "Your report is ready.",
        });

        expect(report).toMatchObject({ targeted: 0, sent: 0, failed: 0 });
        expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    it("splits delivery into Firebase's 500-token batches", async () => {
        const repository = new MemoryDeviceTokenRepository(
            Array.from({ length: 501 }, (_, index) => `token-${index}`),
        );
        const sendEachForMulticast = vi.fn(async (message: MulticastMessage) => allSuccessful(message));
        const service = new NotificationService(repository, { sendEachForMulticast });

        const report = await service.sendToUser({
            userId: "user-1",
            title: "Analysis complete",
            body: "Your report is ready.",
            notificationId: "event-1",
        });

        expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
        expect(sendEachForMulticast.mock.calls[0]?.[0].tokens).toHaveLength(500);
        expect(sendEachForMulticast.mock.calls[1]?.[0].tokens).toHaveLength(1);
        expect(report).toMatchObject({ targeted: 501, sent: 501, failed: 0 });
    });

    it("removes invalid tokens and retries transient token failures", async () => {
        const repository = new MemoryDeviceTokenRepository(["valid", "expired", "retry"]);
        const sendEachForMulticast = vi.fn()
            .mockResolvedValueOnce({
                successCount: 1,
                failureCount: 2,
                responses: [
                    { success: true, messageId: "message-1" },
                    {
                        success: false,
                        error: { code: "messaging/registration-token-not-registered", message: "expired" },
                    },
                    {
                        success: false,
                        error: { code: "messaging/server-unavailable", message: "temporary" },
                    },
                ],
            })
            .mockResolvedValueOnce({
                successCount: 1,
                failureCount: 0,
                responses: [{ success: true, messageId: "message-2" }],
            });
        const sleep = vi.fn(async () => undefined);
        const service = new NotificationService(repository, { sendEachForMulticast }, 3, sleep);

        const report = await service.sendToUser({
            userId: "user-1",
            title: "Analysis complete",
            body: "Your report is ready.",
        });

        expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
        expect(sendEachForMulticast.mock.calls[1]?.[0].tokens).toEqual(["retry"]);
        expect(repository.removed).toEqual(["expired"]);
        expect(report).toMatchObject({
            targeted: 3,
            sent: 2,
            failed: 1,
            removedInvalidTokens: 1,
        });
    });

    it("adds a stable notification ID to the Firebase data payload", async () => {
        const repository = new MemoryDeviceTokenRepository(["token-1"]);
        const sendEachForMulticast = vi.fn(async (message: MulticastMessage) => allSuccessful(message));
        const service = new NotificationService(repository, { sendEachForMulticast });

        await service.sendToUser({
            userId: "user-1",
            title: "Analysis complete",
            body: "Your report is ready.",
            data: { screen: "analysis/42" },
            notificationId: "event-42",
        });

        expect(sendEachForMulticast.mock.calls[0]?.[0].data).toEqual({
            screen: "analysis/42",
            notificationId: "event-42",
        });
    });

    it("deduplicates device tokens before delivery", async () => {
        const repository = new MemoryDeviceTokenRepository(["same", "same", "other"]);
        const sendEachForMulticast = vi.fn(async (message: MulticastMessage) => allSuccessful(message));
        const service = new NotificationService(repository, { sendEachForMulticast });

        const report = await service.sendToUser({ userId: "user-1", title: "Title", body: "Body" });

        expect(sendEachForMulticast.mock.calls[0]?.[0].tokens).toEqual(["same", "other"]);
        expect(report).toMatchObject({ targeted: 2, sent: 2, failed: 0 });
    });

    it("reports non-retryable Firebase failures without retrying", async () => {
        const repository = new MemoryDeviceTokenRepository(["token-1"]);
        const sendEachForMulticast = vi.fn().mockResolvedValue({
            successCount: 0,
            failureCount: 1,
            responses: [{
                success: false,
                error: { code: "messaging/invalid-argument", message: "bad payload" },
            }],
        });
        const service = new NotificationService(repository, { sendEachForMulticast });

        const report = await service.sendToUser({ userId: "user-1", title: "Title", body: "Body" });

        expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
        expect(report).toMatchObject({ sent: 0, failed: 1 });
        expect(report.errorCounts).toEqual({ "messaging/invalid-argument": 1 });
    });

    it("uses exponential backoff and stops after the retry limit", async () => {
        const repository = new MemoryDeviceTokenRepository(["token-1"]);
        const sendEachForMulticast = vi.fn().mockResolvedValue({
            successCount: 0,
            failureCount: 1,
            responses: [{
                success: false,
                error: { code: "messaging/server-unavailable", message: "temporary" },
            }],
        });
        const sleep = vi.fn(async () => undefined);
        const service = new NotificationService(repository, { sendEachForMulticast }, 3, sleep);

        const report = await service.sendToUser({ userId: "user-1", title: "Title", body: "Body" });

        expect(sendEachForMulticast).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([100, 200]);
        expect(report.errorCounts).toEqual({ "messaging/server-unavailable": 1 });
        expect(report.failed).toBe(1);
    });

    it("retries transport errors and surfaces the final failure", async () => {
        const repository = new MemoryDeviceTokenRepository(["token-1"]);
        const sendEachForMulticast = vi.fn().mockRejectedValue(new Error("network unavailable"));
        const sleep = vi.fn(async () => undefined);
        const service = new NotificationService(repository, { sendEachForMulticast }, 2, sleep);

        await expect(service.sendToUser({ userId: "user-1", title: "Title", body: "Body" }))
            .rejects.toThrow("network unavailable");
        expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(100);
    });

    it("keeps a successful delivery report when invalid-token cleanup fails", async () => {
        const repository = new MemoryDeviceTokenRepository(["expired"]);
        repository.removeTokens = async () => { throw new Error("Firestore unavailable"); };
        const sendEachForMulticast = vi.fn().mockResolvedValue({
            successCount: 0,
            failureCount: 1,
            responses: [{
                success: false,
                error: { code: "messaging/registration-token-not-registered", message: "expired" },
            }],
        });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const report = await new NotificationService(repository, { sendEachForMulticast })
                .sendToUser({ userId: "user-1", title: "Title", body: "Body" });
            expect(report.removedInvalidTokens).toBe(0);
            expect(report.errorCounts["internal/token-cleanup-failed"]).toBe(1);
        } finally {
            consoleError.mockRestore();
        }
    });
});
