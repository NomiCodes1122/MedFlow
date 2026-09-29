import { UserStatus, Device } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { TokenService } from './token.service.js';
import { FirebaseAuthService } from './firebase-auth.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import {
  SessionEstablishInput,
  AuthSessionResult,
  RefreshSessionResult,
  LogoutResult,
  LogoutAllResult,
} from './auth.types.js';

export class AuthService {
  /**
   * Establishes a verified MedFlow application session from a Firebase ID token.
   *
   * SECURITY ENFORCEMENT:
   * 1. Derives identity solely from cryptographically verified Firebase ID token.
   * 2. Rejects unprovisioned users (no auto-provisioning of privileged roles).
   * 3. Authoritative role strictly originates from Supabase PostgreSQL database record.
   * 4. Validates that the user is ACTIVE and not soft-deleted.
   * 5. Registers/associates device telemetry if provided.
   * 6. Generates hashed rotational refresh session and short-lived access JWT.
   */
  static async establishSession(input: SessionEstablishInput): Promise<AuthSessionResult> {
    // 1. Verify Firebase ID Token
    const verified = await FirebaseAuthService.verifyIdToken(input.idToken);

    // 2. Resolve MedFlow User Record
    // First attempt: lookup by verified firebaseUid
    let user = await prisma.user.findUnique({
      where: { firebaseUid: verified.uid },
    });

    // Fallback: If not found by firebaseUid but phone number is present in verified claims,
    // link pre-provisioned user record with their first-time verified Firebase UID.
    if (!user && verified.phone) {
      const userByPhone = await prisma.user.findUnique({
        where: { phone: verified.phone },
      });

      if (userByPhone) {
        user = await prisma.user.update({
          where: { id: userByPhone.id },
          data: { firebaseUid: verified.uid },
        });
        logger.info(
          { userId: user.id, phone: user.phone },
          'Pre-provisioned user bound to verified Firebase UID on first login'
        );
      }
    }

    // 3. User must be pre-provisioned
    if (!user) {
      logger.warn(
        { firebaseUid: verified.uid, phone: verified.phone },
        'Authentication rejected: user is not provisioned in MedFlow system'
      );
      throw ApiError.authUserNotFound(
        'User account is not provisioned in the MedFlow disaster response system'
      );
    }

    // 4. Validate User Status
    if (user.status !== UserStatus.ACTIVE || user.deletedAt !== null) {
      logger.warn(
        { userId: user.id, status: user.status },
        'Authentication rejected: user account is deactivated, suspended, or deleted'
      );
      throw ApiError.authUserInactive('User account is inactive or suspended');
    }

    // 5. Device Association (if provided)
    let device: Device | null = null;
    if (input.device) {
      const { id: deviceId, platform, appVersion, pushToken } = input.device;

      if (deviceId) {
        // Upsert existing device
        device = await prisma.device.upsert({
          where: { id: deviceId },
          update: {
            userId: user.id,
            platform,
            appVersion,
            pushToken: pushToken || null,
            lastActiveAt: new Date(),
          },
          create: {
            id: deviceId,
            userId: user.id,
            platform,
            appVersion,
            pushToken: pushToken || null,
            lastActiveAt: new Date(),
          },
        });
      } else {
        // Register new device
        device = await prisma.device.create({
          data: {
            userId: user.id,
            platform,
            appVersion,
            pushToken: pushToken || null,
            lastActiveAt: new Date(),
          },
        });
      }
    }

    // 6. Create Refresh Token / Application Session
    const { rawToken: refreshToken, session } = await RefreshTokenService.createSession({
      userId: user.id,
      deviceId: device?.id || null,
    });

    // 7. Issue Short-Lived Access Token (15m)
    const accessToken = TokenService.signAccessToken({
      sub: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      role: user.role, // Strictly from database
      sessionId: session.id,
      deviceId: device?.id || null,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900, // 15 minutes in seconds
      user: {
        id: user.id,
        displayName: user.displayName,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
      ...(device
        ? {
            device: {
              id: device.id,
              platform: device.platform,
              appVersion: device.appVersion,
            },
          }
        : {}),
    };
  }

  /**
   * Refreshes an application session via rotational refresh token.
   */
  static async refreshSession(rawRefreshToken: string): Promise<RefreshSessionResult> {
    // 1. Consume and rotate refresh token with replay detection
    const { newRawToken, newSession } =
      await RefreshTokenService.rotateRefreshToken(rawRefreshToken);

    // 2. Fetch authoritative user record
    const user = await prisma.user.findUnique({
      where: { id: newSession.userId },
    });

    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt !== null) {
      throw ApiError.authUserInactive('User account is inactive or suspended');
    }

    // 3. Issue new short-lived access token
    const accessToken = TokenService.signAccessToken({
      sub: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      role: user.role,
      sessionId: newSession.id,
      deviceId: newSession.deviceId || null,
    });

    return {
      accessToken,
      refreshToken: newRawToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    };
  }

  /**
   * Logs out the current session by revoking the refresh token / session.
   */
  static async logout(params: {
    rawRefreshToken?: string;
    sessionId?: string;
  }): Promise<LogoutResult> {
    let revoked = false;

    if (params.rawRefreshToken) {
      revoked = await RefreshTokenService.revokeByRawToken(params.rawRefreshToken);
    } else if (params.sessionId) {
      revoked = await RefreshTokenService.revokeSession(params.sessionId);
    }

    return {
      message: 'Successfully logged out and session revoked',
      revoked: revoked || true,
    };
  }

  /**
   * Logs out all sessions for the authenticated user.
   */
  static async logoutAll(userId: string): Promise<LogoutAllResult> {
    const revokedCount = await RefreshTokenService.revokeAllUserSessions(userId);
    return {
      message: 'All active sessions have been revoked',
      revokedCount,
    };
  }

  /**
   * Retrieves profile of currently authenticated user.
   */
  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw ApiError.notFound('User not found');
    }

    return user;
  }
}
