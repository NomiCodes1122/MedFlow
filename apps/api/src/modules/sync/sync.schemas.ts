import { z } from 'zod';
import {
  Gender,
  PatientStatus,
  SyncEntityType,
  SyncOpType,
  TriageCategory,
  TriageSource,
} from '@prisma/client';

export const syncPatientCreatePayloadSchema = z.object({
  demoId: z
    .string()
    .trim()
    .min(1, 'demoId cannot be empty')
    .max(32, 'demoId cannot exceed 32 characters')
    .optional(),
  incidentId: z.string().uuid('incidentId must be a valid UUID').optional().nullable(),
  firstName: z.string().trim().max(64, 'First name cannot exceed 64 characters').optional().nullable(),
  lastName: z.string().trim().max(64, 'Last name cannot exceed 64 characters').optional().nullable(),
  estimatedAge: z
    .number()
    .int('Estimated age must be an integer')
    .min(0, 'Estimated age cannot be negative')
    .max(130, 'Estimated age cannot exceed 130')
    .optional()
    .nullable(),
  gender: z.nativeEnum(Gender).optional(),
  status: z.nativeEnum(PatientStatus).optional(),
  chiefComplaint: z.string().trim().max(2000, 'Chief complaint cannot exceed 2000 characters').optional().nullable(),
  notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').optional().nullable(),
  clientCreatedAt: z
    .string()
    .datetime({ message: 'clientCreatedAt must be a valid ISO 8601 date string' })
    .optional(),
});

export const syncPatientUpdatePayloadSchema = z.object({
  version: z
    .number({ required_error: 'version is required for optimistic concurrency control' })
    .int('version must be an integer')
    .min(1, 'version must be at least 1')
    .optional(),
  incidentId: z.string().uuid('incidentId must be a valid UUID').optional().nullable(),
  firstName: z.string().trim().max(64, 'First name cannot exceed 64 characters').optional().nullable(),
  lastName: z.string().trim().max(64, 'Last name cannot exceed 64 characters').optional().nullable(),
  estimatedAge: z
    .number()
    .int('Estimated age must be an integer')
    .min(0, 'Estimated age cannot be negative')
    .max(130, 'Estimated age cannot exceed 130')
    .optional()
    .nullable(),
  gender: z.nativeEnum(Gender).optional(),
  status: z.nativeEnum(PatientStatus).optional(),
  // NOTE: currentTriageCategory is intentionally excluded.
  // Triage category must only change via a TRIAGE entity operation that creates an
  // immutable assessment record. Allowing direct category edits here would break the
  // pointer/category consistency invariant (D-04 remediation).
  chiefComplaint: z.string().trim().max(2000, 'Chief complaint cannot exceed 2000 characters').optional().nullable(),
  notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').optional().nullable(),
});

export const syncVitalCreatePayloadSchema = z.object({
  patientId: z.string().uuid('patientId must be a valid UUID').optional(),
  systolicBp: z
    .number()
    .int('Systolic BP must be an integer')
    .min(30, 'Systolic BP must be between 30 and 300 mmHg')
    .max(300, 'Systolic BP must be between 30 and 300 mmHg')
    .optional()
    .nullable(),
  diastolicBp: z
    .number()
    .int('Diastolic BP must be an integer')
    .min(10, 'Diastolic BP must be between 10 and 200 mmHg')
    .max(200, 'Diastolic BP must be between 10 and 200 mmHg')
    .optional()
    .nullable(),
  heartRate: z
    .number()
    .int('Heart rate must be an integer')
    .min(20, 'Heart rate must be between 20 and 300 bpm')
    .max(300, 'Heart rate must be between 20 and 300 bpm')
    .optional()
    .nullable(),
  respiratoryRate: z
    .number()
    .int('Respiratory rate must be an integer')
    .min(0, 'Respiratory rate must be between 0 and 80 breaths/min')
    .max(80, 'Respiratory rate must be between 0 and 80 breaths/min')
    .optional()
    .nullable(),
  oxygenSaturation: z
    .number()
    .min(40.0, 'Oxygen saturation must be between 40.0% and 100.0%')
    .max(100.0, 'Oxygen saturation must be between 40.0% and 100.0%')
    .optional()
    .nullable(),
  temperature: z
    .number()
    .min(25.0, 'Temperature must be between 25.0 and 45.0 °C')
    .max(45.0, 'Temperature must be between 25.0 and 45.0 °C')
    .optional()
    .nullable(),
  gcsScore: z
    .number()
    .int('Glasgow Coma Scale score must be an integer')
    .min(3, 'GCS score must be between 3 and 15')
    .max(15, 'GCS score must be between 3 and 15')
    .optional()
    .nullable(),
  recordedAt: z
    .string()
    .datetime({ message: 'recordedAt must be a valid ISO 8601 date string' })
    .optional(),
});

/** Maximum allowed clock skew for client-reported timestamps (30 minutes). */
const MAX_FUTURE_SKEW_MS = 30 * 60 * 1000;

export const syncTriageCreatePayloadSchema = z
  .object({
    patientId: z.string().uuid('patientId must be a valid UUID').optional(),
    protocolCode: z.string().trim().min(1).max(32).default('START'),
    protocolVersion: z.string().trim().min(1).max(16).default('1.0.0'),
    careSetting: z.string().trim().max(32).default('PRE_HOSPITAL'),
    calculatedCategory: z.nativeEnum(TriageCategory, {
      errorMap: () => ({ message: 'calculatedCategory must be a valid TriageCategory' }),
    }),
    overriddenCategory: z.nativeEnum(TriageCategory).optional().nullable(),
    overrideReason: z.string().trim().max(1000).optional().nullable(),
    assessmentData: z.record(z.any()).optional().nullable(),
    decisionTrace: z.record(z.any()).optional().nullable(),
    assessmentSource: z.nativeEnum(TriageSource).optional().default(TriageSource.FIELD_START),
    assessedAt: z
      .string()
      .datetime({ message: 'assessedAt must be a valid ISO 8601 date string' })
      .refine(
        (val) => new Date(val).getTime() <= Date.now() + MAX_FUTURE_SKEW_MS,
        { message: 'assessedAt cannot be more than 30 minutes in the future' }
      )
      .optional(),
    canWalk: z.boolean().optional().nullable(),
    hasRespirations: z.boolean().optional().nullable(),
    respiratoryRate: z.number().int().min(0).max(100).optional().nullable(),
    radialPulse: z.boolean().optional().nullable(),
    capillaryRefillSec: z.number().min(0).max(20).optional().nullable(),
    followsCommands: z.boolean().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // D-02: Mirror the direct API cross-field override/reason validation.
    // An overridden category that differs from the calculated category requires
    // an explicit, descriptive overrideReason (minimum 5 characters).
    if (data.overriddenCategory && data.overriddenCategory !== data.calculatedCategory) {
      if (!data.overrideReason || data.overrideReason.trim().length < 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['overrideReason'],
          message:
            'A descriptive overrideReason (minimum 5 characters) is required when specifying an overridden clinical category.',
        });
      }
    }
  });

export const syncOperationSchema = z.object({
  operationId: z.string().uuid({ message: 'operationId must be a valid UUID' }),
  entityType: z.nativeEnum(SyncEntityType, {
    errorMap: () => ({ message: 'entityType must be one of: PATIENT, OBSERVATION, TRIAGE, INVENTORY, MEDIA, ALERT, NOTIFICATION' }),
  }),
  entityId: z.string().uuid({ message: 'entityId must be a valid UUID' }),
  operationType: z.nativeEnum(SyncOpType, {
    errorMap: () => ({ message: 'operationType must be one of: CREATE, UPDATE, DELETE' }),
  }),
  clientTimestamp: z.string().datetime({ message: 'clientTimestamp must be a valid ISO-8601 datetime' }),
  baseVersion: z.number().int().positive({ message: 'baseVersion must be a positive integer' }).optional(),
  payload: z.record(z.any(), { message: 'payload must be a JSON object' }),
});

export const syncBatchSchema = z.object({
  deviceId: z
    .string()
    .min(1, { message: 'deviceId is required' })
    .max(64, { message: 'deviceId must not exceed 64 characters' }),
  clientBatchTimestamp: z.string().datetime({ message: 'clientBatchTimestamp must be a valid ISO-8601 datetime' }),
  operations: z
    .array(syncOperationSchema)
    .min(1, { message: 'operations array must contain at least 1 mutation' })
    .max(50, { message: 'operations batch cannot exceed 50 mutations' }),
});

export type SyncOperationSchema = z.infer<typeof syncOperationSchema>;
export type SyncBatchSchema = z.infer<typeof syncBatchSchema>;

export function validateSyncPayload(
  entityType: SyncEntityType,
  operationType: SyncOpType,
  payload: unknown
): { success: true; data: any } | { success: false; errors: string[] } {
  let schema: z.ZodTypeAny;

  if (entityType === SyncEntityType.PATIENT) {
    if (operationType === SyncOpType.CREATE) {
      schema = syncPatientCreatePayloadSchema;
    } else if (operationType === SyncOpType.UPDATE) {
      schema = syncPatientUpdatePayloadSchema;
    } else {
      return { success: false, errors: [`Operation ${operationType} on PATIENT is not supported in Phase 7`] };
    }
  } else if (entityType === SyncEntityType.OBSERVATION) {
    if (operationType === SyncOpType.CREATE) {
      schema = syncVitalCreatePayloadSchema;
    } else {
      return { success: false, errors: [`Operation ${operationType} on OBSERVATION is not supported in Phase 7`] };
    }
  } else if (entityType === SyncEntityType.TRIAGE) {
    if (operationType === SyncOpType.CREATE) {
      schema = syncTriageCreatePayloadSchema;
    } else {
      return { success: false, errors: [`Operation ${operationType} on TRIAGE is not supported`] };
    }
  } else if (entityType === SyncEntityType.ALERT) {
    if (operationType === SyncOpType.UPDATE) {
      schema = z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED']) });
    } else {
      return { success: false, errors: [`Operation ${operationType} on ALERT is not supported`] };
    }
  } else if (entityType === SyncEntityType.NOTIFICATION) {
    if (operationType === SyncOpType.UPDATE) {
      schema = z.object({ read: z.boolean() });
    } else {
      return { success: false, errors: [`Operation ${operationType} on NOTIFICATION is not supported`] };
    }
  } else {
    return { success: false, errors: [`Entity ${entityType} is not supported`] };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    const errorMessages = result.error.errors.map((e) => `${e.path.join('.') || 'payload'}: ${e.message}`);
    return { success: false, errors: errorMessages };
  }

  return { success: true, data: result.data };
}
