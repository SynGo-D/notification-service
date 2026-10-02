import { describe, expect, it } from "vitest";
import {
    parseNotificationRequest,
    parseRegisterDeviceInput,
} from "../src/types/notification.js";

describe("request validation", () => {
    it("accepts a valid device registration", () => {
        expect(parseRegisterDeviceInput(
            { token: "fcm-token", platform: "ANDROID" },
            "user-1",
        )).toEqual({ token: "fcm-token", platform: "android", userId: "user-1" });
    });

    it("rejects unsupported device platforms", () => {
        expect(() => parseRegisterDeviceInput(
            { token: "fcm-token", platform: "windows-phone" },
            "user-1",
        )).toThrow("platform must be one of");
    });

    it("requires Firebase data values to be strings", () => {
        expect(() => parseNotificationRequest({
            userId: "user-1",
            title: "Title",
            body: "Body",
            data: { pullRequest: 42 },
        })).toThrow("data.pullRequest must be a string");
    });

    it("rejects reserved Firebase data keys", () => {
        expect(() => parseNotificationRequest({
            userId: "user-1",
            title: "Title",
            body: "Body",
            data: { "google.link": "https://example.test" },
        })).toThrow("reserved by Firebase");
    });

    it("does not reject an ordinary key that merely starts with 'from'", () => {
        expect(parseNotificationRequest({
            userId: "user-1",
            title: "Title",
            body: "Body",
            data: { fromScreen: "dashboard" },
        }).data).toEqual({ fromScreen: "dashboard" });
    });
});
