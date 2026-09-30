import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeSqliteAdapter } from '../database/sqlite.adapter.js';
import { runMigrations } from '../database/migrations/index.js';
import { PatientLocalRepository } from '../database/repositories/patient.repository.js';
import { VitalsLocalRepository } from '../database/repositories/vitals.repository.js';
import { OutboxRepository } from '../database/repositories/outbox.repository.js';
import { SyncApiClient } from '../api/api.client.js';
import { SecureStoreService } from '../api/secure-store.js';
import { SyncEngine } from './sync.engine.js';
import { ConnectivityManager } from './sync.connectivity.js';
import { MobilePatientService } from '../../modules/patients/patient.service.js';
import { useSyncStore } from './sync.store.js';
import { DeviceIdentityService } from '../device/device-identity.service.js';

describe('Conflict Resolution Workflow & Safe State Transitions', () => {
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
    DeviceIdentityService.clearCache();

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

  it('Strategy: KEEP_LOCAL — should bump baseVersion to server version, transition outbox to PENDING, and re-sync successfully', async () => {
    const patientId = 'pt-conflict-001';
    await patientRepo.create({
      local_id: 'local-pt-001',
      server_id: patientId,
      demo_id: 'MED-PT-1',
      incident_id: null,
      first_name: 'Original',
      last_name: 'Patient',
      estimated_age: 30,
      gender: 'MALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'YELLOW',
      chief_complaint: 'Trauma',
      notes: null,
      server_version: 1,
      sync_status: 'SYNCED',
      is_dirty: 0,
      client_created_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    // 1. Paramedic makes an offline update
    ConnectivityManager.setOnline(false);
    await patientService.updatePatient(patientId, {
      status: 'IN_TRANSIT',
      notes: 'Paramedic field update',
    });

    // 2. Mock server returning OCC conflict (database is at version 2, expected 1)
    const claimed = await outboxRepo.claimBatch(1, 5);
    const opId = claimed[0].operation_id;
    await outboxRepo.recoverStuckSyncing();

    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: opId,
          status: 'CONFLICT',
          serverTimestamp: new Date().toISOString(),
          conflictDetails: {
            message: 'Optimistic concurrency conflict',
            currentServerVersion: 2,
            expectedVersion: 1,
            currentServerState: {
              status: 'ARRIVED_ER',
              notes: 'Hospital triage note by Dr. Marcus',
            },
          },
        },
      ],
    });

    // 3. Trigger sync -> encounters CONFLICT
    ConnectivityManager.setOnline(true);
    const cycle1 = await syncEngine.syncNow();
    expect(cycle1.conflictCount).toBe(1);

    const outboxAfterConflict = await outboxRepo.findById(opId);
    expect(outboxAfterConflict?.sync_status).toBe('CONFLICT');
    expect(useSyncStore.getState().conflictCount).toBe(1);

    // 4. Paramedic resolves conflict while offline using KEEP_LOCAL strategy
    ConnectivityManager.setOnline(false);
    const resolvedPatient = await patientService.resolvePatientConflict(opId, 'KEEP_LOCAL');
    expect(resolvedPatient.server_version).toBe(2);
    expect(resolvedPatient.sync_status).toBe('PENDING');

    const outboxAfterResolve = await outboxRepo.findById(opId);
    expect(outboxAfterResolve?.sync_status).toBe('PENDING');
    expect(outboxAfterResolve?.base_version).toBe(2);
    expect(outboxAfterResolve?.retry_count).toBe(0);
    expect(useSyncStore.getState().conflictCount).toBe(0);

    // 5. Mock server accepting the re-submitted mutation with version 3
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: opId,
          status: 'APPLIED',
          serverTimestamp: new Date().toISOString(),
          responsePayload: {
            id: patientId,
            version: 3,
            status: 'IN_TRANSIT',
          },
        },
      ],
    });

    // 6. Next sync cycle succeeds!
    ConnectivityManager.setOnline(true);
    const cycle2 = await syncEngine.syncNow();
    expect(cycle2.appliedCount).toBe(1);
    expect(cycle2.conflictCount).toBe(0);

    const finalized = await patientRepo.findById(patientId);
    expect(finalized?.server_version).toBe(3);
    expect(finalized?.sync_status).toBe('SYNCED');
    expect(finalized?.is_dirty).toBe(0);
  });

  it('Strategy: ACCEPT_SERVER — should discard local mutation, update local record with server state, and mark SYNCED', async () => {
    const patientId = 'pt-conflict-002';
    await patientRepo.create({
      local_id: 'local-pt-002',
      server_id: patientId,
      demo_id: 'MED-PT-2',
      incident_id: null,
      first_name: 'Server',
      last_name: 'Wins',
      estimated_age: 45,
      gender: 'FEMALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'GREEN',
      chief_complaint: 'Headache',
      notes: null,
      server_version: 1,
      sync_status: 'SYNCED',
      is_dirty: 0,
      client_created_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    ConnectivityManager.setOnline(false);
    await patientService.updatePatient(patientId, {
      status: 'IN_TRANSIT',
      notes: 'Outdated local note',
    });

    const claimed = await outboxRepo.claimBatch(1, 5);
    const opId = claimed[0].operation_id;
    await outboxRepo.recoverStuckSyncing();

    // Trigger conflict
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: opId,
          status: 'CONFLICT',
          serverTimestamp: new Date().toISOString(),
          conflictDetails: {
            message: 'Conflict',
            currentServerVersion: 3,
            expectedVersion: 1,
            currentServerState: {
              status: 'DISCHARGED',
              notes: 'Patient stable, discharged home',
            },
          },
        },
      ],
    });

    ConnectivityManager.setOnline(true);
    await syncEngine.syncNow();
    expect(useSyncStore.getState().conflictCount).toBe(1);

    // Paramedic accepts server state
    const resolvedPatient = await patientService.resolvePatientConflict(opId, 'ACCEPT_SERVER');
    expect(resolvedPatient.status).toBe('DISCHARGED');
    expect(resolvedPatient.notes).toBe('Patient stable, discharged home');
    expect(resolvedPatient.server_version).toBe(3);
    expect(resolvedPatient.sync_status).toBe('SYNCED');
    expect(resolvedPatient.is_dirty).toBe(0);

    const outboxRecord = await outboxRepo.findById(opId);
    expect(outboxRecord?.sync_status).toBe('DISCARDED');
    expect(useSyncStore.getState().conflictCount).toBe(0);
  });

  it('Strategy: MANUAL_MERGE — should apply merged fields and advance version for subsequent sync', async () => {
    const patientId = 'pt-conflict-003';
    await patientRepo.create({
      local_id: 'local-pt-003',
      server_id: patientId,
      demo_id: 'MED-PT-3',
      incident_id: null,
      first_name: 'Merge',
      last_name: 'Test',
      estimated_age: 50,
      gender: 'MALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'YELLOW',
      chief_complaint: 'Initial complaint',
      notes: null,
      server_version: 1,
      sync_status: 'SYNCED',
      is_dirty: 0,
      client_created_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    ConnectivityManager.setOnline(false);
    await patientService.updatePatient(patientId, {
      chiefComplaint: 'Field updated complaint',
      notes: 'Local note',
    });

    const claimed = await outboxRepo.claimBatch(1, 5);
    const opId = claimed[0].operation_id;
    await outboxRepo.recoverStuckSyncing();

    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: opId,
          status: 'CONFLICT',
          serverTimestamp: new Date().toISOString(),
          conflictDetails: {
            message: 'Conflict',
            currentServerVersion: 2,
            expectedVersion: 1,
            currentServerState: {
              status: 'TRIAGED_RED',
              notes: 'Doctor prioritized RED in ER',
            },
          },
        },
      ],
    });

    ConnectivityManager.setOnline(true);
    await syncEngine.syncNow();

    // Clinician performs manual merge while offline
    ConnectivityManager.setOnline(false);
    const resolvedPatient = await patientService.resolvePatientConflict(opId, 'MANUAL_MERGE', {
      status: 'TRIAGED_RED',
      chiefComplaint: 'Field updated complaint',
      notes: 'Doctor prioritized RED in ER. Note: Field team administered IV saline.',
    });

    expect(resolvedPatient.status).toBe('TRIAGED_RED');
    expect(resolvedPatient.notes).toContain('Field team administered IV saline');
    expect(resolvedPatient.server_version).toBe(2);
    expect(resolvedPatient.sync_status).toBe('PENDING');

    const outboxRecord = await outboxRepo.findById(opId);
    expect(outboxRecord?.sync_status).toBe('PENDING');
    expect(outboxRecord?.base_version).toBe(2);

    // Mock successful sync of the merged payload
    vi.spyOn(apiClient, 'submitBatch').mockResolvedValueOnce({
      processedAt: new Date().toISOString(),
      results: [
        {
          operationId: opId,
          status: 'APPLIED',
          serverTimestamp: new Date().toISOString(),
          responsePayload: {
            id: patientId,
            version: 3,
            status: 'TRIAGED_RED',
          },
        },
      ],
    });

    ConnectivityManager.setOnline(true);
    const cycle = await syncEngine.syncNow();
    expect(cycle.appliedCount).toBe(1);
    expect(useSyncStore.getState().conflictCount).toBe(0);
  });

  it('Validation: should reject conflict resolution on operations that are not in CONFLICT state', async () => {
    ConnectivityManager.setOnline(false);
    await patientService.createPatient({ firstName: 'Non-Conflict' });
    const ops = await outboxRepo.claimBatch(1, 5);
    const opId = ops[0].operation_id;

    // Operation is in SYNCING status, not CONFLICT
    await expect(
      patientService.resolvePatientConflict(opId, 'KEEP_LOCAL')
    ).rejects.toThrow(/not in CONFLICT status/);
  });

  it('Validation: should reject conflict resolution on non-existent operations', async () => {
    await expect(
      patientService.resolvePatientConflict('non-existent-op-id', 'KEEP_LOCAL')
    ).rejects.toThrow(/not found/);
  });
});
