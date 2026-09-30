import express, { type Express } from "express";
import { DeviceController } from "./controllers/DeviceController.js";
import { NotificationController } from "./controllers/NotificationController.js";
import { isFirebaseInitialized } from "./config/firebase.js";
import { isRabbitMQConnected } from "./config/rabbitmq.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import type { DeviceTokenRepository } from "./repositories/DeviceTokenRepository.js";
import { createDeviceRoutes } from "./routes/deviceRoutes.js";
import { createNotificationRoutes } from "./routes/notificationRoutes.js";
import type { NotificationService } from "./services/NotificationService.js";

export interface AppDependencies {
    repository: DeviceTokenRepository;
    notificationService: NotificationService;
}

export function createApp(dependencies: AppDependencies): Express {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "32kb" }));

    app.get("/health", (_req, res) => {
        res.json({ service: "notification-service", status: "healthy" });
    });

    app.get("/ready", (_req, res) => {
        const checks = {
            firebase: isFirebaseInitialized(),
            rabbitmq: isRabbitMQConnected(),
        };
        const ready = checks.firebase && checks.rabbitmq;
        res.status(ready ? 200 : 503).json({
            service: "notification-service",
            ready,
            checks,
        });
    });

    app.use(
        "/api/devices",
        createDeviceRoutes(new DeviceController(dependencies.repository)),
    );
    app.use(
        "/api/notifications",
        createNotificationRoutes(new NotificationController(dependencies.notificationService)),
    );

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
