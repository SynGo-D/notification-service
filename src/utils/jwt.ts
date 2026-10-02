import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface SessionPayload {
    userId: string;
    email: string;
}

export function verifySession(token: string): SessionPayload {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (
        typeof payload !== "object"
        || typeof payload.userId !== "string"
        || typeof payload.email !== "string"
    ) {
        throw new Error("Session token does not contain the required identity fields.");
    }
    return { userId: payload.userId, email: payload.email };
}
