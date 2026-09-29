import crypto from 'crypto';
import jwt, { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { AccessTokenPayload } from './auth.types.js';

export class TokenService {
  /**
   * Signs a short-lived JSON Web Token for authenticated MedFlow requests.
   * Access tokens expire in 15 minutes by default.
   */
  static signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, config.jwt.accessSecret, {
      algorithm: 'HS256',
      expiresIn: config.jwt.accessExpiresIn as unknown as number,
    });
  }

  /**
   * Cryptographically verifies an access token.
   * Returns decoded payload or throws specific ApiError.
   */
  static verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.accessSecret, {
        algorithms: ['HS256'],
      }) as AccessTokenPayload;

      if (!decoded.sub || !decoded.role || !decoded.sessionId) {
        throw ApiError.authInvalidToken('Malformed access token claims');
      }

      return decoded;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw ApiError.authTokenExpired('Access token has expired');
      }
      if (error instanceof JsonWebTokenError) {
        throw ApiError.authInvalidToken('Invalid access token');
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw ApiError.authInvalidToken('Failed to verify access token');
    }
  }

  /**
   * Generates a cryptographically strong, 256-bit random refresh token.
   */
  static generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Computes a SHA-256 digest of the raw refresh token for safe database persistence.
   * Raw refresh tokens are NEVER stored in plaintext in the database.
   */
  static hashRefreshToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  static constantTimeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
