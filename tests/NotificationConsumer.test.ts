import type { ConfirmChannel, ConsumeMessage } from "amqplib";
import { describe, expect, it, vi } from "vitest";
import { NotificationConsumer } from "../src/messaging/NotificationConsumer.js";
import type { NotificationService } from "../src/services/NotificationService.js";

function message(body: string, retryCount?: number): ConsumeMessage {
    return {
        content: Buffer.from(body),
        fields: {} as ConsumeMessage["fields"],
        properties: {
            contentType: "application/json",
            messageId: "message-1",
            headers: retryCount === undefined ? {} : { "x-notification-retry-count": retryCount },
        } as ConsumeMessage["properties"],
    };
}

function channelFixture() {
    const channel = {
        assertQueue: vi.fn(async () => ({})),
        prefetch: vi.fn(async () => undefined),
        consume: vi.fn(async () => ({ consumerTag: "consumer-1" })),
        ack: vi.fn(),
        nack: vi.fn(),
        sendToQueue: vi.fn(() => true),
        waitForConfirms: vi.fn(async () => undefined),
        once: vi.fn(),
    } as unknown as ConfirmChannel;
    return channel;
}

function consumer(service: Pick<NotificationService, "sendToUser">, maxRetries = 2) {
    return new NotificationConsumer(service as NotificationService, "notification_queue", 10, maxRetries);
}

async function handle(instance: NotificationConsumer, channel: ConfirmChannel, input: ConsumeMessage) {
    await (instance as unknown as {
        handle(target: ConfirmChannel, value: ConsumeMessage): Promise<void>;
    }).handle(channel, input);
}

describe("NotificationConsumer", () => {
    it("declares durable queues and configures broker backpressure", async () => {
        const channel = channelFixture();
        const instance = consumer({ sendToUser: vi.fn() });

        await instance.start(channel);

        expect(channel.assertQueue).toHaveBeenNthCalledWith(1, "notification_queue", { durable: true });
        expect(channel.assertQueue).toHaveBeenNthCalledWith(2, "notification_queue.dead", { durable: true });
        expect(channel.prefetch).toHaveBeenCalledWith(10);
        expect(channel.consume).toHaveBeenCalledWith(
            "notification_queue",
            expect.any(Function),
            { noAck: false },
        );
    });

    it("acknowledges valid notifications after delivery", async () => {
        const channel = channelFixture();
        const sendToUser = vi.fn(async () => ({
            notificationId: "message-1", targeted: 1, sent: 1, failed: 0,
            removedInvalidTokens: 0, errorCounts: {},
        }));
        const input = message(JSON.stringify({ userId: "user-1", title: "Title", body: "Body" }));

        await handle(consumer({ sendToUser }), channel, input);

        expect(sendToUser).toHaveBeenCalledWith(expect.objectContaining({ notificationId: "message-1" }));
        expect(channel.ack).toHaveBeenCalledWith(input);
        expect(channel.sendToQueue).not.toHaveBeenCalled();
    });

    it("moves malformed JSON directly to the dead-letter queue", async () => {
        const channel = channelFixture();
        const input = message("{not-json");

        await handle(consumer({ sendToUser: vi.fn() }), channel, input);

        expect(channel.sendToQueue).toHaveBeenCalledWith(
            "notification_queue.dead",
            input.content,
            expect.objectContaining({
                persistent: true,
                headers: expect.objectContaining({ "x-dead-letter-reason": "invalid-payload" }),
            }),
        );
        expect(channel.waitForConfirms).toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(input);
    });

    it("republishes transient delivery failures with an incremented retry count", async () => {
        const channel = channelFixture();
        const input = message(
            JSON.stringify({ userId: "user-1", title: "Title", body: "Body" }),
            0,
        );
        const sendToUser = vi.fn().mockRejectedValue(new Error("FCM unavailable"));

        await handle(consumer({ sendToUser }), channel, input);

        expect(channel.sendToQueue).toHaveBeenCalledWith(
            "notification_queue",
            expect.any(Buffer),
            expect.objectContaining({
                persistent: true,
                messageId: "message-1",
                headers: expect.objectContaining({ "x-notification-retry-count": 1 }),
            }),
        );
        expect(channel.waitForConfirms).toHaveBeenCalled();
        expect(channel.ack).toHaveBeenCalledWith(input);
    });

    it("dead-letters delivery failures after the retry limit", async () => {
        const channel = channelFixture();
        const input = message(
            JSON.stringify({ userId: "user-1", title: "Title", body: "Body" }),
            2,
        );
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            await handle(
                consumer({ sendToUser: vi.fn().mockRejectedValue(new Error("FCM unavailable")) }, 2),
                channel,
                input,
            );
        } finally {
            consoleError.mockRestore();
        }

        expect(channel.sendToQueue).toHaveBeenCalledWith(
            "notification_queue.dead",
            input.content,
            expect.objectContaining({
                headers: expect.objectContaining({ "x-dead-letter-reason": "delivery-failed" }),
            }),
        );
        expect(channel.ack).toHaveBeenCalledWith(input);
    });
});
