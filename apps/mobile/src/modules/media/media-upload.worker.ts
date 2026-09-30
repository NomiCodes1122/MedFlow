import {
  MediaLocalRepository,
  LocalMediaQueueRecord,
} from '../../core/database/repositories/media.repository.js';

export interface UploadResult {
  serverMediaId: string;
  storagePath: string;
  remoteUrl: string;
}

export type MediaUploadHandler = (
  item: LocalMediaQueueRecord
) => Promise<UploadResult>;

export class MediaUploadWorker {
  private isProcessing = false;

  constructor(
    private mediaRepo: MediaLocalRepository,
    private uploadHandler: MediaUploadHandler
  ) {}

  /**
   * Processes ready media items in the local queue.
   */
  async processQueue(now: number = Date.now(), limit: number = 5): Promise<number> {
    if (this.isProcessing) {
      return 0;
    }
    this.isProcessing = true;

    try {
      const pendingItems = await this.mediaRepo.getPendingUploads(now, limit);
      let processedCount = 0;

      for (const item of pendingItems) {
        await this.processItem(item, now);
        processedCount++;
      }

      return processedCount;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processItem(
    item: LocalMediaQueueRecord,
    now: number
  ): Promise<void> {
    // 1. Mark as in-flight
    await this.mediaRepo.updateStatus(item.id, 'UPLOADING');

    try {
      // 2. Execute upload via adapter
      const result = await this.uploadHandler(item);

      // 3. Mark as successfully synced
      await this.mediaRepo.updateStatus(item.id, 'SYNCED', {
        server_media_id: result.serverMediaId,
        storage_path: result.storagePath,
        remote_url: result.remoteUrl,
      });
    } catch (err: any) {
      const newRetryCount = item.retry_count + 1;
      const backoffMs = Math.min(Math.pow(2, newRetryCount) * 1000, 60000); // Max 60s
      const nextRetryAt = now + backoffMs;

      await this.mediaRepo.updateStatus(item.id, 'FAILED', {
        retry_count: newRetryCount,
        last_error_message: err.message || 'Media upload error',
        next_retry_at: nextRetryAt,
      });
    }
  }
}
