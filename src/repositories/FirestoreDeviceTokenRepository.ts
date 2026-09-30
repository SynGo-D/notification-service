import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { RegisterDeviceInput } from "../types/notification.js";
import type { DeviceTokenRepository } from "./DeviceTokenRepository.js";

function tokenDocumentId(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export class FirestoreDeviceTokenRepository implements DeviceTokenRepository {
    constructor(
        private readonly firestore: Firestore,
        private readonly collectionName = "device_tokens",
    ) {}

    async upsert(input: RegisterDeviceInput): Promise<void> {
        const reference = this.firestore
            .collection(this.collectionName)
            .doc(tokenDocumentId(input.token));

        await reference.set({
            userId: input.userId,
            token: input.token,
            platform: input.platform,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }

    async remove(userId: string, token: string): Promise<boolean> {
        const reference = this.firestore
            .collection(this.collectionName)
            .doc(tokenDocumentId(token));

        return this.firestore.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(reference);
            if (!snapshot.exists || snapshot.get("userId") !== userId) return false;
            transaction.delete(reference);
            return true;
        });
    }

    async findByUserId(userId: string): Promise<string[]> {
        const snapshot = await this.firestore
            .collection(this.collectionName)
            .where("userId", "==", userId)
            .select("token")
            .get();

        return snapshot.docs
            .map((document) => document.get("token"))
            .filter((token): token is string => typeof token === "string" && token.length > 0);
    }

    async removeTokens(tokens: string[]): Promise<number> {
        const uniqueTokens = [...new Set(tokens)];
        if (uniqueTokens.length === 0) return 0;

        // A Firestore write batch supports at most 500 operations.
        for (let offset = 0; offset < uniqueTokens.length; offset += 500) {
            const batch = this.firestore.batch();
            for (const token of uniqueTokens.slice(offset, offset + 500)) {
                batch.delete(
                    this.firestore.collection(this.collectionName).doc(tokenDocumentId(token)),
                );
            }
            await batch.commit();
        }

        return uniqueTokens.length;
    }
}
