import { describe, it, expect, beforeEach } from 'vitest';
import { NodeSqliteAdapter } from './sqlite.adapter.js';
import { runMigrations } from './migrations/index.js';
import { PatientLocalRepository } from './repositories/patient.repository.js';
import { VitalsLocalRepository } from './repositories/vitals.repository.js';

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
});
