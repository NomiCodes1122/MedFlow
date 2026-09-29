import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-]{8,64}$/;

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingId = req.headers['x-request-id'];

  let validId: string | null = null;
  if (typeof incomingId === 'string' && REQUEST_ID_REGEX.test(incomingId)) {
    validId = incomingId;
  }

  const requestId = validId || crypto.randomUUID();

  req.id = requestId;
  req.startTime = Date.now();
  res.setHeader('X-Request-ID', requestId);

  next();
}
