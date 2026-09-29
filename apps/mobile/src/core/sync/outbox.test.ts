import { describe, it, expect, beforeEach } from 'vitest';
import { NodeSqliteAdapter } from '../database/sqlite.adapter.js';
import { runMigrations } from '../database/migrations/index.js';
import { OutboxRepository, OutboxOperationRecord } from '../database/repositories/outbox.repository.js';

describe('Durable Outbox Queue & Atomic Claim', () => {
  let db: NodeSqliteAdapter;
  let outboxRepo: OutboxRepository;

  beforeEach(async () => {
    db = new NodeSqliteAdapter(':memory:');
    await runMigrations(db);
    outboxRepo = new OutboxRepository(db);
  });

  it('should enqueue a mutation with status PENDING', async () => {
    const now = Date.now();
    const op: OutboxOperationRecord = {
      operation_id: 'op-001',
      client_id: 'mobile-1',
      entity_type: 'PATIENT',
      entity_id: 'local-pt-1',
      operation_type: 'CREATE',
      payload: JSON.stringify({ firstName: 'Jane' }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    };

    await outboxRepo.enqueue(op);
    const retrieved = await outboxRepo.findById('op-001');

    expect(retrieved).not.null;
    expect(retrieved?.sync_status).toBe('PENDING');
    expect(await outboxRepo.getPendingCount()).toBe(1);
  });

  it('should atomically claim batch and transition PENDING to SYNCING', async () => {
    const now = Date.now();
    await outboxRepo.enqueue({
      operation_id: 'op-002',
      client_id: 'mobile-1',
      entity_type: 'PATIENT',
      entity_id: 'local-pt-2',
      operation_type: 'CREATE',
      payload: JSON.stringify({ firstName: 'Bob' }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    const claimed = await outboxRepo.claimBatch(10, 5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].operation_id).toBe('op-002');
    expect(claimed[0].sync_status).toBe('SYNCING');

    // A concurrent claim attempt immediately afterwards will return 0 (preventing duplicate processing!)
    const concurrentClaim = await outboxRepo.claimBatch(10, 5);
    expect(concurrentClaim).toHaveLength(0);
  });

  it('should recover stuck SYNCING operations on app crash/restart', async () => {
    const now = Date.now();
    await outboxRepo.enqueue({
      operation_id: 'op-crash-001',
      client_id: 'mobile-1',
      entity_type: 'PATIENT',
      entity_id: 'local-pt-crash',
      operation_type: 'CREATE',
      payload: JSON.stringify({ firstName: 'Crash Test' }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    // Worker claims the operation
    await outboxRepo.claimBatch(10, 5);
    const beforeRecovery = await outboxRepo.findById('op-crash-001');
    expect(beforeRecovery?.sync_status).toBe('SYNCING');

    // Simulated app crash/restart: recoverStuckSyncing() is invoked during engine init
    const recoveredCount = await outboxRepo.recoverStuckSyncing();
    expect(recoveredCount).toBe(1);

    const afterRecovery = await outboxRepo.findById('op-crash-001');
    expect(afterRecovery?.sync_status).toBe('PENDING');
  });

  it('should schedule retry with backoff and increment retry count', async () => {
    const now = Date.now();
    await outboxRepo.enqueue({
      operation_id: 'op-retry-001',
      client_id: 'mobile-1',
      entity_type: 'PATIENT',
      entity_id: 'local-pt-retry',
      operation_type: 'CREATE',
      payload: JSON.stringify({ firstName: 'Retry Test' }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    await outboxRepo.claimBatch(10, 5);

    const nextRetry = Date.now() + 5000;
    await outboxRepo.scheduleRetry('op-retry-001', nextRetry, 'Network timeout', 'TIMEOUT');

    const op = await outboxRepo.findById('op-retry-001');
    expect(op?.sync_status).toBe('PENDING');
    expect(op?.retry_count).toBe(1);
    expect(op?.next_retry_at).toBe(nextRetry);
    expect(op?.last_error_message).toBe('Network timeout');
  });
});
