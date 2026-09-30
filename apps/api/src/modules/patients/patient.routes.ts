import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validate } from '../../common/validation/validate.js';
import { requireAuthentication, requireRoles } from '../auth/auth.middleware.js';
import {
  createPatientSchema,
  updatePatientSchema,
  patientParamsSchema,
  patientListQuerySchema,
  createVitalSignSchema,
} from './patient.schemas.js';
import { PatientController } from './patient.controller.js';
import { patientMediaRouter } from '../media/media.routes.js';
import { patientTriageRouter } from '../triage/triage.routes.js';

export const patientRouter = Router();

// All Patient Domain endpoints require valid MedFlow authentication
patientRouter.use(requireAuthentication);

/**
 * POST /api/v1/patients
 * Create new patient intake (Paramedic field intake or Triage Doctor hospital intake)
 */
patientRouter.post(
  '/',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({ body: createPatientSchema }),
  PatientController.createPatient
);

/**
 * GET /api/v1/patients
 * List patients with pagination and optional filters (All operational roles)
 */
patientRouter.get(
  '/',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ query: patientListQuerySchema }),
  PatientController.listPatients
);

/**
 * GET /api/v1/patients/:id
 * Retrieve patient by UUID (All operational roles)
 */
patientRouter.get(
  '/:id',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: patientParamsSchema }),
  PatientController.getPatient
);

/**
 * PATCH /api/v1/patients/:id
 * Partial update of patient with Optimistic Concurrency Control (OCC)
 */
patientRouter.patch(
  '/:id',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({ params: patientParamsSchema, body: updatePatientSchema }),
  PatientController.updatePatient
);

/**
 * POST /api/v1/patients/:id/vitals
 * Append a new clinical vital sign observation (Paramedic, Triage Doctor)
 */
patientRouter.post(
  '/:id/vitals',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({ params: patientParamsSchema, body: createVitalSignSchema }),
  PatientController.createVital
);

/**
 * GET /api/v1/patients/:id/vitals
 * Retrieve chronological vital signs history for a patient (All operational roles)
 */
patientRouter.get(
  '/:id/vitals',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: patientParamsSchema }),
  PatientController.getVitals
);

/**
 * Media Attachments (Phase 8)
 * Mounted at /api/v1/patients/:id/media
 */
patientRouter.use('/:id/media', patientMediaRouter);

/**
 * Triage Assessments & History (Phase 9)
 * Mounted at /api/v1/patients/:id/triage
 */
patientRouter.use('/:id/triage', patientTriageRouter);

