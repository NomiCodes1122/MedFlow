import { Request, Response, NextFunction } from 'express';
import { logger } from '../logging/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = req.startTime || Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    const logData = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode,
      durationMs,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    if (statusCode >= 500) {
      logger.error(logData, `HTTP ${req.method} ${req.originalUrl} ${statusCode} [${durationMs}ms]`);
    } else if (statusCode >= 400) {
      logger.warn(logData, `HTTP ${req.method} ${req.originalUrl} ${statusCode} [${durationMs}ms]`);
    } else {
      logger.info(logData, `HTTP ${req.method} ${req.originalUrl} ${statusCode} [${durationMs}ms]`);
    }
  });

  next();
}
