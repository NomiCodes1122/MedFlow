import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validate } from '../../common/validation/validate.js';
import { requireAuthentication, requireRoles } from '../auth/auth.middleware.js';
import { syncBatchSchema } from './sync.schemas.js';
import { SyncController } from './sync.controller.js';

export const syncRouter = Router();

// All sync endpoints require valid MedFlow authentication
syncRouter.use(requireAuthentication);

/**
 * POST /api/v1/sync/batch
 * Submits a batch of offline-queued operations for atomic, idempotent synchronization.
 * Restricted to frontline operational roles: PARAMEDIC and TRIAGE_DOCTOR.
 */
syncRouter.post(
  '/batch',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({ body: syncBatchSchema }),
  SyncController.processBatch
);
