import express, { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validate } from '../../common/validation/validate.js';
import { requireAuthentication, requireRoles } from '../auth/auth.middleware.js';
import {
  createMediaSchema,
  patientMediaParamsSchema,
  mediaParamsSchema,
  mediaListQuerySchema,
  verifyMediaSchema,
} from './media.schemas.js';
import { MediaController } from './media.controller.js';

/**
 * Router mounted at /api/v1/patients/:id/media
 */
export const patientMediaRouter = Router({ mergeParams: true });

patientMediaRouter.use(requireAuthentication);

/**
 * POST /api/v1/patients/:id/media
 * Initiates upload and returns a pre-signed URL (Paramedic, Triage Doctor)
 */
patientMediaRouter.post(
  '/',
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  validate({ params: patientMediaParamsSchema, body: createMediaSchema }),
  MediaController.initiateUpload
);

/**
 * GET /api/v1/patients/:id/media
 * Lists all media attachments for a patient (Paramedic, Doctor, Superintendent)
 */
patientMediaRouter.get(
  '/',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: patientMediaParamsSchema, query: mediaListQuerySchema }),
  MediaController.listPatientMedia
);

/**
 * Router mounted at /api/v1/media
 */
export const mediaRouter = Router();

mediaRouter.use(requireAuthentication);

/**
 * GET /api/v1/media/:id
 * Retrieves media metadata and signed access URL
 */
mediaRouter.get(
  '/:id',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: mediaParamsSchema }),
  MediaController.getMedia
);

/**
 * POST /api/v1/media/:id/upload
 * Direct binary upload endpoint with magic bytes inspection (Paramedic, Doctor, Superintendent)
 */
mediaRouter.post(
  '/:id/upload',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: mediaParamsSchema }),
  express.raw({ type: ['image/*', 'audio/*'], limit: '6mb' }),
  MediaController.directUpload
);

/**
 * POST /api/v1/media/:id/verify
 * Confirms that upload completed in storage
 */
mediaRouter.post(
  '/:id/verify',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: mediaParamsSchema, body: verifyMediaSchema }),
  MediaController.verifyUpload
);

/**
 * DELETE /api/v1/media/:id
 * Deletes media attachment from cloud storage and database (Uploader or Superintendent)
 */
mediaRouter.delete(
  '/:id',
  requireRoles([
    UserRole.PARAMEDIC,
    UserRole.TRIAGE_DOCTOR,
    UserRole.HOSPITAL_SUPERINTENDENT,
  ]),
  validate({ params: mediaParamsSchema }),
  MediaController.deleteMedia
);
