import { randomUUID, createHash } from 'node:crypto';
import { PatientMedia, UserRole, MediaStatus, MediaType } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { AuthenticatedUserContext } from '../../types/express.js';
import {
  CreateMediaInput,
  MediaResponse,
  MediaUploadInitiateResult,
  MediaQueryFilters,
} from './media.types.js';
import { MediaRepository } from './media.repository.js';
import { MediaValidator } from './media.validator.js';
import { getStorageProvider } from './storage.provider.js';
import {
  MAX_PHOTO_FILE_SIZE_BYTES,
  MAX_AUDIO_FILE_SIZE_BYTES,
} from './media.schemas.js';

export class MediaService {
  /**
   * Initiates media attachment intake for a patient:
   * 1. Verifies patient exists.
   * 2. Allocates storage path according to architectural conventions.
   * 3. Generates time-limited pre-signed upload URL.
   * 4. Creates database record in PENDING_UPLOAD state.
   */
  static async initiateUpload(
    patientId: string,
    input: CreateMediaInput,
    userContext: AuthenticatedUserContext
  ): Promise<MediaUploadInitiateResult> {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, incidentId: true, deletedAt: true },
    });

    if (!patient || patient.deletedAt) {
      throw ApiError.notFound(`Patient with ID '${patientId}' not found`);
    }

    const mediaId = randomUUID();
    const extension = this.getExtensionForMime(input.mimeType);
    const incidentSegment = patient.incidentId ? `incidents/${patient.incidentId}` : 'general';
    const storagePath = `${incidentSegment}/patients/${patientId}/${mediaId}.${extension}`;

    const expiresInMinutes = 10;
    const storageProvider = getStorageProvider();

    let uploadUrl: string;
    try {
      uploadUrl = await storageProvider.generateUploadUrl(
        storagePath,
        input.mimeType,
        expiresInMinutes
      );
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error(
        { err: err.message, storagePath },
        'Failed to generate signed upload URL from storage provider'
      );
      throw ApiError.serviceUnavailable(`Cloud storage service is unavailable: ${err.message}`);
    }

    const mediaRecord = await MediaRepository.create({
      id: mediaId,
      patient: { connect: { id: patientId } },
      uploader: { connect: { id: userContext.userId } },
      mediaType: input.mediaType,
      storagePath,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      durationSeconds: input.durationSeconds ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      status: MediaStatus.PENDING_UPLOAD,
      clientCapturedAt: input.clientCapturedAt,
    });

    logger.info(
      {
        mediaId: mediaRecord.id,
        patientId,
        uploadedBy: userContext.userId,
        mediaType: input.mediaType,
      },
      'Media upload initiated successfully'
    );

    return {
      media: this.toMediaResponse(mediaRecord),
      uploadUrl,
      expiresInMinutes,
    };
  }

  /**
   * Direct binary upload endpoint:
   * Validates binary magic bytes and file limits, saves to storage, and marks VERIFIED.
   */
  static async directUpload(
    mediaId: string,
    buffer: Buffer,
    claimedMimeType: string,
    userContext: AuthenticatedUserContext
  ): Promise<MediaResponse> {
    const media = await MediaRepository.findById(mediaId);
    if (!media) {
      throw ApiError.notFound(`Media with ID '${mediaId}' not found`);
    }

    // Role check: Only uploader or authorized responders
    if (
      media.uploadedBy !== userContext.userId &&
      userContext.role !== UserRole.HOSPITAL_SUPERINTENDENT
    ) {
      throw ApiError.forbidden('You are not authorized to upload binary data for this media record');
    }

    // 1. File size limit validation
    if (media.mediaType === MediaType.PHOTO && buffer.length > MAX_PHOTO_FILE_SIZE_BYTES) {
      throw ApiError.badRequest(
        `Photo upload exceeds maximum permitted size of 5 MB (${buffer.length} bytes received)`
      );
    }
    if (media.mediaType === MediaType.AUDIO && buffer.length > MAX_AUDIO_FILE_SIZE_BYTES) {
      throw ApiError.badRequest(
        `Audio upload exceeds maximum permitted size of 2 MB (${buffer.length} bytes received)`
      );
    }

    // 2. Binary magic bytes validation
    const validation = MediaValidator.validateMagicBytes(buffer, claimedMimeType || media.mimeType);
    if (!validation.isValid) {
      await MediaRepository.update(mediaId, { status: MediaStatus.FAILED });
      throw ApiError.badRequest(
        `Binary file validation failed: ${validation.errorMessage || 'Invalid binary signature'}`
      );
    }

    // 3. Save to storage
    const storageProvider = getStorageProvider();
    const publicUrl = await storageProvider.uploadBuffer(
      media.storagePath,
      buffer,
      claimedMimeType || media.mimeType
    );

    // 4. Calculate checksum
    const computedChecksum = createHash('sha256').update(buffer).digest('hex');

    // 5. Update record
    const updated = await MediaRepository.update(mediaId, {
      status: MediaStatus.VERIFIED,
      fileSizeBytes: buffer.length,
      publicUrl,
      checksumSha256: computedChecksum,
    });

    logger.info(
      { mediaId, sizeBytes: buffer.length, checksum: computedChecksum },
      'Direct media binary upload verified and stored successfully'
    );

    return this.toMediaResponse(updated);
  }

  /**
   * Confirms and verifies an upload against storage.
   */
  static async verifyUpload(
    mediaId: string,
    checksumSha256?: string
  ): Promise<MediaResponse> {
    const media = await MediaRepository.findById(mediaId);
    if (!media) {
      throw ApiError.notFound(`Media with ID '${mediaId}' not found`);
    }

    const storageProvider = getStorageProvider();
    const objectMeta = await storageProvider.verifyObject(media.storagePath);

    if (!objectMeta.exists) {
      const updated = await MediaRepository.update(mediaId, {
        status: MediaStatus.FAILED,
      });
      return this.toMediaResponse(updated);
    }

    const downloadUrl = await storageProvider.generateDownloadUrl(media.storagePath, 60);

    const updated = await MediaRepository.update(mediaId, {
      status: MediaStatus.VERIFIED,
      publicUrl: downloadUrl,
      ...(checksumSha256 ? { checksumSha256 } : {}),
      ...(objectMeta.sizeBytes ? { fileSizeBytes: objectMeta.sizeBytes } : {}),
    });

    return this.toMediaResponse(updated);
  }

  /**
   * Retrieves a single media record with a fresh signed download URL.
   */
  static async getMediaById(
    mediaId: string
  ): Promise<MediaResponse> {
    const media = await MediaRepository.findById(mediaId);
    if (!media) {
      throw ApiError.notFound(`Media with ID '${mediaId}' not found`);
    }

    let publicUrl = media.publicUrl;
    if (media.status === MediaStatus.VERIFIED || media.status === MediaStatus.UPLOADED) {
      try {
        publicUrl = await getStorageProvider().generateDownloadUrl(media.storagePath, 60);
      } catch (err: any) {
        logger.warn(
          { mediaId, err: err.message },
          'Could not refresh signed download URL; retaining existing URL'
        );
      }
    }

    return this.toMediaResponse(media, publicUrl);
  }

  /**
   * Lists all media attachments for a patient.
   */
  static async listPatientMedia(
    patientId: string,
    filters: MediaQueryFilters
  ): Promise<{ items: MediaResponse[]; total: number; page: number; limit: number }> {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, deletedAt: true },
    });

    if (!patient || patient.deletedAt) {
      throw ApiError.notFound(`Patient with ID '${patientId}' not found`);
    }

    const [records, total] = await Promise.all([
      MediaRepository.findByPatientId(patientId, filters),
      MediaRepository.countByPatientId(patientId, filters),
    ]);

    const items = records.map((r) => this.toMediaResponse(r));

    return {
      items,
      total,
      page: filters.page || 1,
      limit: filters.limit || 50,
    };
  }

  /**
   * Deletes a media attachment:
   * Only the uploader or a HOSPITAL_SUPERINTENDENT is authorized to delete.
   */
  static async deleteMedia(
    mediaId: string,
    userContext: AuthenticatedUserContext
  ): Promise<{ id: string; deleted: boolean }> {
    const media = await MediaRepository.findById(mediaId);
    if (!media) {
      throw ApiError.notFound(`Media with ID '${mediaId}' not found`);
    }

    // RBAC: Only original uploader or Superintendent can delete
    if (
      media.uploadedBy !== userContext.userId &&
      userContext.role !== UserRole.HOSPITAL_SUPERINTENDENT
    ) {
      throw ApiError.forbidden('You do not have permission to delete this media asset');
    }

    // 1. Delete from storage provider
    await getStorageProvider().deleteObject(media.storagePath);

    // 2. Delete from database
    await MediaRepository.delete(mediaId);

    logger.info(
      { mediaId, deletedBy: userContext.userId, role: userContext.role },
      'Patient media record and storage asset deleted successfully'
    );

    return { id: mediaId, deleted: true };
  }

  private static getExtensionForMime(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'audio/m4a': 'm4a',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/x-m4a': 'm4a',
    };
    return map[mimeType.toLowerCase()] || 'bin';
  }

  public static toMediaResponse(
    media: PatientMedia,
    overrideUrl?: string | null
  ): MediaResponse {
    return {
      id: media.id,
      patientId: media.patientId,
      uploadedBy: media.uploadedBy,
      mediaType: media.mediaType,
      storagePath: media.storagePath,
      publicUrl: overrideUrl !== undefined ? overrideUrl : media.publicUrl,
      mimeType: media.mimeType,
      fileSizeBytes: media.fileSizeBytes,
      durationSeconds: media.durationSeconds,
      checksumSha256: media.checksumSha256,
      status: media.status,
      clientCapturedAt: media.clientCapturedAt.toISOString(),
      createdAt: media.createdAt.toISOString(),
      updatedAt: media.updatedAt.toISOString(),
    };
  }
}
