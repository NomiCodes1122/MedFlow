import { z } from 'zod';
import { TriageCategory, TriageSource } from '@prisma/client';

export const createTriageAssessmentSchema = z
  .object({
    protocolCode: z
      .string()
      .trim()
      .min(1, 'protocolCode is required')
      .max(32, 'protocolCode cannot exceed 32 characters')
      .default('START'),
    protocolVersion: z
      .string()
      .trim()
      .min(1, 'protocolVersion is required')
      .max(16, 'protocolVersion cannot exceed 16 characters')
      .default('1.0.0'),
    careSetting: z
      .enum(['PRE_HOSPITAL', 'HOSPITAL'])
      .optional()
      .default('PRE_HOSPITAL'),
    calculatedCategory: z.nativeEnum(TriageCategory, {
      errorMap: () => ({
        message: 'calculatedCategory must be one of: RED, YELLOW, GREEN, BLACK, UNASSESSED',
      }),
    }),
    overriddenCategory: z.nativeEnum(TriageCategory).optional().nullable(),
    overrideReason: z
      .string()
      .trim()
      .max(1000, 'overrideReason cannot exceed 1000 characters')
      .optional()
      .nullable(),
    assessmentData: z.record(z.any()).optional().nullable(),
    decisionTrace: z.record(z.any()).optional().nullable(),
    assessmentSource: z
      .nativeEnum(TriageSource)
      .optional()
      .default(TriageSource.FIELD_START),
    assessedAt: z
      .string()
      .datetime({ message: 'assessedAt must be a valid ISO 8601 date string' })
      .refine(
        (val) => new Date(val).getTime() <= Date.now() + 30 * 60 * 1000,
        { message: 'assessedAt cannot be more than 30 minutes in the future' }
      )
      .optional(),
    expectedPatientVersion: z
      .number()
      .int('expectedPatientVersion must be an integer')
      .min(1, 'expectedPatientVersion must be at least 1')
      .optional(),

    // Legacy/START observation input compatibility
    canWalk: z.boolean().optional().nullable(),
    hasRespirations: z.boolean().optional().nullable(),
    respiratoryRate: z
      .number()
      .int('respiratoryRate must be an integer')
      .min(0, 'respiratoryRate cannot be negative')
      .max(100, 'respiratoryRate cannot exceed 100 breaths/min')
      .optional()
      .nullable(),
    radialPulse: z.boolean().optional().nullable(),
    capillaryRefillSec: z
      .number()
      .min(0, 'capillaryRefillSec cannot be negative')
      .max(20, 'capillaryRefillSec cannot exceed 20 seconds')
      .optional()
      .nullable(),
    followsCommands: z.boolean().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    // If an overridden category is specified and differs from the calculated category, an explicit reason is strictly mandatory.
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

export const triageHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const triageQueueQuerySchema = z.object({
  incidentId: z.string().uuid('incidentId must be a valid UUID').optional(),
  category: z.nativeEnum(TriageCategory).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateTriageAssessmentDto = z.infer<typeof createTriageAssessmentSchema>;
export type TriageHistoryQueryDto = z.infer<typeof triageHistoryQuerySchema>;
export type TriageQueueQueryDto = z.infer<typeof triageQueueQuerySchema>;
