import "dotenv/config";

function positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    return value.trim().toLowerCase() === "true";
}

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PORT: positiveInteger(process.env.PORT, 5003),

    JWT_SECRET: process.env.JWT_SECRET ?? "",
    INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN ?? "",

    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? "",
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ?? "",
    FIREBASE_PRIVATE_KEY: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    FIRESTORE_DEVICE_TOKENS_COLLECTION:
        process.env.FIRESTORE_DEVICE_TOKENS_COLLECTION ?? "device_tokens",

    RABBITMQ_ENABLED: booleanValue(process.env.RABBITMQ_ENABLED, false),
    RABBITMQ_URL: process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672",
    RABBITMQ_NOTIFICATION_QUEUE:
        process.env.RABBITMQ_NOTIFICATION_QUEUE ?? "notification_queue",
    RABBITMQ_PREFETCH: positiveInteger(process.env.RABBITMQ_PREFETCH, 10),
    RABBITMQ_MAX_RETRIES: positiveInteger(process.env.RABBITMQ_MAX_RETRIES, 3),
};

export function validateEnvironment(): void {
    const missing: string[] = [];

    if (!env.JWT_SECRET) missing.push("JWT_SECRET");
    if (!env.INTERNAL_SERVICE_TOKEN) missing.push("INTERNAL_SERVICE_TOKEN");

    const firebaseValues = [
        env.FIREBASE_PROJECT_ID,
        env.FIREBASE_CLIENT_EMAIL,
        env.FIREBASE_PRIVATE_KEY,
    ];
    const configuredFirebaseValues = firebaseValues.filter(Boolean).length;

    // All three explicit values must be supplied together. With none supplied,
    // firebase-admin uses Application Default Credentials (Cloud Run/GCE or
    // GOOGLE_APPLICATION_CREDENTIALS).
    if (configuredFirebaseValues > 0 && configuredFirebaseValues < firebaseValues.length) {
        throw new Error(
            "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must be configured together.",
        );
    }

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
}
