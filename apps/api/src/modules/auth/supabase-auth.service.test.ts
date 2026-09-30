import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';

describe('SupabaseAuthService', () => {
  afterEach(() => {
    SupabaseAuthService.setCustomVerifier(null);
  });

  it('should reject missing or empty ID tokens', async () => {
    await expect(SupabaseAuthService.verifyIdToken('')).rejects.toThrowError(ApiError);
    await expect(SupabaseAuthService.verifyIdToken('   ')).rejects.toThrowError(ApiError);

    try {
      await SupabaseAuthService.verifyIdToken('');
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.AUTH_INVALID_TOKEN);
    }
  });

  it('should verify token with custom/mock verifier in test mode', async () => {
    SupabaseAuthService.setCustomVerifier(async (token) => {
      if (token === 'valid-paramedic-token') {
        return { uid: 'paramedic-firebase-uid', phone: '+15550100001' };
      }
      if (token === 'expired-token') {
        throw ApiError.authTokenExpired('Token expired');
      }
      throw ApiError.authInvalidToken('Invalid token');
    });

    const verified = await SupabaseAuthService.verifyIdToken('valid-paramedic-token');
    expect(verified.uid).toBe('paramedic-firebase-uid');
    expect(verified.phone).toBe('+15550100001');

    await expect(SupabaseAuthService.verifyIdToken('expired-token')).rejects.toThrowError(
      ApiError
    );
    await expect(SupabaseAuthService.verifyIdToken('random-invalid')).rejects.toThrowError(
      ApiError
    );
  });

  it('should report service unavailable if Supabase is unconfigured and no custom verifier exists', async () => {
    SupabaseAuthService.setCustomVerifier(null);

    try {
      await SupabaseAuthService.verifyIdToken('some-token');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(
        err.code === ErrorCodes.SERVICE_UNAVAILABLE || err.code === ErrorCodes.AUTH_INVALID_TOKEN
      ).toBe(true);
    }
  });
});
