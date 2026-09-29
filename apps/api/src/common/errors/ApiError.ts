import { ErrorCodes, ErrorCode } from './errorCodes.js';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details?: unknown): ApiError {
    return new ApiError(400, ErrorCodes.BAD_REQUEST, message, details);
  }

  static validation(message = 'Validation failed', details?: unknown): ApiError {
    return new ApiError(400, ErrorCodes.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Unauthorized'): ApiError {
    return new ApiError(401, ErrorCodes.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, ErrorCodes.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, ErrorCodes.NOT_FOUND, message);
  }

  static conflict(message = 'Resource conflict'): ApiError {
    return new ApiError(409, ErrorCodes.CONFLICT, message);
  }

  static rateLimited(message = 'Too many requests, please try again later'): ApiError {
    return new ApiError(429, ErrorCodes.RATE_LIMITED, message);
  }

  static database(message = 'A database error occurred', details?: unknown): ApiError {
    return new ApiError(500, ErrorCodes.DATABASE_ERROR, message, details);
  }

  static internal(message = 'An unexpected internal server error occurred'): ApiError {
    return new ApiError(500, ErrorCodes.INTERNAL_ERROR, message);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable'): ApiError {
    return new ApiError(503, ErrorCodes.SERVICE_UNAVAILABLE, message);
  }

  // Authentication & Authorization (Phase 5)
  static authRequired(message = 'Authentication required', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_REQUIRED, message, details);
  }

  static authInvalidToken(message = 'Invalid authentication token', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_INVALID_TOKEN, message, details);
  }

  static authTokenExpired(message = 'Authentication token expired', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_TOKEN_EXPIRED, message, details);
  }

  static authSessionRevoked(message = 'Session has been revoked', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_SESSION_REVOKED, message, details);
  }

  static authUserInactive(message = 'User account is inactive or suspended', details?: unknown): ApiError {
    return new ApiError(403, ErrorCodes.AUTH_USER_INACTIVE, message, details);
  }

  static authUserNotFound(message = 'User account not found or not provisioned', details?: unknown): ApiError {
    return new ApiError(403, ErrorCodes.AUTH_USER_NOT_FOUND, message, details);
  }

  static authInvalidRefreshToken(message = 'Invalid or expired refresh token', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_INVALID_REFRESH_TOKEN, message, details);
  }

  static authRefreshTokenReused(message = 'Invalid refresh attempt: token reuse detected', details?: unknown): ApiError {
    return new ApiError(401, ErrorCodes.AUTH_REFRESH_TOKEN_REUSED, message, details);
  }

  static authForbidden(message = 'Access forbidden', details?: unknown): ApiError {
    return new ApiError(403, ErrorCodes.AUTH_FORBIDDEN, message, details);
  }

  static authRoleRequired(message = 'Insufficient permissions for this resource', details?: unknown): ApiError {
    return new ApiError(403, ErrorCodes.AUTH_ROLE_REQUIRED, message, details);
  }
}
