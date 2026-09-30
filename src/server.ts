import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { env, validateEnvironment } from "./config/env.js";
import { initializeFirebase, verifyFirebaseCredentials } from "./config/firebase.js";
import {
    closeRabbitMQ,
    connectRabbitMQ,
    getRabbitMQChannel,
    onRabbitMQReconnect,
} from "./config/rabbitmq.js";
import { NotificationConsumer } from "./messaging/NotificationConsumer.js";
import { FirestoreDeviceTokenRepository } from "./repositories/FirestoreDeviceTokenRepository.js";
import { NotificationService } from "./services/NotificationService.js";

async function main(): Promise<void> {
    validateEnvironment();
    const firebase = initializeFirebase();
    await verifyFirebaseCredentials(firebase);
    const repository = new FirestoreDeviceTokenRepository(
        firebase.firestore,
        env.FIRESTORE_DEVICE_TOKENS_COLLECTION,
    );
    const notificationService = new NotificationService(repository, firebase.messaging);
    const app = createApp({ repository, notificationService });

    if (env.RABBITMQ_ENABLED) {
        await connectRabbitMQ();
        const consumer = new NotificationConsumer(
            notificationService,
            env.RABBITMQ_NOTIFICATION_QUEUE,
            env.RABBITMQ_PREFETCH,
            env.RABBITMQ_MAX_RETRIES,
        );
        const startConsumer = () => consumer.start(getRabbitMQChannel());
        onRabbitMQReconnect(startConsumer);
        await startConsumer();
        console.log(`Consuming RabbitMQ queue '${env.RABBITMQ_NOTIFICATION_QUEUE}'.`);
    }

    const server = app.listen(env.PORT, () => {
        console.log(`Notification service running on port ${env.PORT}.`);
    });

    const shutdown = (signal: string): void => {
        console.log(`${signal} received, shutting down gracefully...`);
        server.close(() => {
            void (async () => {
                if (env.RABBITMQ_ENABLED) await closeRabbitMQ();
                process.exit(0);
            })();
        });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
    const failureId = randomUUID();
    console.error(`Notification service failed to start (failure ${failureId}):`, error);
    process.exit(1);
});
