import { z } from 'zod';
import { MediaType, MediaStatus } from '@prisma/client';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
] as const;

export const ALLOWED_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_AUDIO_MIME_TYPES,
] as const;

export const MAX_PHOTO_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MIN_AUDIO_DURATION_SECONDS = 1;
export const MAX_AUDIO_DURATION_SECONDS = 120;

export const patientMediaParamsSchema = z.object({
  id: z.string().uuid('Invalid patient identifier format. Must be a valid UUID.'),
});

export const mediaParamsSchema = z.object({
  id: z.string().uuid('Invalid media identifier format. Must be a valid UUID.'),
});

export const createMediaSchema = z
  .object({
    mediaType: z.nativeEnum(MediaType, {
      errorMap: () => ({ message: "mediaType must be 'PHOTO' or 'AUDIO'" }),
    }),
    mimeType: z
      .string()
      .trim()
      .toLowerCase()
      .refine(
        (val) => (ALLOWED_MIME_TYPES as readonly string[]).includes(val),
        {
          message: `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`,
        }
      ),
    fileSizeBytes: z
      .number({ required_error: 'fileSizeBytes is required' })
      .int('fileSizeBytes must be an integer')
      .positive('fileSizeBytes must be greater than 0'),
    durationSeconds: z
      .number()
      .int('durationSeconds must be an integer')
      .min(MIN_AUDIO_DURATION_SECONDS, `durationSeconds must be at least ${MIN_AUDIO_DURATION_SECONDS}`)
      .max(MAX_AUDIO_DURATION_SECONDS, `durationSeconds cannot exceed ${MAX_AUDIO_DURATION_SECONDS}`)
      .optional()
      .nullable(),
    checksumSha256: z
      .string()
      .trim()
      .regex(/^[a-fA-F0-9]{64}$/, 'checksumSha256 must be a 64-character hexadecimal SHA-256 hash')
      .optional()
      .nullable(),
    clientCapturedAt: z
      .string({ required_error: 'clientCapturedAt timestamp is required' })
      .datetime({ message: 'clientCapturedAt must be a valid ISO 8601 date string' })
      .transform((val) => new Date(val)),
  })
  .superRefine((data, ctx) => {
    // 1. Cross-validate mediaType and mimeType
    if (data.mediaType === MediaType.PHOTO) {
      if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(data.mimeType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mimeType'],
          message: `Photo MIME type must be one of: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
        });
      }
      if (data.fileSizeBytes > MAX_PHOTO_FILE_SIZE_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fileSizeBytes'],
          message: `Photo file size cannot exceed 5 MB (${MAX_PHOTO_FILE_SIZE_BYTES} bytes)`,
        });
      }
    }

    if (data.mediaType === MediaType.AUDIO) {
      if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(data.mimeType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mimeType'],
          message: `Audio MIME type must be one of: ${ALLOWED_AUDIO_MIME_TYPES.join(', ')}`,
        });
      }
      if (data.fileSizeBytes > MAX_AUDIO_FILE_SIZE_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fileSizeBytes'],
          message: `Audio file size cannot exceed 2 MB (${MAX_AUDIO_FILE_SIZE_BYTES} bytes)`,
        });
      }
    }
  });

export const mediaListQuerySchema = z.object({
  mediaType: z.nativeEnum(MediaType).optional(),
  status: z.nativeEnum(MediaStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const verifyMediaSchema = z.object({
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/, 'checksumSha256 must be a 64-character hexadecimal SHA-256 hash')
    .optional(),
});

export type CreateMediaDto = z.infer<typeof createMediaSchema>;
export type MediaListQueryDto = z.infer<typeof mediaListQuerySchema>;
export type VerifyMediaDto = z.infer<typeof verifyMediaSchema>;
