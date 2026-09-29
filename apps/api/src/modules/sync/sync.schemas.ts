import { z } from 'zod';
import { SyncEntityType, SyncOpType } from '@prisma/client';

export const syncOperationSchema = z.object({
  operationId: z.string().uuid({ message: 'operationId must be a valid UUID' }),
  entityType: z.nativeEnum(SyncEntityType, {
    errorMap: () => ({ message: 'entityType must be one of: PATIENT, OBSERVATION, TRIAGE, INVENTORY, MEDIA' }),
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
