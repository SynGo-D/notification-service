import { Router } from "express";
import type { DeviceController } from "../controllers/DeviceController.js";
import { requireUserAuth } from "../middleware/requireUserAuth.js";

export function createDeviceRoutes(controller: DeviceController): Router {
    const router = Router();
    router.use(requireUserAuth);
    router.post("/", controller.register);
    router.delete("/", controller.unregister);
    return router;
}
