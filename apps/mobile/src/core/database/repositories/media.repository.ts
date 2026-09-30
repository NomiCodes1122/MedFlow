import { ISqliteDatabase } from '../database.interface.js';

export interface LocalMediaQueueRecord {
  id: string;
  local_patient_id: string;
  server_patient_id: string | null;
  media_type: 'PHOTO' | 'AUDIO';
  local_uri: string;
  mime_type: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  checksum_sha256: string | null;
  sync_status: 'PENDING' | 'UPLOADING' | 'SYNCED' | 'FAILED';
  retry_count: number;
  max_retries: number;
  last_error_message: string | null;
  next_retry_at: number | null;
  server_media_id: string | null;
  storage_path: string | null;
  remote_url: string | null;
  captured_at: number;
  created_at: number;
  updated_at: number;
}

export class MediaLocalRepository {
  constructor(private db: ISqliteDatabase) {}

  /**
   * Enqueues a new media asset for offline tracking and background upload.
   */
  async enqueue(record: LocalMediaQueueRecord): Promise<void> {
    const sql = `
      INSERT INTO local_media_queue (
        id, local_patient_id, server_patient_id, media_type, local_uri,
        mime_type, file_size_bytes, duration_seconds, checksum_sha256,
        sync_status, retry_count, max_retries, last_error_message,
        next_retry_at, server_media_id, storage_path, remote_url,
        captured_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.db.runAsync(sql, [
      record.id,
      record.local_patient_id,
      record.server_patient_id,
      record.media_type,
      record.local_uri,
      record.mime_type,
      record.file_size_bytes,
      record.duration_seconds,
      record.checksum_sha256,
      record.sync_status,
      record.retry_count,
      record.max_retries,
      record.last_error_message,
      record.next_retry_at,
      record.server_media_id,
      record.storage_path,
      record.remote_url,
      record.captured_at,
      record.created_at,
      record.updated_at,
    ]);
  }

  /**
   * Retrieves a media record by its local ID.
   */
  async findById(id: string): Promise<LocalMediaQueueRecord | null> {
    const sql = `SELECT * FROM local_media_queue WHERE id = ?;`;
    return this.db.getFirstAsync<LocalMediaQueueRecord>(sql, [id]);
  }

  /**
   * Retrieves all media attachments associated with a patient.
   */
  async findByPatientId(localPatientId: string): Promise<LocalMediaQueueRecord[]> {
    const sql = `
      SELECT * FROM local_media_queue
      WHERE local_patient_id = ?
      ORDER BY captured_at DESC;
    `;
    return this.db.getAllAsync<LocalMediaQueueRecord>(sql, [localPatientId]);
  }

  /**
   * Retrieves pending or retryable media items that are ready for upload.
   */
  async getPendingUploads(now: number = Date.now(), limit: number = 5): Promise<LocalMediaQueueRecord[]> {
    const sql = `
      SELECT * FROM local_media_queue
      WHERE sync_status = 'PENDING'
         OR (sync_status = 'FAILED' AND retry_count < max_retries AND (next_retry_at IS NULL OR next_retry_at <= ?))
      ORDER BY captured_at ASC
      LIMIT ?;
    `;
    return this.db.getAllAsync<LocalMediaQueueRecord>(sql, [now, limit]);
  }

  /**
   * Updates upload status and sync progress.
   */
  async updateStatus(
    id: string,
    syncStatus: 'PENDING' | 'UPLOADING' | 'SYNCED' | 'FAILED',
    updates: Partial<LocalMediaQueueRecord> = {}
  ): Promise<void> {
    const now = Date.now();
    const setClauses: string[] = ['sync_status = ?', 'updated_at = ?'];
    const params: unknown[] = [syncStatus, now];

    if (updates.retry_count !== undefined) {
      setClauses.push('retry_count = ?');
      params.push(updates.retry_count);
    }
    if (updates.last_error_message !== undefined) {
      setClauses.push('last_error_message = ?');
      params.push(updates.last_error_message);
    }
    if (updates.next_retry_at !== undefined) {
      setClauses.push('next_retry_at = ?');
      params.push(updates.next_retry_at);
    }
    if (updates.server_media_id !== undefined) {
      setClauses.push('server_media_id = ?');
      params.push(updates.server_media_id);
    }
    if (updates.storage_path !== undefined) {
      setClauses.push('storage_path = ?');
      params.push(updates.storage_path);
    }
    if (updates.remote_url !== undefined) {
      setClauses.push('remote_url = ?');
      params.push(updates.remote_url);
    }
    if (updates.server_patient_id !== undefined) {
      setClauses.push('server_patient_id = ?');
      params.push(updates.server_patient_id);
    }

    params.push(id);
    const sql = `UPDATE local_media_queue SET ${setClauses.join(', ')} WHERE id = ?;`;
    await this.db.runAsync(sql, params);
  }

  /**
   * Removes a media queue record from local storage.
   */
  async delete(id: string): Promise<void> {
    const sql = `DELETE FROM local_media_queue WHERE id = ?;`;
    await this.db.runAsync(sql, [id]);
  }

  /**
   * Returns count of queued items by status.
   */
  async countByStatus(status: 'PENDING' | 'UPLOADING' | 'SYNCED' | 'FAILED'): Promise<number> {
    const sql = `SELECT COUNT(*) as cnt FROM local_media_queue WHERE sync_status = ?;`;
    const res = await this.db.getFirstAsync<{ cnt: number }>(sql, [status]);
    return res?.cnt ?? 0;
  }
}
