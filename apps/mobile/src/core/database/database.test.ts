import { describe, it, expect, beforeEach } from 'vitest';
import { NodeSqliteAdapter } from './sqlite.adapter.js';
import { runMigrations } from './migrations/index.js';
import { PatientLocalRepository } from './repositories/patient.repository.js';
import { VitalsLocalRepository } from './repositories/vitals.repository.js';
import { TriageLocalRepository } from './repositories/triage.repository.js';

describe('Mobile SQLite Database & Migrations', () => {
  let db: NodeSqliteAdapter;
  let patientRepo: PatientLocalRepository;
  let vitalsRepo: VitalsLocalRepository;

  beforeEach(async () => {
    db = new NodeSqliteAdapter(':memory:');
    await runMigrations(db);
    patientRepo = new PatientLocalRepository(db);
    vitalsRepo = new VitalsLocalRepository(db);
  });

  it('should run migrations idempotently and create all required tables', async () => {
    // Running migrations second time should be a no-op
    await runMigrations(db);

    const tables = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC`
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('schema_migrations');
    expect(tableNames).toContain('patients');
    expect(tableNames).toContain('patient_vitals');
    expect(tableNames).toContain('outbox_operations');
    expect(tableNames).toContain('sync_metadata');
    expect(tableNames).toContain('local_triage_assessments');
  });

  it('should insert and retrieve a local patient record', async () => {
    const now = Date.now();
    await patientRepo.create({
      local_id: 'local-pt-001',
      server_id: null,
      demo_id: 'MED-PT-100',
      incident_id: null,
      first_name: 'John',
      last_name: 'Doe',
      estimated_age: 35,
      gender: 'MALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'GREEN',
      chief_complaint: 'Minor laceration',
      notes: 'Bandaged',
      server_version: 1,
      sync_status: 'PENDING',
      is_dirty: 1,
      client_created_at: now,
      created_at: now,
      updated_at: now,
    });

    const retrieved = await patientRepo.findById('local-pt-001');
    expect(retrieved).not.null;
    expect(retrieved?.first_name).toBe('John');
    expect(retrieved?.sync_status).toBe('PENDING');
  });

  it('should reconcile local patient with server ID and incremented version upon sync acknowledgment', async () => {
    const now = Date.now();
    await patientRepo.create({
      local_id: 'local-pt-002',
      server_id: null,
      demo_id: null,
      incident_id: null,
      first_name: 'Alice',
      last_name: 'Smith',
      estimated_age: 29,
      gender: 'FEMALE',
      status: 'FIELD_INTAKE',
      current_triage_category: 'YELLOW',
      chief_complaint: 'Sprained ankle',
      notes: null,
      server_version: 1,
      sync_status: 'PENDING',
      is_dirty: 1,
      client_created_at: now,
      created_at: now,
      updated_at: now,
    });

    const serverId = 'srv-pt-999';
    await patientRepo.reconcileWithServer('local-pt-002', serverId, 2);

    const byLocalId = await patientRepo.findById('local-pt-002');
    expect(byLocalId?.server_id).toBe(serverId);
    expect(byLocalId?.server_version).toBe(2);
    expect(byLocalId?.sync_status).toBe('SYNCED');
    expect(byLocalId?.is_dirty).toBe(0);

    // Can also query by server_id
    const byServerId = await patientRepo.findById(serverId);
    expect(byServerId?.local_id).toBe('local-pt-002');
  });

  it('should support append-only vital signs observations without updates or deletions', async () => {
    const now = Date.now();
    await vitalsRepo.insert({
      id: 'vital-001',
      local_patient_id: 'local-pt-001',
      server_patient_id: null,
      recorded_by: 'paramedic-1',
      systolic_bp: 120,
      diastolic_bp: 80,
      heart_rate: 75,
      respiratory_rate: 16,
      oxygen_saturation: 98.5,
      temperature: 36.6,
      gcs_score: 15,
      source: 'PARAMEDIC_FIELD',
      sync_status: 'PENDING',
      recorded_at: now - 1000,
      created_at: now - 1000,
    });

    await vitalsRepo.insert({
      id: 'vital-002',
      local_patient_id: 'local-pt-001',
      server_patient_id: null,
      recorded_by: 'paramedic-1',
      systolic_bp: 110,
      diastolic_bp: 70,
      heart_rate: 85,
      respiratory_rate: 18,
      oxygen_saturation: 97.0,
      temperature: 36.8,
      gcs_score: 15,
      source: 'PARAMEDIC_FIELD',
      sync_status: 'PENDING',
      recorded_at: now,
      created_at: now,
    });

    const history = await vitalsRepo.findByPatientId('local-pt-001');
    expect(history).toHaveLength(2);
    // Chronologically descending
    expect(history[0].id).toBe('vital-002');
    expect(history[1].id).toBe('vital-001');
  });

  it('should insert and retrieve local triage assessments chronologically', async () => {
    const triageRepo = new TriageLocalRepository(db);
    const now = Date.now();

    await triageRepo.create({
      id: 'local-asmt-001',
      local_patient_id: 'local-pt-001',
      protocol_code: 'START',
      protocol_version: '1.0.0',
      care_setting: 'PRE_HOSPITAL',
      calculated_category: 'YELLOW',
      assessment_source: 'FIELD_START',
      assessed_at: now - 5000,
      created_at: now - 5000,
      sync_status: 'PENDING',
    });

    await triageRepo.create({
      id: 'local-asmt-002',
      local_patient_id: 'local-pt-001',
      protocol_code: 'START',
      protocol_version: '1.0.0',
      care_setting: 'PRE_HOSPITAL',
      calculated_category: 'RED',
      assessment_source: 'FIELD_START',
      assessed_at: now,
      created_at: now,
      sync_status: 'PENDING',
    });

    const assessments = await triageRepo.findByPatientId('local-pt-001');
    expect(assessments).toHaveLength(2);
    expect(assessments[0].id).toBe('local-asmt-002');
    expect(assessments[0].calculated_category).toBe('RED');
    expect(assessments[1].id).toBe('local-asmt-001');
    expect(assessments[1].calculated_category).toBe('YELLOW');

    const pending = await triageRepo.findPendingSync();
    expect(pending).toHaveLength(2);

    await triageRepo.markSynced('local-asmt-001');
    const remainingPending = await triageRepo.findPendingSync();
    expect(remainingPending).toHaveLength(1);
    expect(remainingPending[0].id).toBe('local-asmt-002');
  });
});

