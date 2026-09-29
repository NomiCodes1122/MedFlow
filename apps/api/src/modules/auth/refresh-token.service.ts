import { RefreshToken, UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { config } from '../../config/index.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { TokenService } from './token.service.js';

export class RefreshTokenService {
  /**
   * Generates a new cryptographic refresh token, hashes it, and persists the session.
   * Only the raw unhashed token is returned to the client.
   */
  static async createSession(params: {
    userId: string;
    deviceId?: string | null;
  }): Promise<{ rawToken: string; session: RefreshToken }> {
    const rawToken = TokenService.generateRefreshToken();
    const hashedToken = TokenService.hashRefreshToken(rawToken);

    const expiresAt = new Date(
      Date.now() + config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000
    );

    const session = await prisma.refreshToken.create({
      data: {
        userId: params.userId,
        deviceId: params.deviceId || null,
        hashedToken,
        expiresAt,
      },
    });

    return { rawToken, session };
  }

  /**
   * Consumes a refresh token, performs replay detection, revokes the used token,
   * and issues an atomic replacement token.
   *
   * SECURITY GUARANTEES:
   * 1. If an already revoked token is presented, replay detection triggers:
   *    all active sessions for the user are immediately revoked (family revocation).
   * 2. The exchange is wrapped in a Prisma transaction to ensure strict atomicity.
   */
  static async rotateRefreshToken(rawToken: string): Promise<{
    newRawToken: string;
    newSession: RefreshToken;
    previousSession: RefreshToken;
  }> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw ApiError.authInvalidRefreshToken('Refresh token is required');
    }

    const hashedToken = TokenService.hashRefreshToken(rawToken);

    // 1. Look up existing token with user and device associations
    const existing = await prisma.refreshToken.findUnique({
      where: { hashedToken },
      include: {
        user: true,
        device: true,
      },
    });

    // 2. Reject if token does not exist
    if (!existing) {
      throw ApiError.authInvalidRefreshToken('Invalid or unrecognized refresh token');
    }

    // 3. REPLAY DETECTION: Token was already revoked/rotated
    if (existing.revokedAt !== null) {
      logger.warn(
        { userId: existing.userId, sessionId: existing.id },
        'SECURITY ALERT: Revoked refresh token reuse detected! Invalidating all active sessions for user.'
      );

      // Invalidate all active sessions for this compromised user
      await prisma.refreshToken.updateMany({
        where: {
          userId: existing.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      throw ApiError.authRefreshTokenReused(
        'Invalid refresh attempt: token reuse detected. All active sessions have been revoked.'
      );
    }

    // 4. Expiration check
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw ApiError.authTokenExpired('Refresh token has expired. Please re-authenticate.');
    }

    // 5. Active User check
    if (existing.user.status !== UserStatus.ACTIVE || existing.user.deletedAt !== null) {
      throw ApiError.authUserInactive('User account is inactive, suspended, or deleted');
    }

    // 6. Generate replacement token
    const newRawToken = TokenService.generateRefreshToken();
    const newHashedToken = TokenService.hashRefreshToken(newRawToken);
    const newExpiresAt = new Date(
      Date.now() + config.jwt.refreshExpiresDays * 24 * 60 * 60 * 1000
    );

    // 7. Atomic rotation transaction
    const [previousSession, newSession] = await prisma.$transaction([
      // Invalidate current token
      prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      }),
      // Create new session token maintaining user and device bindings
      prisma.refreshToken.create({
        data: {
          userId: existing.userId,
          deviceId: existing.deviceId,
          hashedToken: newHashedToken,
          expiresAt: newExpiresAt,
        },
      }),
    ]);

    // Update device activity timestamp if associated
    if (existing.deviceId) {
      try {
        await prisma.device.update({
          where: { id: existing.deviceId },
          data: { lastActiveAt: new Date() },
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to update device lastActiveAt during token rotation');
      }
    }

    return {
      newRawToken,
      newSession,
      previousSession,
    };
  }

  /**
   * Revokes a session by its unique session ID.
   */
  static async revokeSession(sessionId: string): Promise<boolean> {
    try {
      const updated = await prisma.refreshToken.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return updated.count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Revokes a session using its raw refresh token (used by client logout).
   */
  static async revokeByRawToken(rawToken: string): Promise<boolean> {
    try {
      const hashedToken = TokenService.hashRefreshToken(rawToken);
      const updated = await prisma.refreshToken.updateMany({
        where: { hashedToken, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return updated.count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Revokes all active sessions for a specific user.
   */
  static async revokeAllUserSessions(userId: string): Promise<number> {
    const updated = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return updated.count;
  }

  /**
   * Checks whether a session ID corresponds to an active, non-revoked session.
   */
  static async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });

    if (!session) return false;
    if (session.revokedAt !== null) return false;
    if (session.expiresAt.getTime() <= Date.now()) return false;

    return true;
  }
}
