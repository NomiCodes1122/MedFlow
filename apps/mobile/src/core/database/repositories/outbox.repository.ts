import { ISqliteDatabase } from '../database.interface.js';

export type OutboxSyncStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'SYNCED'
  | 'FAILED'
  | 'CONFLICT'
  | 'BLOCKED';

export interface OutboxOperationRecord {
  operation_id: string;
  client_id: string;
  entity_type: 'PATIENT' | 'OBSERVATION';
  entity_id: string;
  operation_type: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: string; // JSON string
  base_version: number | null;
  sync_status: OutboxSyncStatus;
  client_timestamp: number;
  server_timestamp: number | null;
  retry_count: number;
  max_retries: number;
  last_error_message: string | null;
  last_error_code: string | null;
  next_retry_at: number | null;
  conflict_details: string | null; // JSON string
  last_attempt_at: number | null;
  created_at: number;
  updated_at: number;
}

export class OutboxRepository {
  constructor(private db: ISqliteDatabase) {}

  async enqueue(op: OutboxOperationRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO outbox_operations (
        operation_id, client_id, entity_type, entity_id, operation_type,
        payload, base_version, sync_status, client_timestamp, server_timestamp,
        retry_count, max_retries, last_error_message, last_error_code,
        next_retry_at, conflict_details, last_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        op.operation_id,
        op.client_id,
        op.entity_type,
        op.entity_id,
        op.operation_type,
        op.payload,
        op.base_version,
        op.sync_status,
        op.client_timestamp,
        op.server_timestamp,
        op.retry_count,
        op.max_retries,
        op.last_error_message,
        op.last_error_code,
        op.next_retry_at,
        op.conflict_details,
        op.last_attempt_at,
        op.created_at,
        op.updated_at,
      ]
    );
  }

  /**
   * Atomically claims a batch of pending operations by transitioning them to SYNCING.
   * Prevents race conditions from simultaneous network triggers or background events.
   */
  async claimBatch(limit = 25, maxRetries = 5): Promise<OutboxOperationRecord[]> {
    return this.db.withTransactionAsync(async () => {
      const now = Date.now();
      const candidates = await this.db.getAllAsync<OutboxOperationRecord>(
        `SELECT * FROM outbox_operations
         WHERE sync_status = 'PENDING'
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
           AND retry_count < ?
         ORDER BY created_at ASC
         LIMIT ?`,
        [now, maxRetries, limit]
      );

      if (candidates.length === 0) {
        return [];
      }

      const ids = candidates.map((c) => c.operation_id);
      const placeholders = ids.map(() => '?').join(',');

      await this.db.runAsync(
        `UPDATE outbox_operations
         SET sync_status = 'SYNCING', last_attempt_at = ?, updated_at = ?
         WHERE operation_id IN (${placeholders})`,
        [now, now, ...ids]
      );

      return candidates.map((c) => ({
        ...c,
        sync_status: 'SYNCING' as const,
        last_attempt_at: now,
        updated_at: now,
      }));
    });
  }

  async markSynced(operationId: string, serverTimestamp: number): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `UPDATE outbox_operations
       SET sync_status = 'SYNCED', server_timestamp = ?, updated_at = ?
       WHERE operation_id = ?`,
      [serverTimestamp, now, operationId]
    );
  }

  async markConflict(operationId: string, conflictDetails: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `UPDATE outbox_operations
       SET sync_status = 'CONFLICT', conflict_details = ?, updated_at = ?
       WHERE operation_id = ?`,
      [JSON.stringify(conflictDetails), now, operationId]
    );
  }

  async scheduleRetry(
    operationId: string,
    nextRetryAt: number,
    errorMessage: string,
    errorCode?: string
  ): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `UPDATE outbox_operations
       SET sync_status = 'PENDING',
           retry_count = retry_count + 1,
           next_retry_at = ?,
           last_error_message = ?,
           last_error_code = ?,
           updated_at = ?
       WHERE operation_id = ?`,
      [nextRetryAt, errorMessage, errorCode || null, now, operationId]
    );
  }

  async markBlocked(operationId: string, errorMessage: string, errorCode?: string): Promise<void> {
    const now = Date.now();
    await this.db.runAsync(
      `UPDATE outbox_operations
       SET sync_status = 'BLOCKED',
           last_error_message = ?,
           last_error_code = ?,
           updated_at = ?
       WHERE operation_id = ?`,
      [errorMessage, errorCode || null, now, operationId]
    );
  }

  /**
   * Resets any operations stuck in 'SYNCING' back to 'PENDING'.
   * Recovers from application crashes or process terminations that occurred mid-flight.
   */
  async recoverStuckSyncing(): Promise<number> {
    const now = Date.now();
    const result = await this.db.runAsync(
      `UPDATE outbox_operations
       SET sync_status = 'PENDING', updated_at = ?
       WHERE sync_status = 'SYNCING'`,
      [now]
    );
    return result.changes;
  }

  async findById(operationId: string): Promise<OutboxOperationRecord | null> {
    return this.db.getFirstAsync<OutboxOperationRecord>(
      'SELECT * FROM outbox_operations WHERE operation_id = ?',
      [operationId]
    );
  }

  async getPendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM outbox_operations WHERE sync_status IN ('PENDING', 'SYNCING')`
    );
    return row?.count ?? 0;
  }

  async getConflictCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM outbox_operations WHERE sync_status = 'CONFLICT'`
    );
    return row?.count ?? 0;
  }

  async getConflicts(): Promise<OutboxOperationRecord[]> {
    return this.db.getAllAsync<OutboxOperationRecord>(
      `SELECT * FROM outbox_operations WHERE sync_status = 'CONFLICT' ORDER BY updated_at DESC`
    );
  }
}
