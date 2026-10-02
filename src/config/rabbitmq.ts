import amqplib, { type ChannelModel, type ConfirmChannel } from "amqplib";
import { env } from "./env.js";

let connection: ChannelModel | undefined;
let channel: ConfirmChannel | undefined;
let closing = false;
let reconnecting = false;
let reconnectHandler: (() => Promise<void>) | undefined;

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

async function establishConnection(): Promise<void> {
    connection = await amqplib.connect(env.RABBITMQ_URL);
    channel = await connection.createConfirmChannel();

    connection.on("error", (error) => {
        console.error("RabbitMQ connection error:", error);
    });
    connection.on("close", () => {
        connection = undefined;
        channel = undefined;
        if (!closing) void scheduleReconnect();
    });
}

async function scheduleReconnect(delayMs = INITIAL_RECONNECT_DELAY_MS): Promise<void> {
    if (reconnecting || closing) return;
    reconnecting = true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
        await establishConnection();
        await reconnectHandler?.();
        reconnecting = false;
        console.log("Notification service reconnected to RabbitMQ.");
    } catch (error) {
        console.error("RabbitMQ reconnect failed:", error);
        reconnecting = false;
        void scheduleReconnect(Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS));
    }
}

export async function connectRabbitMQ(): Promise<void> {
    await establishConnection();
    console.log("Notification service connected to RabbitMQ.");
}

export function getRabbitMQChannel(): ConfirmChannel {
    if (!channel) throw new Error("RabbitMQ is not connected.");
    return channel;
}

export function isRabbitMQConnected(): boolean {
    return !env.RABBITMQ_ENABLED || (connection !== undefined && channel !== undefined);
}

export function onRabbitMQReconnect(handler: () => Promise<void>): void {
    reconnectHandler = handler;
}

export async function closeRabbitMQ(): Promise<void> {
    closing = true;
    await channel?.close();
    await connection?.close();
    channel = undefined;
    connection = undefined;
}
