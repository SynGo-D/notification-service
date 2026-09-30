import type { NextFunction, Request, Response } from "express";
import type { DeviceTokenRepository } from "../repositories/DeviceTokenRepository.js";
import { parseDeviceToken, parseRegisterDeviceInput } from "../types/notification.js";

export class DeviceController {
    constructor(private readonly repository: DeviceTokenRepository) {}

    register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const input = parseRegisterDeviceInput(req.body, req.userId!);
            await this.repository.upsert(input);
            res.status(201).json({ success: true, message: "Device registered." });
        } catch (error) {
            next(error);
        }
    };

    unregister = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const token = parseDeviceToken(req.body);
            const removed = await this.repository.remove(req.userId!, token);
            res.status(removed ? 200 : 404).json({
                success: removed,
                message: removed ? "Device unregistered." : "Device registration not found.",
            });
        } catch (error) {
            next(error);
        }
    };
}
