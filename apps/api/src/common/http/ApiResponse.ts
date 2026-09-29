import { Response } from 'express';
import { ErrorCode } from '../errors/errorCodes.js';

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorDetail {
  code: ErrorCode;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface ApiErrorEnvelope {
  success: false;
  error: ApiErrorDetail;
}

export class ApiResponse {
  static success<T>(
    res: Response,
    data: T,
    statusCode = 200,
    meta?: Record<string, unknown>
  ): Response<ApiSuccessEnvelope<T>> {
    const payload: ApiSuccessEnvelope<T> = {
      success: true,
      data,
      ...(meta ? { meta } : {}),
    };
    return res.status(statusCode).json(payload);
  }

  static created<T>(res: Response, data: T): Response<ApiSuccessEnvelope<T>> {
    return this.success(res, data, 201);
  }

  static paginated<T>(
    res: Response,
    items: T[],
    page: number,
    limit: number,
    total: number
  ): Response<ApiSuccessEnvelope<T[]>> {
    return this.success(res, items, 200, {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  }

  static error(
    res: Response,
    statusCode: number,
    code: ErrorCode,
    message: string,
    requestId?: string,
    details?: unknown
  ): Response<ApiErrorEnvelope> {
    const payload: ApiErrorEnvelope = {
      success: false,
      error: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
        ...(details ? { details } : {}),
      },
    };
    return res.status(statusCode).json(payload);
  }
}
