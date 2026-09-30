import admin from 'firebase-admin';
import { config } from '../../config/index.js';
import { logger } from '../../common/logging/logger.js';

let firebaseApp: admin.app.App | null = null;
let isInitialized = false;

export function initFirebaseAdmin(): admin.app.App | null {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (!config.firebase.isConfigured) {
    logger.warn(
      'Firebase Admin credentials not configured in environment. Firebase features will run in mock/disabled state.'
    );
    return null;
  }

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });

    isInitialized = true;
    logger.info({ projectId: config.firebase.projectId }, 'Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to initialize Firebase Admin SDK'
    );
    return null;
  }
}

export function getFirebaseAdminApp(): admin.app.App | null {
  if (!firebaseApp && !isInitialized) {
    return initFirebaseAdmin();
  }
  return firebaseApp;
}

export function checkFirebaseHealth(): boolean {
  return isInitialized && firebaseApp !== null;
}


export function getFirebaseMessaging(): admin.messaging.Messaging | null {
  const app = getFirebaseAdminApp();
  return app ? app.messaging() : null;
}

export function getFirebaseStorage(): admin.storage.Storage | null {
  const app = getFirebaseAdminApp();
  return app ? app.storage() : null;
}
