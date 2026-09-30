import { randomUUID } from 'node:crypto';
import {
  MediaLocalRepository,
  LocalMediaQueueRecord,
} from '../../core/database/repositories/media.repository.js';
import { MediaUploadWorker } from './media-upload.worker.js';
import {
  CapturePhotoInput,
  RecordVoiceMemoInput,
} from './media.types.js';

export class MobileMediaService {
  constructor(
    private mediaRepo: MediaLocalRepository,
    private uploadWorker?: MediaUploadWorker
  ) {}

  /**
   * Enqueues a captured injury photograph for durable local storage and deferred upload.
   */
  async enqueuePhoto(
    input: CapturePhotoInput,
    checksumSha256?: string
  ): Promise<LocalMediaQueueRecord> {
    const id = randomUUID();
    const now = Date.now();

    const record: LocalMediaQueueRecord = {
      id,
      local_patient_id: input.localPatientId,
      server_patient_id: input.serverPatientId ?? null,
      media_type: 'PHOTO',
      local_uri: input.localUri,
      mime_type: input.mimeType || 'image/jpeg',
      file_size_bytes: input.fileSizeBytes || 0,
      duration_seconds: null,
      checksum_sha256: checksumSha256 ?? null,
      sync_status: 'PENDING',
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      next_retry_at: null,
      server_media_id: null,
      storage_path: null,
      remote_url: null,
      captured_at: input.capturedAt || now,
      created_at: now,
      updated_at: now,
    };

    await this.mediaRepo.enqueue(record);

    // Trigger non-blocking worker if provided
    if (this.uploadWorker) {
      void this.uploadWorker.processQueue().catch(() => {});
    }

    return record;
  }

  /**
   * Enqueues a recorded voice memo for durable local storage and deferred upload.
   */
  async enqueueVoiceMemo(
    input: RecordVoiceMemoInput,
    checksumSha256?: string
  ): Promise<LocalMediaQueueRecord> {
    const id = randomUUID();
    const now = Date.now();

    const record: LocalMediaQueueRecord = {
      id,
      local_patient_id: input.localPatientId,
      server_patient_id: input.serverPatientId ?? null,
      media_type: 'AUDIO',
      local_uri: input.localUri,
      mime_type: input.mimeType || 'audio/m4a',
      file_size_bytes: input.fileSizeBytes || 0,
      duration_seconds: input.durationSeconds,
      checksum_sha256: checksumSha256 ?? null,
      sync_status: 'PENDING',
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      next_retry_at: null,
      server_media_id: null,
      storage_path: null,
      remote_url: null,
      captured_at: input.capturedAt || now,
      created_at: now,
      updated_at: now,
    };

    await this.mediaRepo.enqueue(record);

    if (this.uploadWorker) {
      void this.uploadWorker.processQueue().catch(() => {});
    }

    return record;
  }

  /**
   * Retrieves all media attachments associated with a patient.
   */
  async getPatientMedia(localPatientId: string): Promise<LocalMediaQueueRecord[]> {
    return this.mediaRepo.findByPatientId(localPatientId);
  }

  /**
   * Triggers processing of queued media uploads.
   */
  async syncMedia(): Promise<number> {
    if (!this.uploadWorker) return 0;
    return this.uploadWorker.processQueue();
  }
}
