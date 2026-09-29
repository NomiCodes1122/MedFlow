import { describe, it, expect } from 'vitest';
import { TokenService } from './token.service.js';
import { UserRole } from '@prisma/client';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';

describe('TokenService', () => {
  const samplePayload = {
    sub: '11111111-1111-1111-1111-111111111111',
    firebaseUid: 'firebase-user-001',
    phone: '+15550100001',
    role: UserRole.PARAMEDIC,
    sessionId: 'session-uuid-1234',
    deviceId: 'device-uuid-5678',
  };

  it('should sign a valid JWT access token and verify it', () => {
    const token = TokenService.signAccessToken(samplePayload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const decoded = TokenService.verifyAccessToken(token);
    expect(decoded.sub).toBe(samplePayload.sub);
    expect(decoded.firebaseUid).toBe(samplePayload.firebaseUid);
    expect(decoded.phone).toBe(samplePayload.phone);
    expect(decoded.role).toBe(UserRole.PARAMEDIC);
    expect(decoded.sessionId).toBe(samplePayload.sessionId);
    expect(decoded.deviceId).toBe(samplePayload.deviceId);
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
  });

  it('should reject tampered or malformed tokens', () => {
    const validToken = TokenService.signAccessToken(samplePayload);
    const tampered = validToken.slice(0, -5) + 'abcde';

    expect(() => TokenService.verifyAccessToken(tampered)).toThrowError(ApiError);
    try {
      TokenService.verifyAccessToken(tampered);
    } catch (err: any) {
      expect(err.code).toBe(ErrorCodes.AUTH_INVALID_TOKEN);
    }
  });

  it('should generate a 256-bit cryptographically random refresh token', () => {
    const token1 = TokenService.generateRefreshToken();
    const token2 = TokenService.generateRefreshToken();

    expect(token1).toHaveLength(64); // 32 bytes hex encoded = 64 characters
    expect(token2).toHaveLength(64);
    expect(token1).not.toBe(token2);
  });

  it('should produce deterministic SHA-256 hash digests of refresh tokens', () => {
    const rawToken = 'test-refresh-token-12345';
    const hash1 = TokenService.hashRefreshToken(rawToken);
    const hash2 = TokenService.hashRefreshToken(rawToken);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).not.toBe(rawToken);
  });

  it('should perform constant-time comparison correctly', () => {
    const str1 = 'hash-value-abc-123';
    const str2 = 'hash-value-abc-123';
    const str3 = 'hash-value-xyz-999';
    const str4 = 'short';

    expect(TokenService.constantTimeCompare(str1, str2)).toBe(true);
    expect(TokenService.constantTimeCompare(str1, str3)).toBe(false);
    expect(TokenService.constantTimeCompare(str1, str4)).toBe(false);
  });
});
