import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { AuthService } from './auth.service.js';

export class AuthController {
  /**
   * POST /api/v1/auth/session
   * Establishes a MedFlow application session from a verified Firebase ID token.
   */
  static async establishSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      let idToken = req.body?.idToken;

      // Allow Bearer token in Authorization header if not in body
      if (!idToken && req.headers.authorization?.startsWith('Bearer ')) {
        idToken = req.headers.authorization.slice(7);
      }

      if (!idToken) {
        throw ApiError.authInvalidToken('Firebase ID token is required');
      }

      const result = await AuthService.establishSession({
        idToken,
        device: req.body?.device,
      });

      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/refresh
   * Rotates a single-use refresh token and issues a new access token.
   */
  static async refreshSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const refreshToken = req.body?.refreshToken;

      if (!refreshToken) {
        throw ApiError.authInvalidRefreshToken('Refresh token is required');
      }

      const result = await AuthService.refreshSession(refreshToken);
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/logout
   * Revokes the specified refresh token or current authenticated session.
   */
  static async logout(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const rawRefreshToken = req.body?.refreshToken;
      const sessionId = req.auth?.sessionId;

      if (!rawRefreshToken && !sessionId) {
        throw ApiError.badRequest('Either a refreshToken in body or Bearer token is required to logout');
      }

      const result = await AuthService.logout({
        rawRefreshToken,
        sessionId,
      });

      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/auth/logout-all
   * Revokes all active sessions for the authenticated user.
   */
  static async logoutAll(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.auth) {
        throw ApiError.authRequired('Authentication required to revoke all sessions');
      }

      const result = await AuthService.logoutAll(req.auth.userId);
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/auth/me
   * Returns profile of currently authenticated user.
   */
  static async getMe(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.auth) {
        throw ApiError.authRequired('Authentication required');
      }

      const user = await AuthService.getMe(req.auth.userId);
      ApiResponse.success(res, user, 200);
    } catch (error) {
      next(error);
    }
  }
}
