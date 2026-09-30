import type { NextFunction, Request, Response } from "express";
import { verifySession } from "../utils/jwt.js";

export function requireUserAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ success: false, message: "Missing or malformed Authorization header." });
        return;
    }

    try {
        const session = verifySession(header.slice("Bearer ".length));
        req.userId = session.userId;
        req.userEmail = session.email;
        next();
    } catch {
        res.status(401).json({ success: false, message: "Invalid or expired session." });
    }
}
