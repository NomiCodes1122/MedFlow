import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuthentication } from '../auth/auth.middleware.js';
import { requireRoles } from '../auth/auth.middleware.js';
import { validate } from '../../common/validation/validate.js';
import { patientParamsSchema } from '../patients/patient.schemas.js';
import {
  createTriageAssessmentSchema,
  triageHistoryQuerySchema,
  triageQueueQuerySchema,
} from './triage.schemas.js';
import { TriageController } from './triage.controller.js';

/**
 * Global Triage Router
 * Mounted at: /api/v1/triage
 */
export const triageRouter = Router();

triageRouter.use(requireAuthentication);

/**
 * GET /api/v1/triage/queue
 * List active patients ordered by triage urgency category.
 */
triageRouter.get(
  '/queue',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ query: triageQueueQuerySchema }),
  TriageController.getQueue
);

/**
 * GET /api/v1/triage/protocols
 * List registered triage protocols with version and clinical approval metadata.
 */
triageRouter.get(
  '/protocols',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  TriageController.getProtocols
);

/**
 * Patient-scoped Triage Router
 * Mounted at: /api/v1/patients/:id/triage
 */
export const patientTriageRouter = Router({ mergeParams: true });

patientTriageRouter.use(requireAuthentication);

/**
 * POST /api/v1/patients/:id/triage
 * Record an immutable triage assessment or reassessment for a patient.
 */
patientTriageRouter.post(
  '/',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({
    params: patientParamsSchema,
    body: createTriageAssessmentSchema,
  }),
  TriageController.createAssessment
);

/**
 * GET /api/v1/patients/:id/triage/history
 * Retrieve full chronological assessment history for a patient.
 */
patientTriageRouter.get(
  '/history',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({
    params: patientParamsSchema,
    query: triageHistoryQuerySchema,
  }),
  TriageController.getPatientHistory
);

/**
 * GET /api/v1/patients/:id/triage
 * Alias for patient triage assessment history.
 */
patientTriageRouter.get(
  '/',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({
    params: patientParamsSchema,
    query: triageHistoryQuerySchema,
  }),
  TriageController.getPatientHistory
);
