import { z } from 'zod';
import { Gender, PatientStatus, TriageCategory, VitalSource } from '@prisma/client';

export const patientParamsSchema = z.object({
  id: z.string().uuid('Invalid patient identifier format. Must be a valid UUID.'),
});

export const createPatientSchema = z.object({
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
  gender: z.nativeEnum(Gender).default(Gender.UNKNOWN),
  status: z.nativeEnum(PatientStatus).default(PatientStatus.FIELD_INTAKE),
  chiefComplaint: z.string().trim().max(2000, 'Chief complaint cannot exceed 2000 characters').optional().nullable(),
  notes: z.string().trim().max(5000, 'Notes cannot exceed 5000 characters').optional().nullable(),
  clientCreatedAt: z
    .string()
    .datetime({ message: 'clientCreatedAt must be a valid ISO 8601 date string' })
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
});

export const updatePatientSchema = z.object({
  version: z
    .number({ required_error: 'version is required for optimistic concurrency control' })
    .int('version must be an integer')
    .min(1, 'version must be at least 1'),
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
});

export const patientListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  incidentId: z.string().uuid('incidentId filter must be a valid UUID').optional(),
  status: z.nativeEnum(PatientStatus).optional(),
  triageCategory: z.nativeEnum(TriageCategory).optional(),
});

export const createVitalSignSchema = z.object({
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
  source: z.nativeEnum(VitalSource).default(VitalSource.PARAMEDIC_FIELD),
  recordedAt: z
    .string()
    .datetime({ message: 'recordedAt must be a valid ISO 8601 date string' })
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
});

export type PatientParamsInput = z.infer<typeof patientParamsSchema>;
export type CreatePatientSchemaInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientSchemaInput = z.infer<typeof updatePatientSchema>;
export type PatientListQueryInput = z.infer<typeof patientListQuerySchema>;
export type CreateVitalSignSchemaInput = z.infer<typeof createVitalSignSchema>;
