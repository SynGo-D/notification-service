import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

function safelyEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
        && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requireInternalAuth(req: Request, res: Response, next: NextFunction): void {
    const provided = req.headers["x-internal-service-token"];
    if (
        typeof provided !== "string"
        || !env.INTERNAL_SERVICE_TOKEN
        || !safelyEqual(provided, env.INTERNAL_SERVICE_TOKEN)
    ) {
        res.status(401).json({ success: false, message: "Unauthorized service request." });
        return;
    }
    next();
}
