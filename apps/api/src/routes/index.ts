import { Router, Request, Response } from 'express';
import { ApiResponse } from '../common/http/ApiResponse.js';
import { authRouter } from '../modules/auth/index.js';

export const apiV1Router = Router();

/**
 * Root endpoint for /api/v1
 * Provides API information and documentation pointer.
 */
apiV1Router.get('/', (_req: Request, res: Response) => {
  return ApiResponse.success(res, {
    name: 'MedFlow Disaster Response Command System API',
    version: 'v1',
    description: 'Emergency Telehealth & Field Telemetry Real-time Gateway',
    documentation: '/docs',
  });
});

// Authentication & Session Routes (Phase 5)
apiV1Router.use('/auth', authRouter);

