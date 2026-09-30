import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/AppError.js";

export function notFoundHandler(_req: Request, res: Response): void {
    res.status(404).json({ success: false, message: "Route not found." });
}

export function errorHandler(
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({ success: false, message: error.message });
        return;
    }

    if (error instanceof SyntaxError && (error as SyntaxError & { status?: number }).status === 400) {
        res.status(400).json({ success: false, message: "Malformed JSON payload." });
        return;
    }

    if ((error as Error & { type?: string }).type === "entity.too.large") {
        res.status(413).json({ success: false, message: "Request body is too large." });
        return;
    }

    console.error("[notification-service] Unhandled request error:", error);
    res.status(500).json({ success: false, message: "An internal server error occurred." });
}
