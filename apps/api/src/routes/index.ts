import { Router, Request, Response } from 'express';
import { ApiResponse } from '../common/http/ApiResponse.js';
import { authRouter } from '../modules/auth/index.js';
import { patientRouter } from '../modules/patients/index.js';

import { syncRouter } from '../modules/sync/index.js';
import { mediaRouter } from '../modules/media/index.js';
import { triageRouter } from '../modules/triage/index.js';
import { alertRouter } from '../modules/alerts/index.js';
import { notificationRouter } from '../modules/notifications/index.js';
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

// Patient Domain Routes (Phase 6)
apiV1Router.use('/patients', patientRouter);

// Offline Sync Routes (Phase 7)
apiV1Router.use('/sync', syncRouter);

// Multimedia Upload & Metadata Routes (Phase 8)
apiV1Router.use('/media', mediaRouter);

// Clinical Triage Routes (Phase 9)
apiV1Router.use('/triage', triageRouter);

// Alerts & Notifications Routes (Phase 10)
apiV1Router.use('/alerts', alertRouter);
apiV1Router.use('/notifications', notificationRouter);
