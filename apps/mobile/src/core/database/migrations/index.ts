import { ISqliteDatabase } from '../database.interface.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: ISqliteDatabase) => Promise<void>;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: '001_initial_schema',
    up: async (db: ISqliteDatabase) => {
      // 1. Patients Table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS patients (
          local_id TEXT PRIMARY KEY,
          server_id TEXT,
          demo_id TEXT,
          incident_id TEXT,
          first_name TEXT,
          last_name TEXT,
          estimated_age INTEGER,
          gender TEXT,
          status TEXT,
          current_triage_category TEXT,
          chief_complaint TEXT,
          notes TEXT,
          server_version INTEGER DEFAULT 1,
          sync_status TEXT NOT NULL DEFAULT 'PENDING',
          is_dirty INTEGER NOT NULL DEFAULT 1,
          client_created_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_patients_server_id ON patients(server_id);
        CREATE INDEX IF NOT EXISTS idx_patients_sync_status ON patients(sync_status);
        CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC);
      `);

      // 2. Patient Vitals Table (Append-Only)
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS patient_vitals (
          id TEXT PRIMARY KEY,
          local_patient_id TEXT NOT NULL,
          server_patient_id TEXT,
          recorded_by TEXT,
          systolic_bp INTEGER,
          diastolic_bp INTEGER,
          heart_rate INTEGER,
          respiratory_rate INTEGER,
          oxygen_saturation REAL,
          temperature REAL,
          gcs_score INTEGER,
          source TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'PENDING',
          recorded_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_patient_vitals_patient ON patient_vitals(local_patient_id, recorded_at DESC);
        CREATE INDEX IF NOT EXISTS idx_patient_vitals_sync ON patient_vitals(sync_status);
      `);

      // 3. Durable Outbox Operations Queue Table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS outbox_operations (
          operation_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          base_version INTEGER,
          sync_status TEXT NOT NULL,
          client_timestamp INTEGER NOT NULL,
          server_timestamp INTEGER,
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 5,
          last_error_message TEXT,
          last_error_code TEXT,
          next_retry_at INTEGER,
          conflict_details TEXT,
          last_attempt_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_operations(sync_status, next_retry_at, created_at);
      `);

      // 4. Sync Metadata Table (Key-Value)
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
];

export async function runMigrations(db: ISqliteDatabase): Promise<void> {
  // Ensure schema_migrations table exists
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = await db.getAllAsync<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      await db.withTransactionAsync(async () => {
        await migration.up(db);
        await db.runAsync(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, Date.now()]
        );
      });
    }
  }
}
