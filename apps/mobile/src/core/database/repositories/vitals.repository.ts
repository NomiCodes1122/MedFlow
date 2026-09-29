import { ISqliteDatabase } from '../database.interface.js';

export interface LocalVitalSignRecord {
  id: string;
  local_patient_id: string;
  server_patient_id: string | null;
  recorded_by: string | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  oxygen_saturation: number | null;
  temperature: number | null;
  gcs_score: number | null;
  source: string;
  sync_status: 'PENDING' | 'SYNCED';
  recorded_at: number;
  created_at: number;
}

export class VitalsLocalRepository {
  constructor(private db: ISqliteDatabase) {}

  /**
   * Appends an immutable point-in-time clinical observation.
   * Observations are strictly append-only; update/delete operations do not exist.
   */
  async insert(vital: LocalVitalSignRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO patient_vitals (
        id, local_patient_id, server_patient_id, recorded_by,
        systolic_bp, diastolic_bp, heart_rate, respiratory_rate,
        oxygen_saturation, temperature, gcs_score, source,
        sync_status, recorded_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vital.id,
        vital.local_patient_id,
        vital.server_patient_id,
        vital.recorded_by,
        vital.systolic_bp,
        vital.diastolic_bp,
        vital.heart_rate,
        vital.respiratory_rate,
        vital.oxygen_saturation,
        vital.temperature,
        vital.gcs_score,
        vital.source,
        vital.sync_status,
        vital.recorded_at,
        vital.created_at,
      ]
    );
  }

  async findByPatientId(patientId: string): Promise<LocalVitalSignRecord[]> {
    return this.db.getAllAsync<LocalVitalSignRecord>(
      `SELECT * FROM patient_vitals
       WHERE local_patient_id = ? OR server_patient_id = ?
       ORDER BY recorded_at DESC`,
      [patientId, patientId]
    );
  }

  async markSynced(id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE patient_vitals SET sync_status = 'SYNCED' WHERE id = ?`,
      [id]
    );
  }

  async updateServerPatientId(localPatientId: string, serverPatientId: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE patient_vitals SET server_patient_id = ? WHERE local_patient_id = ?`,
      [serverPatientId, localPatientId]
    );
  }
}
