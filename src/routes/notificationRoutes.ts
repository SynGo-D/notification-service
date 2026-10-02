import { Router } from "express";
import type { NotificationController } from "../controllers/NotificationController.js";
import { requireInternalAuth } from "../middleware/requireInternalAuth.js";

export function createNotificationRoutes(controller: NotificationController): Router {
    const router = Router();
    router.use(requireInternalAuth);
    router.post("/", controller.send);
    return router;
}
