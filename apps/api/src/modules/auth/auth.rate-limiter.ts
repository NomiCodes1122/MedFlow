import { Request, Response, NextFunction } from 'express';
import { getRedisClient, checkRedisHealth } from '../../cache/redis.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';

interface MemoryRateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, MemoryRateLimitRecord>();

// Clean up memory store every 5 minutes to prevent leaks in long-running tests/dev
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (record.resetAt <= now) {
      memoryStore.delete(key);
    }
  }
}, 300000).unref();

export interface RateLimitOptions {
  windowSeconds: number;
  maxRequests: number;
  prefix: string;
}

/**
 * High-value endpoint rate limiter.
 *
 * Operational Mode:
 * - Distributed sliding window when Redis Cloud is connected.
 * - In-memory fallback when Redis is offline or running under unit tests.
 */
export function createAuthRateLimiter(options: RateLimitOptions) {
  const { windowSeconds, maxRequests, prefix } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const rateLimitKey = `rl:${prefix}:${clientIp}`;

    try {
      const isRedisHealthy = await checkRedisHealth();

      if (isRedisHealthy) {
        // --- 1. Distributed Redis Rate Limiting ---
        const redis = getRedisClient();
        const count = await redis.incr(rateLimitKey);

        if (count === 1) {
          await redis.expire(rateLimitKey, windowSeconds);
        }

        const ttl = await redis.ttl(rateLimitKey);
        const resetSeconds = ttl > 0 ? ttl : windowSeconds;

        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
        res.setHeader('X-RateLimit-Reset', resetSeconds);

        if (count > maxRequests) {
          logger.warn(
            { ip: clientIp, prefix, count, maxRequests },
            'Rate limit exceeded on authentication endpoint (Redis)'
          );
          return next(
            ApiError.rateLimited('Too many authentication requests, please try again later')
          );
        }

        return next();
      }
    } catch (redisError) {
      logger.warn(
        { err: redisError instanceof Error ? redisError.message : redisError },
        'Redis rate limiter encountered error, falling back to in-memory store'
      );
    }

    // --- 2. In-Memory Fallback Rate Limiting ---
    const now = Date.now();
    let record = memoryStore.get(rateLimitKey);

    if (!record || record.resetAt <= now) {
      record = {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      };
      memoryStore.set(rateLimitKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetSeconds = Math.ceil((record.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > maxRequests) {
      logger.warn(
        { ip: clientIp, prefix, count: record.count, maxRequests },
        'Rate limit exceeded on authentication endpoint (In-Memory)'
      );
      return next(
        ApiError.rateLimited('Too many authentication requests, please try again later')
      );
    }

    return next();
  };
}
