import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { env } from "./env.js";

export interface FirebaseServices {
    app: App;
    firestore: Firestore;
    messaging: Messaging;
}

let services: FirebaseServices | undefined;

export function initializeFirebase(): FirebaseServices {
    if (services) return services;

    const existingApp = getApps()[0];
    const app = existingApp ?? initializeApp({
        credential: env.FIREBASE_PROJECT_ID
            ? cert({
                projectId: env.FIREBASE_PROJECT_ID,
                clientEmail: env.FIREBASE_CLIENT_EMAIL,
                privateKey: env.FIREBASE_PRIVATE_KEY,
            })
            : applicationDefault(),
        ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {}),
    });

    services = {
        app,
        firestore: getFirestore(app),
        messaging: getMessaging(app),
    };

    return services;
}

export function isFirebaseInitialized(): boolean {
    return services !== undefined;
}

/**
 * Firebase initialization is lazy and does not itself prove that the supplied
 * service-account credentials work. Fetch one OAuth token at startup so a bad
 * key fails before the process starts accepting registration/send requests.
 */
export async function verifyFirebaseCredentials(firebase: FirebaseServices): Promise<void> {
    const credential = firebase.app.options.credential;
    if (!credential) throw new Error("Firebase application has no credential configured.");
    await credential.getAccessToken();
}
