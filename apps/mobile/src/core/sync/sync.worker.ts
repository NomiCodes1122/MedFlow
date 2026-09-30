import { SYNC_CONSTANTS } from './sync.constants.js';
import { OutboxRepository, OutboxOperationRecord } from '../database/repositories/outbox.repository.js';
import { PatientLocalRepository } from '../database/repositories/patient.repository.js';
import { VitalsLocalRepository } from '../database/repositories/vitals.repository.js';
import { SyncApiClient, SyncApiError } from '../api/api.client.js';
import { SyncRetryPolicy } from './sync.retry.js';
import { useSyncStore } from './sync.store.js';
import { DeviceIdentityService } from '../device/device-identity.service.js';

export interface SyncCycleResult {
  processedCount: number;
  appliedCount: number;
  conflictCount: number;
  failedCount: number;
}

export class SyncWorker {
  constructor(
    private outboxRepo: OutboxRepository,
    private patientRepo: PatientLocalRepository,
    private vitalsRepo: VitalsLocalRepository,
    private apiClient: SyncApiClient
  ) {}

  /**
   * Executes a single synchronization cycle.
   * Atomically claims a batch of pending mutations, submits them to the API,
   * and reconciles local SQLite records according to the server's response.
   */
  async processBatch(): Promise<SyncCycleResult> {
    // 1. Atomically claim batch of pending mutations (transitions PENDING -> SYNCING)
    const claimedOps = await this.outboxRepo.claimBatch(
      SYNC_CONSTANTS.MAX_BATCH_SIZE,
      SYNC_CONSTANTS.MAX_RETRIES
    );

    if (claimedOps.length === 0) {
      return { processedCount: 0, appliedCount: 0, conflictCount: 0, failedCount: 0 };
    }

    const deviceId = await DeviceIdentityService.getDeviceId();

    const batchPayload = {
      deviceId,
      clientBatchTimestamp: new Date().toISOString(),
      operations: claimedOps.map((op) => ({
        operationId: op.operation_id,
        entityType: op.entity_type,
        entityId: op.entity_id,
        operationType: op.operation_type,
        clientTimestamp: new Date(op.client_timestamp).toISOString(),
        baseVersion: op.base_version ?? undefined,
        payload: JSON.parse(op.payload),
      })),
    };

    let appliedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;

    try {
      // 2. Submit batch to Express API
      const response = await this.apiClient.submitBatch(batchPayload);

      // Map results by operationId
      const resultMap = new Map(response.results.map((r) => [r.operationId, r]));

      for (const op of claimedOps) {
        const result = resultMap.get(op.operation_id);
        if (!result) {
          // If server omitted operation, schedule retry
          const backoff = SyncRetryPolicy.calculateBackoff(op.retry_count);
          await this.outboxRepo.scheduleRetry(
            op.operation_id,
            Date.now() + backoff,
            'Missing acknowledgment from server'
          );
          failedCount++;
          continue;
        }

        const serverTs = Date.parse(result.serverTimestamp) || Date.now();

        if (result.status === 'APPLIED' || result.status === 'DUPLICATE_IGNORED') {
          // Acknowledge operation
          await this.outboxRepo.markSynced(op.operation_id, serverTs);
          appliedCount++;

          // Reconcile local patient record
          if (op.entity_type === 'PATIENT') {
            if (op.operation_type === 'CREATE' && result.responsePayload?.id) {
              const serverId = result.responsePayload.id;
              const serverVersion = result.responsePayload.version || 1;
              await this.patientRepo.reconcileWithServer(op.entity_id, serverId, serverVersion);
              await this.vitalsRepo.updateServerPatientId(op.entity_id, serverId);
            } else if (op.operation_type === 'UPDATE' && result.responsePayload?.version) {
              await this.patientRepo.reconcileWithServer(
                op.entity_id,
                op.entity_id,
                result.responsePayload.version
              );
            }
          }

          // Reconcile local vital record
          if (op.entity_type === 'OBSERVATION') {
            await this.vitalsRepo.markSynced(op.entity_id);
          }
        } else if (result.status === 'CONFLICT') {
          // Mark outbox operation as CONFLICT
          const details = result.conflictDetails || { message: 'Version conflict' };
          await this.outboxRepo.markConflict(op.operation_id, details);
          conflictCount++;

          if (op.entity_type === 'PATIENT') {
            await this.patientRepo.markConflict(op.entity_id);
          }

          // Register in UI store for prompt review
          useSyncStore.getState().addConflict({
            operationId: op.operation_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            localPayload: JSON.parse(op.payload),
            serverVersion: result.conflictDetails?.currentServerVersion,
            expectedVersion: result.conflictDetails?.expectedVersion,
            serverState: result.conflictDetails?.currentServerState ?? undefined,
            message: result.conflictDetails?.message || 'OCC Version Conflict',
            detectedAt: Date.now(),
          });
        } else {
          // Permanent or non-retryable failure
          const errorMessage = result.error?.message || 'Mutation failed on server';
          await this.outboxRepo.markBlocked(op.operation_id, errorMessage, result.error?.code);
          failedCount++;
        }
      }
    } catch (err: any) {
      // Entire HTTP request failed (e.g. network disconnect, timeout, 5xx)
      const errorCategory =
        err instanceof SyncApiError
          ? SyncRetryPolicy.classifyError(err.status, err.code)
          : SyncRetryPolicy.classifyError(undefined, 'NETWORK_ERROR');

      for (const op of claimedOps) {
        if (errorCategory === 'NON_RETRYABLE' || errorCategory === 'VALIDATION') {
          await this.outboxRepo.markBlocked(op.operation_id, err.message, err.code);
          failedCount++;
        } else {
          // Calculate exponential backoff with jitter
          const backoff = SyncRetryPolicy.calculateBackoff(op.retry_count);
          await this.outboxRepo.scheduleRetry(
            op.operation_id,
            Date.now() + backoff,
            err.message || 'Network transport failure',
            err.code || 'TRANSPORT_ERROR'
          );
          failedCount++;
        }
      }

      throw err;
    }

    return {
      processedCount: claimedOps.length,
      appliedCount,
      conflictCount,
      failedCount,
    };
  }
}
