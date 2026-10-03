import { performance } from "node:perf_hooks";
import type { MulticastMessage } from "firebase-admin/messaging";
import { describe, expect, it, vi } from "vitest";
import type { DeviceTokenRepository } from "../src/repositories/DeviceTokenRepository.js";
import { NotificationService } from "../src/services/NotificationService.js";
import { parseNotificationRequest } from "../src/types/notification.js";

describe("notification performance safeguards", () => {
    it("batches 10,000 recipients within a regression budget", async () => {
        const tokens = Array.from({ length: 10_000 }, (_, index) => `token-${index}`);
        const repository: DeviceTokenRepository = {
            upsert: async () => undefined,
            remove: async () => false,
            findByUserId: async () => tokens,
            removeTokens: async () => 0,
        };
        const sendEachForMulticast = vi.fn(async (message: MulticastMessage) => ({
            successCount: message.tokens.length,
            failureCount: 0,
            responses: message.tokens.map((_, index) => ({
                success: true as const,
                messageId: `message-${index}`,
            })),
        }));
        const service = new NotificationService(repository, { sendEachForMulticast });
        const started = performance.now();

        const report = await service.sendToUser({ userId: "load-user", title: "Title", body: "Body" });
        const elapsed = performance.now() - started;

        expect(report).toMatchObject({ targeted: 10_000, sent: 10_000, failed: 0 });
        expect(sendEachForMulticast).toHaveBeenCalledTimes(20);
        expect(sendEachForMulticast.mock.calls.every(([batch]) => batch.tokens.length <= 500)).toBe(true);
        expect(elapsed).toBeLessThan(2_000);
    });

    it("validates 10,000 notification requests within a regression budget", () => {
        const started = performance.now();
        for (let index = 0; index < 10_000; index += 1) {
            parseNotificationRequest({
                userId: `user-${index}`,
                title: "Analysis complete",
                body: "Your report is ready.",
                data: { screen: "analysis", result: String(index) },
            });
        }
        expect(performance.now() - started).toBeLessThan(2_000);
    });
});
