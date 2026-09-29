import { Router, Request, Response } from 'express';
import { ApiResponse } from '../common/http/ApiResponse.js';
import { checkPrismaHealth } from '../database/prisma.js';
import { checkRedisHealth } from '../cache/redis.js';
import { checkFirebaseHealth } from '../integrations/firebase/admin.js';
import { config } from '../config/index.js';

export const healthRouter = Router();

/**
 * GET /health
 * Liveness probe: Confirms that the Express process is up and accepting HTTP traffic.
 * Does NOT require external databases or third-party dependencies to be healthy.
 */
healthRouter.get('/health', (_req: Request, res: Response) => {
  return ApiResponse.success(res, {
    status: 'ok',
    service: 'medflow-api',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /ready
 * Readiness probe: Validates connectivity to critical infrastructure dependencies.
 * Probes:
 * 1. PostgreSQL via Prisma (SELECT 1)
 * 2. Redis Cloud via ping (PONG)
 * 3. Firebase Admin SDK initialization status
 * Returns HTTP 200 when ready, HTTP 503 when dependencies are unreachable.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [databaseHealthy, redisHealthy] = await Promise.all([
    checkPrismaHealth(),
    checkRedisHealth(),
  ]);

  const firebaseHealthy = checkFirebaseHealth();

  const dependencies = {
    database: databaseHealthy ? 'up' : 'down',
    redis: redisHealthy ? 'up' : 'down',
    firebase: config.firebase.isConfigured
      ? firebaseHealthy
        ? 'up'
        : 'down'
      : 'unconfigured',
  };

  // Readiness decision:
  // In development: if database is down because user hasn't configured live credentials yet,
  // we return 503 with explicit dependency status so container orchestrators / developers know state.
  const isReady = databaseHealthy && redisHealthy;

  const payload = {
    status: isReady ? 'ready' : 'not_ready',
    service: 'medflow-api',
    dependencies,
    timestamp: new Date().toISOString(),
  };

  if (!isReady) {
    return res.status(503).json({
      success: false,
      data: payload,
    });
  }

  return ApiResponse.success(res, payload);
});
