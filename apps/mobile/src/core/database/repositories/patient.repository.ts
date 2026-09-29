import { ISqliteDatabase } from '../database.interface.js';

export interface LocalPatientRecord {
  local_id: string;
  server_id: string | null;
  demo_id: string | null;
  incident_id: string | null;
  first_name: string | null;
  last_name: string | null;
  estimated_age: number | null;
  gender: string;
  status: string;
  current_triage_category: string;
  chief_complaint: string | null;
  notes: string | null;
  server_version: number;
  sync_status: 'PENDING' | 'SYNCED' | 'CONFLICT';
  is_dirty: number;
  client_created_at: number;
  created_at: number;
  updated_at: number;
}

export class PatientLocalRepository {
  constructor(private db: ISqliteDatabase) {}

  async create(patient: LocalPatientRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO patients (
        local_id, server_id, demo_id, incident_id, first_name, last_name,
        estimated_age, gender, status, current_triage_category, chief_complaint,
        notes, server_version, sync_status, is_dirty, client_created_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patient.local_id,
        patient.server_id,
        patient.demo_id,
        patient.incident_id,
        patient.first_name,
        patient.last_name,
        patient.estimated_age,
        patient.gender,
        patient.status,
        patient.current_triage_category,
        patient.chief_complaint,
        patient.notes,
        patient.server_version,
        patient.sync_status,
        patient.is_dirty,
        patient.client_created_at,
        patient.created_at,
        patient.updated_at,
      ]
    );
  }

  async findById(localId: string): Promise<LocalPatientRecord | null> {
    return this.db.getFirstAsync<LocalPatientRecord>(
      'SELECT * FROM patients WHERE local_id = ? OR server_id = ?',
      [localId, localId]
    );
  }

  async findAll(filter?: { incidentId?: string; status?: string }): Promise<LocalPatientRecord[]> {
    let sql = 'SELECT * FROM patients WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.incidentId) {
      sql += ' AND incident_id = ?';
      params.push(filter.incidentId);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY created_at DESC';
    return this.db.getAllAsync<LocalPatientRecord>(sql, params);
  }

  async update(localId: string, updates: Partial<LocalPatientRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    const allowedFields: (keyof LocalPatientRecord)[] = [
      'first_name',
      'last_name',
      'estimated_age',
      'gender',
      'status',
      'current_triage_category',
      'chief_complaint',
      'notes',
      'incident_id',
      'sync_status',
      'is_dirty',
      'updated_at',
    ];

    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    }

    if (fields.length === 0) return;

    values.push(localId);
    await this.db.runAsync(
      `UPDATE patients SET ${fields.join(', ')} WHERE local_id = ? OR server_id = ?`,
      [...values, localId]
    );
  }

  async reconcileWithServer(
    localId: string,
    serverId: string,
    serverVersion: number
  ): Promise<void> {
    await this.db.runAsync(
      `UPDATE patients SET
        server_id = ?,
        server_version = ?,
        sync_status = 'SYNCED',
        is_dirty = 0,
        updated_at = ?
      WHERE local_id = ? OR server_id = ?`,
      [serverId, serverVersion, Date.now(), localId, localId]
    );
  }

  async markConflict(localId: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE patients SET sync_status = 'CONFLICT', updated_at = ? WHERE local_id = ? OR server_id = ?`,
      [Date.now(), localId, localId]
    );
  }
}
