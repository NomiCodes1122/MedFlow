import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, UserStatus, DevicePlatform } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { SupabaseAuthService } from './supabase-auth.service.js';
import { TokenService } from './token.service.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';
import { prisma } from '../../database/prisma.js';

// Mock Prisma
vi.mock('../../database/prisma.js', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      device: {
        upsert: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      refreshToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

describe('AuthService & RefreshTokenService', () => {
  const mockUser = {
    id: '11111111-1111-1111-1111-111111111111',
    supabaseUid: 'firebase-uid-paramedic-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor (Lead Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: 'session-uuid-001',
    userId: mockUser.id,
    deviceId: 'device-uuid-001',
    hashedToken: 'some-sha256-hash',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    user: mockUser,
    device: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('establishSession', () => {
    it('should authenticate a valid provisioned user and issue short-lived token and rotational refresh session', async () => {
      // Mock Firebase verification
      SupabaseAuthService.setCustomVerifier(async () => ({
        uid: mockUser.supabaseUid,
        phone: mockUser.phone,
      }));

      // Mock database lookups
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce(mockSession as any);

      const result = await AuthService.establishSession({
        idToken: 'mock-valid-firebase-token',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(900);
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.role).toBe(UserRole.PARAMEDIC);
      expect(result.user.status).toBe(UserStatus.ACTIVE);

      // Verify access token claims
      const decoded = TokenService.verifyAccessToken(result.accessToken);
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.role).toBe(UserRole.PARAMEDIC);
      expect(decoded.sessionId).toBe(mockSession.id);
    });

    it('should reject unprovisioned users with AUTH_USER_NOT_FOUND', async () => {
      SupabaseAuthService.setCustomVerifier(async () => ({
        uid: 'unauthorized-stranger-uid',
        phone: '+15559999999',
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      try {
        await AuthService.establishSession({ idToken: 'unprovisioned-token' });
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe(ErrorCodes.AUTH_USER_NOT_FOUND);
      }
    });

    it('should reject inactive or suspended users with AUTH_USER_INACTIVE', async () => {
      SupabaseAuthService.setCustomVerifier(async () => ({
        uid: mockUser.supabaseUid,
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...mockUser,
        status: UserStatus.SUSPENDED,
      } as any);

      try {
        await AuthService.establishSession({ idToken: 'suspended-user-token' });
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe(ErrorCodes.AUTH_USER_INACTIVE);
      }
    });

    it('should reject soft-deleted users with AUTH_USER_INACTIVE', async () => {
      SupabaseAuthService.setCustomVerifier(async () => ({
        uid: mockUser.supabaseUid,
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...mockUser,
        deletedAt: new Date(),
      } as any);

      await expect(
        AuthService.establishSession({ idToken: 'deleted-user-token' })
      ).rejects.toThrowError(ApiError);
    });

    it('should register and bind device metadata when provided', async () => {
      SupabaseAuthService.setCustomVerifier(async () => ({
        uid: mockUser.supabaseUid,
      }));

      const mockDevice = {
        id: '44444444-4444-4444-4444-444444444441',
        userId: mockUser.id,
        platform: DevicePlatform.ANDROID,
        appVersion: '1.2.0',
        pushToken: 'sample-push-token',
        lastActiveAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);
      vi.mocked(prisma.device.create).mockResolvedValueOnce(mockDevice as any);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce({
        ...mockSession,
        deviceId: mockDevice.id,
      } as any);

      const result = await AuthService.establishSession({
        idToken: 'token-with-device',
        device: {
          platform: DevicePlatform.ANDROID,
          appVersion: '1.2.0',
          pushToken: 'sample-push-token',
        },
      });

      expect(result.device).toBeDefined();
      expect(result.device?.id).toBe(mockDevice.id);
      expect(result.device?.platform).toBe(DevicePlatform.ANDROID);
      expect(prisma.device.create).toHaveBeenCalled();
    });
  });

  describe('refreshSession & rotation', () => {
    it('should rotate single-use refresh token and issue new token pair', async () => {
      const rawOldToken = 'raw-old-token-value';
      const newMockSession = {
        ...mockSession,
        id: 'new-session-uuid-002',
      };

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(mockSession as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([
        { ...mockSession, revokedAt: new Date() },
        newMockSession,
      ] as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      const result = await AuthService.refreshSession(rawOldToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(900);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should trigger replay detection and revoke all user sessions if a revoked token is reused', async () => {
      const alreadyRevokedSession = {
        ...mockSession,
        revokedAt: new Date(Date.now() - 3600000), // revoked an hour ago
      };

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(
        alreadyRevokedSession as any
      );
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 3 } as any);

      try {
        await AuthService.refreshSession('replayed-revoked-token');
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe(ErrorCodes.AUTH_REFRESH_TOKEN_REUSED);
      }

      // Verify token family revocation occurred
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: alreadyRevokedSession.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it('should reject expired refresh token with AUTH_TOKEN_EXPIRED', async () => {
      const expiredSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() - 1000), // expired 1s ago
      };

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(expiredSession as any);

      try {
        await AuthService.refreshSession('expired-refresh-token');
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_EXPIRED);
      }
    });

    it('should reject unknown refresh token with AUTH_INVALID_REFRESH_TOKEN', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(null);

      try {
        await AuthService.refreshSession('non-existent-token');
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe(ErrorCodes.AUTH_INVALID_REFRESH_TOKEN);
      }
    });
  });

  describe('logout & revocation', () => {
    it('should revoke session by raw refresh token', async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      const result = await AuthService.logout({ rawRefreshToken: 'some-token' });
      expect(result.revoked).toBe(true);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('should revoke session by sessionId', async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      const result = await AuthService.logout({ sessionId: 'session-uuid-123' });
      expect(result.revoked).toBe(true);
    });

    it('should revoke all user sessions on logoutAll', async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 4 } as any);

      const result = await AuthService.logoutAll(mockUser.id);
      expect(result.revokedCount).toBe(4);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
