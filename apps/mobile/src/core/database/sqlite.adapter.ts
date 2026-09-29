import { DatabaseSync } from 'node:sqlite';
import { ISqliteDatabase, QueryResult } from './database.interface.js';

export class NodeSqliteAdapter implements ISqliteDatabase {
  private db: DatabaseSync;

  constructor(filename: string = ':memory:') {
    this.db = new DatabaseSync(filename);
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  private sanitizeParams(params: unknown[]): any[] {
    return params.map((p) => (p === undefined ? null : p));
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...this.sanitizeParams(params));
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...this.sanitizeParams(params));
    return rows as T[];
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...this.sanitizeParams(params));
    return (row as T) ?? null;
  }

  async withTransactionAsync<T>(action: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = await action();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async closeAsync(): Promise<void> {
    this.db.close();
  }
}
