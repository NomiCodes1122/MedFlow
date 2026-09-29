import { Request, Response, NextFunction } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { AuthenticatedUserContext } from '../../types/express.js';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Reusable middleware that enforces valid application authentication.
 *
 * Responsibilities:
 * 1. Reads Authorization: Bearer <token>
 * 2. Cryptographically verifies JWT access token signature & expiration
 * 3. Verifies underlying session in database is not revoked
 * 4. Resolves authenticated MedFlow user from database
 * 5. Verifies user is active and not soft-deleted
 * 6. Attaches authenticated context to req.auth (and req.user)
 */
export async function requireAuthentication(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw ApiError.authRequired('Missing Authorization header');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      throw ApiError.authInvalidToken(
        'Malformed Authorization header. Format must be: Bearer <token>'
      );
    }

    const token = parts[1];

    // 1. Verify access token signature and expiration
    const decoded = TokenService.verifyAccessToken(token);

    // 2. Verify server-side session status (check for session revocation)
    const isSessionActive = await RefreshTokenService.isSessionActive(decoded.sessionId);
    if (!isSessionActive) {
      throw ApiError.authSessionRevoked(
        'Session has been revoked or expired. Please re-authenticate.'
      );
    }

    // 3. Resolve user from database to ensure fresh active status and authoritative role
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
    });

    if (!user) {
      throw ApiError.authUserNotFound('Authenticated user record not found');
    }

    if (user.status !== UserStatus.ACTIVE || user.deletedAt !== null) {
      throw ApiError.authUserInactive('User account is inactive, suspended, or deleted');
    }

    // 4. Attach authenticated user context
    const authContext: AuthenticatedUserContext = {
      userId: user.id,
      firebaseUid: user.firebaseUid,
      phone: user.phone,
      role: user.role, // Authoritative database role
      sessionId: decoded.sessionId,
      deviceId: decoded.deviceId || null,
    };

    req.auth = authContext;
    req.user = authContext;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * RBAC Guard: Requires a specific operational role.
 */
export function requireRole(requiredRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(ApiError.authRequired('Authentication required prior to role verification'));
    }

    if (req.auth.role !== requiredRole) {
      return next(
        ApiError.authRoleRequired(
          `Operation requires '${requiredRole}' role, current user has '${req.auth.role}'`
        )
      );
    }

    next();
  };
}

/**
 * RBAC Guard: Requires one of multiple permitted operational roles.
 */
export function requireRoles(allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      return next(ApiError.authRequired('Authentication required prior to role verification'));
    }

    if (!allowedRoles.includes(req.auth.role)) {
      return next(
        ApiError.authRoleRequired(
          `Operation requires one of [${allowedRoles.join(', ')}], current user has '${req.auth.role}'`
        )
      );
    }

    next();
  };
}
