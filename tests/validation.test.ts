import { describe, expect, it } from "vitest";
import {
    parseDeviceToken,
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

    it("rejects non-object request bodies", () => {
        for (const value of [null, undefined, "text", 42, []]) {
            expect(() => parseNotificationRequest(value)).toThrow("must be a JSON object");
        }
    });

    it("trims device tokens and validates token-only requests", () => {
        expect(parseRegisterDeviceInput(
            { token: "  fcm-token  ", platform: "  IOS  " },
            "user-1",
        )).toEqual({ token: "fcm-token", platform: "ios", userId: "user-1" });
        expect(parseDeviceToken({ token: "  fcm-token  " })).toBe("fcm-token");
    });

    it("enforces required notification field length limits", () => {
        for (const request of [
            { userId: "", title: "Title", body: "Body" },
            { userId: "u".repeat(129), title: "Title", body: "Body" },
            { userId: "user-1", title: "t".repeat(201), body: "Body" },
            { userId: "user-1", title: "Title", body: "b".repeat(2_001) },
        ]) {
            expect(() => parseNotificationRequest(request)).toThrow();
        }
    });

    it("rejects more than 20 Firebase data entries", () => {
        const data = Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [`key${index}`, "value"]),
        );
        expect(() => parseNotificationRequest({
            userId: "user-1", title: "Title", body: "Body", data,
        })).toThrow("no more than 20 entries");
    });

    it("rejects an oversized Firebase data payload", () => {
        expect(() => parseNotificationRequest({
            userId: "user-1",
            title: "Title",
            body: "Body",
            data: { details: "x".repeat(3_500) },
        })).toThrow("too large for an FCM message");
    });
});
