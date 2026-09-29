import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeSqliteAdapter } from '../database/sqlite.adapter.js';
import { runMigrations } from '../database/migrations/index.js';
import { PatientLocalRepository } from '../database/repositories/patient.repository.js';
import { VitalsLocalRepository } from '../database/repositories/vitals.repository.js';
import { OutboxRepository } from '../database/repositories/outbox.repository.js';
import { SyncApiClient, SyncApiError } from '../api/api.client.js';
import { SecureStoreService } from '../api/secure-store.js';
import { SyncEngine } from './sync.engine.js';
import { ConnectivityManager } from './sync.connectivity.js';
import { MobilePatientService } from '../../modules/patients/patient.service.js';
import { useSyncStore } from './sync.store.js';

describe('Phase 7 Offline & Sync Engine — Scenarios A through G', () => {
  let db: NodeSqliteAdapter;
  let patientRepo: PatientLocalRepository;
  let vitalsRepo: VitalsLocalRepository;
  let outboxRepo: OutboxRepository;
  let apiClient: SyncApiClient;
  let syncEngine: SyncEngine;
  let patientService: MobilePatientService;

  beforeEach(async () => {
    vi.restoreAllMocks();
    useSyncStore.getState().clearConflicts();
    await SecureStoreService.clearTokens();
    await SecureStoreService.setAccessToken('valid-access-token');
    await SecureStoreService.setRefreshToken('valid-refresh-token');

    db = new NodeSqliteAdapter(':memory:');
    await runMigrations(db);

    patientRepo = new PatientLocalRepository(db);
    vitalsRepo = new VitalsLocalRepository(db);
    outboxRepo = new OutboxRepository(db);
    apiClient = new SyncApiClient();

    syncEngine = new SyncEngine(outboxRepo, patientRepo, vitalsRepo, apiClient);
    patientService = new MobilePatientService(patientRepo, vitalsRepo, outboxRepo, syncEngine);

    ConnectivityManager.setOnline(true);
    await syncEngine.initialize();
  });

  /**
   * SCENARIO A:
   * Offline -> create patient -> restart app -> reconnect -> sync
   */
  it('Scenario A: Offline -> create patient -> restart app -> reconnect -> sync', async () => {
    // 1. Device goes offline
    ConnectivityManager.setOnline(false);

    // 2. Paramedic creates patient while offline
    const localPatient = await patientService.createPatient({
      firstName: 'Scenario',
      lastName: 'Alpha',
      estimatedAge: 30,
      gender: 'MALE',
      chiefComplaint: 'Head trauma',
    });

    expect(localPatient.local_id).toBeDefined();
    expect(localPatient.sync_status).toBe('PENDING');

    // 3. Verify queued in outbox
    const pendingCount = await outboxRepo.getPendingCount();
    expect(pendingCount).toBe(1);

    // 4. Simulate App Restart: destroy current engine, recreate engine & run recovery
    syncEngine.destroy();
    const newEngine = new SyncEngine(outboxRepo, patientRepo, vitalsRepo, apiClient);
    await newEngine.initialize();

    // 5. Mock successful server response upon reconnect
    const serverPatientId = 'srv-pt-alpha-123';
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: (await outboxRepo.claimBatch(1, 5))[0].operation_id,
          status: 'APPLIED',
          serverTimestamp: new Date().toISOString(),
          responsePayload: {
            id: serverPatientId,
            version: 1,
            demoId: 'MED-PT-ALPHA',
          },
        },
      ],
    });

    // Reset claimed operation back to PENDING for the actual sync run
    await outboxRepo.recoverStuckSyncing();

    // 6. Connectivity restored -> triggers sync
    ConnectivityManager.setOnline(true);
    const syncResult = await newEngine.syncNow();

    expect(syncResult.appliedCount).toBe(1);
    expect(await outboxRepo.getPendingCount()).toBe(0);

    // 7. Verify local patient record reconciled with server ID
    const reconciled = await patientRepo.findById(localPatient.local_id);
    expect(reconciled?.server_id).toBe(serverPatientId);
    expect(reconciled?.sync_status).toBe('SYNCED');
    expect(reconciled?.is_dirty).toBe(0);

    newEngine.destroy();
  });

  /**
   * SCENARIO B:
   * Offline -> update patient -> reconnect -> successful OCC update
   */
  it('Scenario B: Offline -> update patient -> reconnect -> successful OCC update', async () => {
    // 1. Existing synced patient in local DB
    const patientId = 'srv-pt-beta-123';
    await patientRepo.create({
      local_id: 'local-pt-beta',
      server_id: patientId,
      demo_id: 'MED-PT-BETA',
      incident_id: null,
      first_name: 'John',
      last_name: 'Beta',
      estimated_age: 40,
      gender: 'MALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'YELLOW',
      chief_complaint: 'Chest pain',
      notes: null,
      server_version: 1,
      sync_status: 'SYNCED',
      is_dirty: 0,
      client_created_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // 2. Paramedic updates patient while offline
    ConnectivityManager.setOnline(false);
    await patientService.updatePatient(patientId, {
      status: 'IN_TRANSIT',
      notes: 'Oxygen administered',
    });

    const localUpdated = await patientRepo.findById(patientId);
    expect(localUpdated?.status).toBe('IN_TRANSIT');
    expect(localUpdated?.sync_status).toBe('PENDING');

    // 3. Mock server successful OCC update acknowledging version 2
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: (await outboxRepo.claimBatch(1, 5))[0].operation_id,
          status: 'APPLIED',
          serverTimestamp: new Date().toISOString(),
          responsePayload: {
            id: patientId,
            version: 2,
            status: 'IN_TRANSIT',
          },
        },
      ],
    });

    await outboxRepo.recoverStuckSyncing();

    // 4. Reconnect and sync
    ConnectivityManager.setOnline(true);
    const syncResult = await syncEngine.syncNow();

    expect(syncResult.appliedCount).toBe(1);
    const finalized = await patientRepo.findById(patientId);
    expect(finalized?.server_version).toBe(2);
    expect(finalized?.sync_status).toBe('SYNCED');
  });

  /**
   * SCENARIO C:
   * Offline -> update patient -> another user updates server -> reconnect -> conflict
   */
  it('Scenario C: Offline -> update patient -> another user updates server -> reconnect -> conflict', async () => {
    const patientId = 'srv-pt-gamma-123';
    await patientRepo.create({
      local_id: 'local-pt-gamma',
      server_id: patientId,
      demo_id: 'MED-PT-GAMMA',
      incident_id: null,
      first_name: 'Gamma',
      last_name: 'Patient',
      estimated_age: 50,
      gender: 'FEMALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'YELLOW',
      chief_complaint: 'Abdominal pain',
      notes: null,
      server_version: 1, // Local thinks version is 1
      sync_status: 'SYNCED',
      is_dirty: 0,
      client_created_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // Offline edit
    ConnectivityManager.setOnline(false);
    await patientService.updatePatient(patientId, {
      notes: 'Local paramedic note',
    });

    // Mock server returning 409 CONFLICT because server is at version 2
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: (await outboxRepo.claimBatch(1, 5))[0].operation_id,
          status: 'CONFLICT',
          serverTimestamp: new Date().toISOString(),
          conflictDetails: {
            message: 'Optimistic concurrency conflict: database version is 2, expected 1',
            currentServerVersion: 2,
            expectedVersion: 1,
            currentServerState: { notes: 'Hospital ER update by Dr. Marcus' },
          },
        },
      ],
    });

    await outboxRepo.recoverStuckSyncing();

    // Reconnect and sync
    ConnectivityManager.setOnline(true);
    const syncResult = await syncEngine.syncNow();

    expect(syncResult.conflictCount).toBe(1);

    // Verify local patient marked with CONFLICT status
    const conflictedPatient = await patientRepo.findById(patientId);
    expect(conflictedPatient?.sync_status).toBe('CONFLICT');

    // Verify surfaced in Zustand store
    const storeState = useSyncStore.getState();
    expect(storeState.conflictCount).toBe(1);
    expect(storeState.activeConflicts).toHaveLength(1);
    expect(storeState.activeConflicts[0].serverVersion).toBe(2);
    expect(storeState.activeConflicts[0].expectedVersion).toBe(1);
  });

  /**
   * SCENARIO D:
   * Request reaches server -> response lost -> client retries -> no duplicate patient
   */
  it('Scenario D: Request reaches server -> response lost -> client retries -> no duplicate patient', async () => {
    ConnectivityManager.setOnline(false);
    const patient = await patientService.createPatient({
      firstName: 'Duplicate',
      lastName: 'Prevent',
    });

    const claimed = await outboxRepo.claimBatch(1, 5);
    const originalOpId = claimed[0].operation_id;
    await outboxRepo.recoverStuckSyncing();

    // Mock server returning DUPLICATE_IGNORED because the server already processed this operationId in prior attempt
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: originalOpId,
          status: 'DUPLICATE_IGNORED',
          serverTimestamp: new Date().toISOString(),
          responsePayload: {
            id: 'srv-pt-dedup-1',
            version: 1,
          },
        },
      ],
    });

    ConnectivityManager.setOnline(true);
    const syncResult = await syncEngine.syncNow();

    expect(syncResult.appliedCount).toBe(1);
    expect(await outboxRepo.getPendingCount()).toBe(0);

    const reconciled = await patientRepo.findById(patient.local_id);
    expect(reconciled?.server_id).toBe('srv-pt-dedup-1');
    expect(reconciled?.sync_status).toBe('SYNCED');
  });

  /**
   * SCENARIO E:
   * Access token expires during sync -> refresh -> mutation succeeds
   */
  it('Scenario E: Access token expires during sync -> refresh -> mutation succeeds', async () => {
    ConnectivityManager.setOnline(false);
    await patientService.createPatient({ firstName: 'Token', lastName: 'Refresh' });

    // Mock fetch to simulate 401 on first attempt, success on refresh, and success on retry
    let fetchCount = 0;
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      fetchCount++;
      const urlStr = String(url);

      if (urlStr.includes('/api/v1/sync/batch')) {
        if (fetchCount === 1) {
          // First attempt: Token expired
          return {
            status: 401,
            ok: false,
            json: async () => ({
              success: false,
              error: { code: 'AUTH_EXPIRED', message: 'Token expired' },
            }),
          } as any;
        }
        // Retry attempt after refresh: Success
        return {
          status: 200,
          ok: true,
          json: async () => ({
            success: true,
            data: {
              processedAt: new Date().toISOString(),
              results: [
                {
                  operationId: JSON.parse(options.body).operations[0].operationId,
                  status: 'APPLIED',
                  serverTimestamp: new Date().toISOString(),
                  responsePayload: { id: 'srv-pt-token-ok', version: 1 },
                },
              ],
            },
          }),
        } as any;
      }

      if (urlStr.includes('/api/v1/auth/refresh')) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            success: true,
            data: {
              accessToken: 'new-refreshed-access-token',
              refreshToken: 'new-refreshed-refresh-token',
            },
          }),
        } as any;
      }

      return globalFetch(url, options);
    });

    ConnectivityManager.setOnline(true);
    const syncResult = await syncEngine.syncNow();

    expect(syncResult.appliedCount).toBe(1);
    expect(await SecureStoreService.getAccessToken()).toBe('new-refreshed-access-token');

    globalThis.fetch = globalFetch;
  });

  /**
   * SCENARIO F:
   * Network disappears during sync -> mutation remains recoverable in outbox
   */
  it('Scenario F: Network disappears during sync -> mutation remains recoverable', async () => {
    ConnectivityManager.setOnline(false);
    await patientService.createPatient({ firstName: 'Network', lastName: 'Drop' });

    // Mock submitBatch throwing network error
    vi.spyOn(apiClient, 'submitBatch').mockRejectedValueOnce(
      new SyncApiError(0, 'NETWORK_ERROR', 'Network connection dropped')
    );

    ConnectivityManager.setOnline(true);
    await expect(syncEngine.syncNow()).rejects.toThrow();

    // Outbox operation was not discarded; it has been rescheduled with retry backoff
    const pendingCount = await outboxRepo.getPendingCount();
    expect(pendingCount).toBe(1);

    const ops = await outboxRepo.claimBatch(1, 0); // Exclude ops with retry > 0
    expect(ops).toHaveLength(0); // It has a future next_retry_at
  });

  /**
   * SCENARIO G:
   * App is killed while mutation is SYNCING -> next startup recovers safely
   */
  it('Scenario G: App is killed while mutation is SYNCING -> next startup recovers safely', async () => {
    ConnectivityManager.setOnline(false);
    await patientService.createPatient({ firstName: 'Crash', lastName: 'Survivor' });

    // Claim batch (transitions to SYNCING)
    const claimed = await outboxRepo.claimBatch(1, 5);
    expect(claimed[0].sync_status).toBe('SYNCING');

    // Simulate sudden process termination (process killed while SYNCING)
    // New app lifecycle starts:
    syncEngine.destroy();
    const restartedEngine = new SyncEngine(outboxRepo, patientRepo, vitalsRepo, apiClient);

    // On engine.initialize(), recoverStuckSyncing() is called
    await restartedEngine.initialize();

    const recoveredOp = await outboxRepo.findById(claimed[0].operation_id);
    expect(recoveredOp?.sync_status).toBe('PENDING');

    restartedEngine.destroy();
  });
});
