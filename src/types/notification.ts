import { ValidationError } from "../errors/ValidationError.js";

export const DEVICE_PLATFORMS = ["android", "ios", "web"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export interface RegisterDeviceInput {
    userId: string;
    token: string;
    platform: DevicePlatform;
}

export interface NotificationRequest {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    notificationId?: string;
}

export interface DeliveryReport {
    notificationId: string;
    targeted: number;
    sent: number;
    failed: number;
    removedInvalidTokens: number;
    errorCounts: Record<string, number>;
}

function recordValue(value: unknown, context = "request body"): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ValidationError(`${context} must be a JSON object.`);
    }
    return value as Record<string, unknown>;
}

function requiredString(
    input: Record<string, unknown>,
    key: string,
    maxLength: number,
): string {
    const value = input[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`${key} is required and must be a non-empty string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        throw new ValidationError(`${key} must not exceed ${maxLength} characters.`);
    }
    return trimmed;
}

export function parseRegisterDeviceInput(value: unknown, userId: string): RegisterDeviceInput {
    const input = recordValue(value);
    const token = requiredString(input, "token", 4096);
    const platformValue = requiredString(input, "platform", 16).toLowerCase();

    if (!DEVICE_PLATFORMS.includes(platformValue as DevicePlatform)) {
        throw new ValidationError("platform must be one of: android, ios, web.");
    }

    return { userId, token, platform: platformValue as DevicePlatform };
}

export function parseDeviceToken(value: unknown): string {
    return requiredString(recordValue(value), "token", 4096);
}

function parseData(value: unknown): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    const input = recordValue(value, "data");
    const entries = Object.entries(input);

    if (entries.length > 20) {
        throw new ValidationError("data must contain no more than 20 entries.");
    }

    const output: Record<string, string> = {};
    for (const [key, rawValue] of entries) {
        if (!key || key.length > 128) {
            throw new ValidationError("Each data key must contain 1 to 128 characters.");
        }
        if (/^(?:from|message_type)$/i.test(key) || /^(?:google\.|gcm\.)/i.test(key)) {
            throw new ValidationError(`data key '${key}' is reserved by Firebase.`);
        }
        if (typeof rawValue !== "string") {
            throw new ValidationError(`data.${key} must be a string.`);
        }
        if (rawValue.length > 4096) {
            throw new ValidationError(`data.${key} must not exceed 4096 characters.`);
        }
        output[key] = rawValue;
    }

    if (Buffer.byteLength(JSON.stringify(output), "utf8") > 3_500) {
        throw new ValidationError("data is too large for an FCM message.");
    }
    return output;
}

export function parseNotificationRequest(value: unknown): NotificationRequest {
    const input = recordValue(value);
    const notificationId = input.notificationId === undefined
        ? undefined
        : requiredString(input, "notificationId", 128);

    return {
        userId: requiredString(input, "userId", 128),
        title: requiredString(input, "title", 200),
        body: requiredString(input, "body", 2_000),
        data: parseData(input.data),
        ...(notificationId ? { notificationId } : {}),
    };
}
