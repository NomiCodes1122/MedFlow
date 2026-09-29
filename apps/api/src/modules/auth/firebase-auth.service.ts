import { getFirebaseAuth } from '../../integrations/firebase/admin.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { FirebaseVerifiedUser } from './auth.types.js';

export type FirebaseIdTokenVerifier = (idToken: string) => Promise<FirebaseVerifiedUser>;

let customVerifier: FirebaseIdTokenVerifier | null = null;

export class FirebaseAuthService {
  /**
   * For automated testing: override the verifier with a mock implementation.
   */
  static setCustomVerifier(verifier: FirebaseIdTokenVerifier | null): void {
    customVerifier = verifier;
  }

  /**
   * Cryptographically verifies a Firebase ID token.
   * Derives verified Firebase UID and phone number.
   * Rejects expired, invalid, or forged tokens.
   */
  static async verifyIdToken(idToken: string): Promise<FirebaseVerifiedUser> {
    if (!idToken || typeof idToken !== 'string' || idToken.trim().length === 0) {
      throw ApiError.authInvalidToken('Firebase ID token is required');
    }

    // 1. If custom verifier set (e.g. during test suites), execute it
    if (customVerifier) {
      return customVerifier(idToken);
    }

    // 2. Production / Live Firebase verification
    const auth = getFirebaseAuth();
    if (!auth) {
      logger.error('Firebase Auth requested but Firebase Admin SDK is not initialized/configured');
      throw ApiError.serviceUnavailable(
        'Authentication provider is temporarily unavailable. Live Firebase configuration pending.'
      );
    }

    try {
      // verifyIdToken checks signature, validity, expiration, issuer, and audience
      const decoded = await auth.verifyIdToken(idToken, true);

      if (!decoded.uid) {
        throw ApiError.authInvalidToken('Firebase token missing subject UID');
      }

      return {
        uid: decoded.uid,
        phone: decoded.phone_number,
      };
    } catch (error: any) {
      // Map Firebase Admin error codes to sanitized ApiErrors
      if (error?.code === 'auth/id-token-expired') {
        throw ApiError.authTokenExpired('Firebase ID token has expired');
      }
      if (error?.code === 'auth/id-token-revoked') {
        throw ApiError.authSessionRevoked('Firebase session has been revoked');
      }
      if (
        error?.code === 'auth/argument-error' ||
        error?.code === 'auth/invalid-id-token' ||
        error?.code === 'auth/invalid-argument'
      ) {
        throw ApiError.authInvalidToken('Invalid Firebase ID token format or signature');
      }

      logger.warn({ errorCode: error?.code }, 'Firebase token verification failed');
      throw ApiError.authInvalidToken('Failed to verify authentication token');
    }
  }
}
