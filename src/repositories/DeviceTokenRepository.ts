import type { RegisterDeviceInput } from "../types/notification.js";

export interface DeviceTokenRepository {
    upsert(input: RegisterDeviceInput): Promise<void>;
    remove(userId: string, token: string): Promise<boolean>;
    findByUserId(userId: string): Promise<string[]>;
    removeTokens(tokens: string[]): Promise<number>;
}
