import { Router } from 'express';
import { validate } from '../../common/validation/validate.js';
import { sessionSchema, refreshSchema, logoutSchema } from './auth.schemas.js';
import { AuthController } from './auth.controller.js';
import { requireAuthentication } from './auth.middleware.js';
import { createAuthRateLimiter } from './auth.rate-limiter.js';

export const authRouter = Router();

// Rate limiters for authentication endpoints
const sessionLimiter = createAuthRateLimiter({
  prefix: 'auth-session',
  maxRequests: 10,
  windowSeconds: 60,
});

const refreshLimiter = createAuthRateLimiter({
  prefix: 'auth-refresh',
  maxRequests: 30,
  windowSeconds: 60,
});

const logoutLimiter = createAuthRateLimiter({
  prefix: 'auth-logout',
  maxRequests: 30,
  windowSeconds: 60,
});

/**
 * POST /api/v1/auth/session
 * Exchange verified Firebase ID token for MedFlow access & refresh credentials.
 */
authRouter.post(
  '/session',
  sessionLimiter,
  validate({ body: sessionSchema }),
  AuthController.establishSession
);

/**
 * POST /api/v1/auth/refresh
 * Single-use refresh token rotation with replay detection.
 */
authRouter.post(
  '/refresh',
  refreshLimiter,
  validate({ body: refreshSchema }),
  AuthController.refreshSession
);

/**
 * POST /api/v1/auth/logout
 * Invalidate current session/token.
 */
authRouter.post(
  '/logout',
  logoutLimiter,
  validate({ body: logoutSchema }),
  AuthController.logout
);

/**
 * POST /api/v1/auth/logout-all
 * Revoke all active sessions for authenticated user.
 */
authRouter.post(
  '/logout-all',
  logoutLimiter,
  requireAuthentication,
  AuthController.logoutAll
);

/**
 * GET /api/v1/auth/me
 * Retrieve profile of authenticated user.
 */
authRouter.get(
  '/me',
  requireAuthentication,
  AuthController.getMe
);
