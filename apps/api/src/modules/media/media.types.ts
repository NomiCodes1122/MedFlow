import { MediaType, MediaStatus } from '@prisma/client';

export { MediaType, MediaStatus };

export interface CreateMediaInput {
  mediaType: MediaType;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds?: number | null;
  checksumSha256?: string | null;
  clientCapturedAt: Date;
}

export interface MediaResponse {
  id: string;
  patientId: string;
  uploadedBy: string;
  mediaType: MediaType;
  storagePath: string;
  publicUrl: string | null;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
  checksumSha256: string | null;
  status: MediaStatus;
  clientCapturedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaUploadInitiateResult {
  media: MediaResponse;
  uploadUrl: string;
  expiresInMinutes: number;
}

export interface MediaQueryFilters {
  mediaType?: MediaType;
  status?: MediaStatus;
  page?: number;
  limit?: number;
}

export interface StorageObjectMetadata {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
}

export interface IStorageProvider {
  generateUploadUrl(
    storagePath: string,
    mimeType: string,
    expiresInMinutes?: number
  ): Promise<string>;

  generateDownloadUrl(
    storagePath: string,
    expiresInMinutes?: number
  ): Promise<string>;

  verifyObject(storagePath: string): Promise<StorageObjectMetadata>;

  uploadBuffer(
    storagePath: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string>;

  deleteObject(storagePath: string): Promise<boolean>;
}
