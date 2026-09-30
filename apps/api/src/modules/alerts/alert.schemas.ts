import { z } from 'zod';
import { AlertType, AlertSeverity, AlertStatus } from '@prisma/client';

export const createAlertSchema = z.object({
  type: z.nativeEnum(AlertType),
  severity: z.nativeEnum(AlertSeverity),
  title: z.string().min(1).max(128),
  description: z.string().min(1).max(1000),
  patientId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export const updateAlertStatusSchema = z.object({
  status: z.nativeEnum(AlertStatus),
});

export const alertFiltersSchema = z.object({
  status: z.nativeEnum(AlertStatus).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  incidentId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});
