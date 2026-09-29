import { z } from 'zod';
import { DevicePlatform } from '@prisma/client';

export const sessionSchema = z.object({
  idToken: z.string().min(1, 'Firebase ID token is required'),
  device: z
    .object({
      id: z.string().uuid('Device ID must be a valid UUID').optional(),
      platform: z.nativeEnum(DevicePlatform),
      appVersion: z.string().min(1).max(32).default('1.0.0'),
      pushToken: z.string().optional().nullable(),
    })
    .optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export type SessionSchemaInput = z.infer<typeof sessionSchema>;
export type RefreshSchemaInput = z.infer<typeof refreshSchema>;
export type LogoutSchemaInput = z.infer<typeof logoutSchema>;
