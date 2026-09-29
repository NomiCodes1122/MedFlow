import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from './ApiError.js';
import { ErrorCodes } from './errorCodes.js';
import { ApiResponse } from '../http/ApiResponse.js';
import { logger } from '../logging/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.id;

  // 1. ApiError (Expected domain/operational errors)
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(
        { err, requestId, path: req.originalUrl, method: req.method },
        `ApiError [${err.statusCode}] ${err.code}: ${err.message}`
      );
    } else {
      logger.warn(
        { requestId, code: err.code, details: err.details },
        `ApiError [${err.statusCode}] ${err.code}: ${err.message}`
      );
    }

    ApiResponse.error(res, err.statusCode, err.code, err.message, requestId, err.details);
    return;
  }

  // 2. Zod Validation Error (Direct or uncaught)
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      rule: e.code,
    }));

    logger.warn({ requestId, errors: formattedErrors }, 'Validation error caught in errorHandler');
    ApiResponse.error(
      res,
      400,
      ErrorCodes.VALIDATION_ERROR,
      'Invalid request data',
      requestId,
      formattedErrors
    );
    return;
  }

  // 3. Prisma Known Request Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error(
      { errCode: err.code, errMeta: err.meta, requestId },
      `Prisma Known Request Error: ${err.code}`
    );

    switch (err.code) {
      case 'P2002': {
        const target = Array.isArray(err.meta?.target) ? err.meta?.target.join(', ') : 'field';
        ApiResponse.error(
          res,
          409,
          ErrorCodes.CONFLICT,
          `A record with this ${target} already exists`,
          requestId
        );
        return;
      }
      case 'P2025': {
        ApiResponse.error(res, 404, ErrorCodes.NOT_FOUND, 'Requested resource was not found', requestId);
        return;
      }
      case 'P2003': {
        ApiResponse.error(
          res,
          400,
          ErrorCodes.DATABASE_ERROR,
          'Referential integrity constraint violation',
          requestId
        );
        return;
      }
      default: {
        ApiResponse.error(
          res,
          500,
          ErrorCodes.DATABASE_ERROR,
          'A database operation error occurred',
          requestId
        );
        return;
      }
    }
  }

  // 4. JSON Syntax Error (Malformed request body)
  if (err instanceof SyntaxError && 'status' in err && (err as { status: number }).status === 400) {
    logger.warn({ requestId, err: err.message }, 'Malformed JSON body');
    ApiResponse.error(res, 400, ErrorCodes.BAD_REQUEST, 'Malformed JSON payload in request body', requestId);
    return;
  }

  // 5. Unknown / Internal Server Error
  const errorMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  logger.error(
    { err, message: errorMessage, stack, requestId, path: req.originalUrl, method: req.method },
    'Unhandled server exception'
  );

  ApiResponse.error(
    res,
    500,
    ErrorCodes.INTERNAL_ERROR,
    'An unexpected internal server error occurred',
    requestId
  );
}
