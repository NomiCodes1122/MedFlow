import BetterSqlite3 from 'better-sqlite3';
import { ISqliteDatabase, QueryResult } from './database.interface.js';

export class NodeSqliteAdapter implements ISqliteDatabase {
  private db: BetterSqlite3.Database;
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(filename: string = ':memory:') {
    this.db = new BetterSqlite3(filename);
    this.db.pragma('journal_mode = WAL');
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
      changes: result.changes,
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
    const execute = async () => {
      this.db.exec('BEGIN TRANSACTION');
      try {
        const result = await action();
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // Ignore rollback error if already closed
        }
        throw err;
      }
    };

    const previousQueue = this.transactionQueue;
    let resolveQueue: () => void;
    this.transactionQueue = new Promise<void>((resolve) => {
      resolveQueue = resolve;
    });

    try {
      await previousQueue;
      return await execute();
    } finally {
      resolveQueue!();
    }
  }

  async closeAsync(): Promise<void> {
    this.db.close();
  }
}
