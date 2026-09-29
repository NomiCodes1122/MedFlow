import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../errors/ApiError.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
