import type { NextFunction, Request, Response } from "express";
import type { NotificationService } from "../services/NotificationService.js";
import { parseNotificationRequest } from "../types/notification.js";

export class NotificationController {
    constructor(private readonly notificationService: NotificationService) {}

    send = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const report = await this.notificationService.sendToUser(
                parseNotificationRequest(req.body),
            );
            res.status(report.failed > 0 ? 207 : 200).json({ success: report.failed === 0, ...report });
        } catch (error) {
            next(error);
        }
    };
}
