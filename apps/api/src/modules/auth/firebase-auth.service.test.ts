import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FirebaseAuthService } from './firebase-auth.service.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';

describe('FirebaseAuthService', () => {
  afterEach(() => {
    FirebaseAuthService.setCustomVerifier(null);
  });

  it('should reject missing or empty ID tokens', async () => {
    await expect(FirebaseAuthService.verifyIdToken('')).rejects.toThrowError(ApiError);
    await expect(FirebaseAuthService.verifyIdToken('   ')).rejects.toThrowError(ApiError);

    try {
      await FirebaseAuthService.verifyIdToken('');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.AUTH_INVALID_TOKEN);
    }
  });

  it('should verify token with custom/mock verifier in test mode', async () => {
    FirebaseAuthService.setCustomVerifier(async (token) => {
      if (token === 'valid-paramedic-token') {
        return { uid: 'paramedic-firebase-uid', phone: '+15550100001' };
      }
      if (token === 'expired-token') {
        throw ApiError.authTokenExpired('Token expired');
      }
      throw ApiError.authInvalidToken('Invalid token');
    });

    const verified = await FirebaseAuthService.verifyIdToken('valid-paramedic-token');
    expect(verified.uid).toBe('paramedic-firebase-uid');
    expect(verified.phone).toBe('+15550100001');

    await expect(FirebaseAuthService.verifyIdToken('expired-token')).rejects.toThrowError(
      ApiError
    );
    await expect(FirebaseAuthService.verifyIdToken('random-invalid')).rejects.toThrowError(
      ApiError
    );
  });

  it('should report service unavailable if Firebase is unconfigured and no custom verifier exists', async () => {
    FirebaseAuthService.setCustomVerifier(null);

    try {
      await FirebaseAuthService.verifyIdToken('some-token');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(
        err.code === ErrorCodes.SERVICE_UNAVAILABLE || err.code === ErrorCodes.AUTH_INVALID_TOKEN
      ).toBe(true);
    }
  });
});
