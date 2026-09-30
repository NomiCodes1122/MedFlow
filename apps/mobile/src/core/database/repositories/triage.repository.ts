import { ISqliteDatabase } from '../database.interface.js';

export interface LocalTriageRecord {
  id: string;
  local_patient_id: string;
  server_patient_id?: string | null;
  protocol_code: string;
  protocol_version: string;
  care_setting: string;
  calculated_category: string;
  overridden_category?: string | null;
  override_reason?: string | null;
  assessment_data?: string | null;
  decision_trace?: string | null;
  assessment_source: string;
  assessed_by?: string | null;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED';
  assessed_at: number;
  created_at: number;
}

export class TriageLocalRepository {
  constructor(private db: ISqliteDatabase) {}

  async create(record: LocalTriageRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO local_triage_assessments (
        id, local_patient_id, server_patient_id, protocol_code, protocol_version,
        care_setting, calculated_category, overridden_category, override_reason,
        assessment_data, decision_trace, assessment_source, assessed_by,
        sync_status, assessed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.local_patient_id,
        record.server_patient_id || null,
        record.protocol_code,
        record.protocol_version,
        record.care_setting,
        record.calculated_category,
        record.overridden_category || null,
        record.override_reason || null,
        record.assessment_data || null,
        record.decision_trace || null,
        record.assessment_source,
        record.assessed_by || null,
        record.sync_status || 'PENDING',
        record.assessed_at,
        record.created_at,
      ]
    );
  }

  async findByPatientId(localPatientId: string): Promise<LocalTriageRecord[]> {
    return this.db.getAllAsync<LocalTriageRecord>(
      'SELECT * FROM local_triage_assessments WHERE local_patient_id = ? ORDER BY assessed_at DESC',
      [localPatientId]
    );
  }

  async findPendingSync(): Promise<LocalTriageRecord[]> {
    return this.db.getAllAsync<LocalTriageRecord>(
      "SELECT * FROM local_triage_assessments WHERE sync_status = 'PENDING' ORDER BY assessed_at ASC"
    );
  }

  async markSynced(id: string): Promise<void> {
    await this.db.runAsync(
      "UPDATE local_triage_assessments SET sync_status = 'SYNCED' WHERE id = ?",
      [id]
    );
  }
}
