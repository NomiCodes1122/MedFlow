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
}
