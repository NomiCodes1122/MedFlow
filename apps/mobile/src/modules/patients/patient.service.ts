import { randomUUID } from 'node:crypto';
import { PatientLocalRepository, LocalPatientRecord } from '../../core/database/repositories/patient.repository.js';
import { VitalsLocalRepository, LocalVitalSignRecord } from '../../core/database/repositories/vitals.repository.js';
import { OutboxRepository } from '../../core/database/repositories/outbox.repository.js';
import { SyncEngine } from '../../core/sync/sync.engine.js';
import { SYNC_CONSTANTS } from '../../core/sync/sync.constants.js';
import { DeviceIdentityService } from '../../core/device/device-identity.service.js';
import { ConflictResolutionStrategy } from '../../core/sync/sync.types.js';
import { useSyncStore } from '../../core/sync/sync.store.js';

export interface CreatePatientLocalInput {
  firstName?: string;
  lastName?: string;
  estimatedAge?: number;
  gender?: string;
  status?: string;
  currentTriageCategory?: string;
  chiefComplaint?: string;
  notes?: string;
  incidentId?: string;
  clientCreatedAt?: number;
}

export interface UpdatePatientLocalInput {
  firstName?: string;
  lastName?: string;
  estimatedAge?: number;
  gender?: string;
  status?: string;
  currentTriageCategory?: string;
  chiefComplaint?: string;
  notes?: string;
  incidentId?: string;
}

export interface RecordVitalLocalInput {
  patientId: string;
  systolicBp?: number;
  diastolicBp?: number;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  temperature?: number;
  gcsScore?: number;
  source?: string;
  recordedAt?: number;
}

export class MobilePatientService {
  constructor(
    private patientRepo: PatientLocalRepository,
    private vitalsRepo: VitalsLocalRepository,
    private outboxRepo: OutboxRepository,
    private syncEngine?: SyncEngine
  ) {}

  /**
   * Creates a new patient record locally in SQLite and enqueues a CREATE mutation in the Outbox.
   * If online, immediately triggers background sync without blocking local response.
   */
  async createPatient(input: CreatePatientLocalInput): Promise<LocalPatientRecord> {
    const localId = randomUUID();
    const now = Date.now();
    const clientCreatedAt = input.clientCreatedAt || now;
    const clientId = await DeviceIdentityService.getDeviceId();

    const patientRecord: LocalPatientRecord = {
      local_id: localId,
      server_id: null,
      demo_id: null,
      incident_id: input.incidentId || null,
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      estimated_age: input.estimatedAge ?? null,
      gender: input.gender || 'UNKNOWN',
      status: input.status || 'FIELD_INTAKE',
      current_triage_category: input.currentTriageCategory || 'UNASSESSED',
      chief_complaint: input.chiefComplaint || null,
      notes: input.notes || null,
      server_version: 1,
      sync_status: 'PENDING',
      is_dirty: 1,
      client_created_at: clientCreatedAt,
      created_at: now,
      updated_at: now,
    };

    // 1. Write to local SQLite database
    await this.patientRepo.create(patientRecord);

    // 2. Enqueue mutation in durable Outbox queue
    const operationId = randomUUID();
    await this.outboxRepo.enqueue({
      operation_id: operationId,
      client_id: clientId,
      entity_type: 'PATIENT',
      entity_id: localId,
      operation_type: 'CREATE',
      payload: JSON.stringify({
        ...input,
        clientCreatedAt: new Date(clientCreatedAt).toISOString(),
      }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: SYNC_CONSTANTS.MAX_RETRIES,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    // 3. Trigger sync engine opportunistically if online
    if (this.syncEngine) {
      this.syncEngine.syncNow().catch(() => {});
    }

    return patientRecord;
  }

  /**
   * Updates an existing patient record locally in SQLite and enqueues an UPDATE mutation in the Outbox.
   * Preserves current server_version as base_version for server OCC evaluation.
   */
  async updatePatient(id: string, input: UpdatePatientLocalInput): Promise<LocalPatientRecord> {
    const existing = await this.patientRepo.findById(id);
    if (!existing) {
      throw new Error(`Local patient '${id}' not found`);
    }

    const now = Date.now();
    const clientId = await DeviceIdentityService.getDeviceId();

    await this.patientRepo.update(existing.local_id, {
      ...input,
      sync_status: 'PENDING',
      is_dirty: 1,
      updated_at: now,
    });

    const operationId = randomUUID();
    const targetEntityId = existing.server_id || existing.local_id;

    await this.outboxRepo.enqueue({
      operation_id: operationId,
      client_id: clientId,
      entity_type: 'PATIENT',
      entity_id: targetEntityId,
      operation_type: 'UPDATE',
      payload: JSON.stringify({
        ...input,
        version: existing.server_version,
      }),
      base_version: existing.server_version,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: SYNC_CONSTANTS.MAX_RETRIES,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    if (this.syncEngine) {
      this.syncEngine.syncNow().catch(() => {});
    }

    const updated = await this.patientRepo.findById(existing.local_id);
    return updated!;
  }

  /**
   * Resolves a conflicted patient mutation using an explicit strategy:
   * - KEEP_LOCAL: Forces local updates by setting base_version to currentServerVersion and re-enqueueing.
   * - ACCEPT_SERVER: Discards local changes and overwrites local patient record with current server state.
   * - MANUAL_MERGE: Applies user-selected merged fields, bumps version to currentServerVersion, and re-enqueues.
   */
  async resolvePatientConflict(
    operationId: string,
    strategy: ConflictResolutionStrategy,
    mergedFields?: Partial<UpdatePatientLocalInput>
  ): Promise<LocalPatientRecord> {
    const op = await this.outboxRepo.findById(operationId);
    if (!op) {
      throw new Error(`Outbox operation '${operationId}' not found`);
    }
    if (op.entity_type !== 'PATIENT') {
      throw new Error(`Operation '${operationId}' target entity is '${op.entity_type}', expected 'PATIENT'`);
    }
    if (op.sync_status !== 'CONFLICT') {
      throw new Error(`Operation '${operationId}' is not in CONFLICT status (current: ${op.sync_status})`);
    }

    const patient = await this.patientRepo.findById(op.entity_id);
    if (!patient) {
      throw new Error(`Local patient '${op.entity_id}' not found`);
    }

    const conflictDetails = op.conflict_details ? JSON.parse(op.conflict_details) : null;
    const currentServerVersion: number =
      conflictDetails?.currentServerVersion ?? (patient.server_version + 1);
    const currentServerState: Record<string, any> = conflictDetails?.currentServerState ?? {};

    if (strategy === 'ACCEPT_SERVER') {
      // Overwrite local record with server state
      const serverUpdates: Partial<LocalPatientRecord> = {
        sync_status: 'SYNCED',
        is_dirty: 0,
      };
      if (currentServerState.firstName !== undefined) serverUpdates.first_name = currentServerState.firstName;
      if (currentServerState.lastName !== undefined) serverUpdates.last_name = currentServerState.lastName;
      if (currentServerState.estimatedAge !== undefined) serverUpdates.estimated_age = currentServerState.estimatedAge;
      if (currentServerState.gender !== undefined) serverUpdates.gender = currentServerState.gender;
      if (currentServerState.status !== undefined) serverUpdates.status = currentServerState.status;
      if (currentServerState.currentTriageCategory !== undefined)
        serverUpdates.current_triage_category = currentServerState.currentTriageCategory;
      if (currentServerState.chiefComplaint !== undefined)
        serverUpdates.chief_complaint = currentServerState.chiefComplaint;
      if (currentServerState.notes !== undefined) serverUpdates.notes = currentServerState.notes;
      if (currentServerState.incidentId !== undefined) serverUpdates.incident_id = currentServerState.incidentId;

      await this.patientRepo.resolveConflict(patient.local_id, serverUpdates, currentServerVersion);
      await this.outboxRepo.resolveConflict(operationId, 'ACCEPT_SERVER');

      useSyncStore.getState().removeConflict(operationId);
      const updated = await this.patientRepo.findById(patient.local_id);
      return updated!;
    }

    if (strategy === 'KEEP_LOCAL') {
      // Bump version on local patient to server version, keep local fields
      await this.patientRepo.resolveConflict(
        patient.local_id,
        { sync_status: 'PENDING', is_dirty: 1 },
        currentServerVersion
      );

      // Re-enqueue outbox operation with new base_version
      await this.outboxRepo.resolveConflict(
        operationId,
        'KEEP_LOCAL',
        undefined,
        currentServerVersion
      );

      useSyncStore.getState().removeConflict(operationId);

      if (this.syncEngine) {
        this.syncEngine.syncNow().catch(() => {});
      }

      const updated = await this.patientRepo.findById(patient.local_id);
      return updated!;
    }

    if (strategy === 'MANUAL_MERGE') {
      const mergedInput = mergedFields || {};
      const localUpdates: Partial<LocalPatientRecord> = {
        sync_status: 'PENDING',
        is_dirty: 1,
      };
      if (mergedInput.firstName !== undefined) localUpdates.first_name = mergedInput.firstName;
      if (mergedInput.lastName !== undefined) localUpdates.last_name = mergedInput.lastName;
      if (mergedInput.estimatedAge !== undefined) localUpdates.estimated_age = mergedInput.estimatedAge;
      if (mergedInput.gender !== undefined) localUpdates.gender = mergedInput.gender;
      if (mergedInput.status !== undefined) localUpdates.status = mergedInput.status;
      if (mergedInput.currentTriageCategory !== undefined)
        localUpdates.current_triage_category = mergedInput.currentTriageCategory;
      if (mergedInput.chiefComplaint !== undefined) localUpdates.chief_complaint = mergedInput.chiefComplaint;
      if (mergedInput.notes !== undefined) localUpdates.notes = mergedInput.notes;
      if (mergedInput.incidentId !== undefined) localUpdates.incident_id = mergedInput.incidentId;

      await this.patientRepo.resolveConflict(patient.local_id, localUpdates, currentServerVersion);

      const resolvedPayload = {
        ...JSON.parse(op.payload),
        ...mergedInput,
        version: currentServerVersion,
      };

      await this.outboxRepo.resolveConflict(
        operationId,
        'MANUAL_MERGE',
        resolvedPayload,
        currentServerVersion
      );

      useSyncStore.getState().removeConflict(operationId);

      if (this.syncEngine) {
        this.syncEngine.syncNow().catch(() => {});
      }

      const updated = await this.patientRepo.findById(patient.local_id);
      return updated!;
    }

    throw new Error(`Unsupported conflict resolution strategy: ${strategy}`);
  }

  /**
   * Records a vital signs observation locally in SQLite (append-only) and enqueues an outbox mutation.
   */
  async recordVital(input: RecordVitalLocalInput): Promise<LocalVitalSignRecord> {
    const patient = await this.patientRepo.findById(input.patientId);
    if (!patient) {
      throw new Error(`Patient '${input.patientId}' not found locally`);
    }

    const vitalId = randomUUID();
    const now = Date.now();
    const recordedAt = input.recordedAt || now;
    const clientId = await DeviceIdentityService.getDeviceId();

    const vitalRecord: LocalVitalSignRecord = {
      id: vitalId,
      local_patient_id: patient.local_id,
      server_patient_id: patient.server_id,
      recorded_by: null,
      systolic_bp: input.systolicBp ?? null,
      diastolic_bp: input.diastolicBp ?? null,
      heart_rate: input.heartRate ?? null,
      respiratory_rate: input.respiratoryRate ?? null,
      oxygen_saturation: input.oxygenSaturation ?? null,
      temperature: input.temperature ?? null,
      gcs_score: input.gcsScore ?? null,
      source: input.source || 'PARAMEDIC_FIELD',
      sync_status: 'PENDING',
      recorded_at: recordedAt,
      created_at: now,
    };

    // 1. Append locally
    await this.vitalsRepo.insert(vitalRecord);

    // 2. Enqueue in outbox
    const operationId = randomUUID();
    const targetPatientId = patient.server_id || patient.local_id;

    await this.outboxRepo.enqueue({
      operation_id: operationId,
      client_id: clientId,
      entity_type: 'OBSERVATION',
      entity_id: vitalId,
      operation_type: 'CREATE',
      payload: JSON.stringify({
        patientId: targetPatientId,
        systolicBp: input.systolicBp,
        diastolicBp: input.diastolicBp,
        heartRate: input.heartRate,
        respiratoryRate: input.respiratoryRate,
        oxygenSaturation: input.oxygenSaturation,
        temperature: input.temperature,
        gcsScore: input.gcsScore,
        recordedAt: new Date(recordedAt).toISOString(),
      }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: now,
      server_timestamp: null,
      retry_count: 0,
      max_retries: SYNC_CONSTANTS.MAX_RETRIES,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: now,
      updated_at: now,
    });

    if (this.syncEngine) {
      this.syncEngine.syncNow().catch(() => {});
    }

    return vitalRecord;
  }

  async getPatients(filter?: { incidentId?: string; status?: string }): Promise<LocalPatientRecord[]> {
    return this.patientRepo.findAll(filter);
  }

  async getPatientById(id: string): Promise<LocalPatientRecord | null> {
    return this.patientRepo.findById(id);
  }

  async getVitals(patientId: string): Promise<LocalVitalSignRecord[]> {
    return this.vitalsRepo.findByPatientId(patientId);
  }
}
