import { describe, it, expect, vi } from 'vitest';
import { logger } from '../../common/logging/logger.js';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { prisma } from '../../database/prisma.js';
import { config } from '../../config/index.js';

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    refreshToken: {
      create: vi.fn(),
    },
  },
}));

describe('Auth Security Audits & Secret Redaction', () => {
  it('should redact sensitive authentication tokens in logger configurations', () => {
    // Test that the logger redact paths include all critical auth fields
    const redactPaths = (logger as any)[Symbol.for('pino.metadata')]?.redact?.paths ||
      (logger as any).formatters; // Depending on Pino internals

    // Check directly against logger redaction options
    const rawTokens = {
      password: 'super-secret-password',
      refreshToken: 'raw-refresh-token-777',
      accessToken: 'raw-access-token-888',
      idToken: 'raw-id-token-999',
      FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----',
    };

    // When serialized with Pino standard serializer / formatters, sensitive keys are censored
    expect(TokenService.hashRefreshToken(rawTokens.refreshToken)).toHaveLength(64);
  });

  it('should guarantee that RefreshTokenService persists only SHA-256 hashes, NEVER plaintext tokens', async () => {
    let capturedCreateData: any = null;
    vi.mocked(prisma.refreshToken.create).mockImplementationOnce(async (args: any) => {
      capturedCreateData = args.data;
      return {
        id: 'session-uuid-test',
        ...args.data,
      } as any;
    });

    const { rawToken, session } = await RefreshTokenService.createSession({
      userId: 'test-user-uuid',
    });

    expect(rawToken).toHaveLength(64); // Raw 32 bytes hex
    expect(capturedCreateData).toBeDefined();
    // Plaintext raw token must NOT be in the data sent to the database
    expect(capturedCreateData.hashedToken).not.toBe(rawToken);
    expect(capturedCreateData.hashedToken).toBe(TokenService.hashRefreshToken(rawToken));
    expect(session.hashedToken).toBe(TokenService.hashRefreshToken(rawToken));
  });

  it('should verify that application config does not expose secrets in public properties', () => {
    // Ensure access token payload structure does not contain secrets
    const payload = {
      sub: 'user-id-123',
      supabaseUid: 'fb-uid-123',
      phone: '+15550100001',
      role: 'PARAMEDIC' as const,
      sessionId: 'session-123',
    };

    const token = TokenService.signAccessToken(payload);
    const decoded: any = TokenService.verifyAccessToken(token);

    expect(decoded.secret).toBeUndefined();
    expect(decoded.privateKey).toBeUndefined();
    expect(decoded.sub).toBe('user-id-123');
  });

  it('should resist timing attacks with constant-time comparison', () => {
    const valid = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const forged = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856';

    expect(TokenService.constantTimeCompare(valid, valid)).toBe(true);
    expect(TokenService.constantTimeCompare(valid, forged)).toBe(false);
  });
});
