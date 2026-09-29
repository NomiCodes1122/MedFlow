import { ISqliteDatabase } from './database.interface.js';
import { NodeSqliteAdapter } from './sqlite.adapter.js';
import { runMigrations } from './migrations/index.js';

let defaultDatabase: ISqliteDatabase | null = null;

export async function initDatabase(db?: ISqliteDatabase): Promise<ISqliteDatabase> {
  const instance = db ?? new NodeSqliteAdapter('medflow_offline.db');
  await runMigrations(instance);
  defaultDatabase = instance;
  return instance;
}

export function getDatabase(): ISqliteDatabase {
  if (!defaultDatabase) {
    throw new Error('Database has not been initialized. Call initDatabase() first.');
  }
  return defaultDatabase;
}

export function setDatabase(db: ISqliteDatabase): void {
  defaultDatabase = db;
}
