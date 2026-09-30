import { ISqliteDatabase, QueryResult } from './database.interface.js';

export interface ExpoSqliteDatabaseOptions {
  encryptionKey?: string;
}

/**
 * Expo SQLite Adapter
 * Implements ISqliteDatabase targeting the native Expo SQLite runtime (expo-sqlite).
 * Supports SQLCipher encryption key derivation and initialization via PRAGMA key.
 */
export class ExpoSqliteAdapter implements ISqliteDatabase {
  private nativeDb: any;
  private encryptionKey?: string;

  constructor(nativeDb: any, options?: ExpoSqliteDatabaseOptions) {
    this.nativeDb = nativeDb;
    this.encryptionKey = options?.encryptionKey;
  }

  /**
   * Initializes the database connection, configuring SQLCipher encryption if a key is provided.
   */
  async initialize(): Promise<void> {
    if (this.encryptionKey) {
      // Configure SQLCipher PRAGMA key on connection establishment
      await this.execAsync(`PRAGMA key = '${this.encryptionKey.replace(/'/g, "''")}';`);
      await this.execAsync('PRAGMA cipher_compatibility = 4;');
    }
    // Enable Write-Ahead Logging (WAL) for high concurrency
    await this.execAsync('PRAGMA journal_mode = WAL;');
    await this.execAsync('PRAGMA foreign_keys = ON;');
  }

  async execAsync(sql: string): Promise<void> {
    if (typeof this.nativeDb.execAsync === 'function') {
      await this.nativeDb.execAsync(sql);
    } else {
      throw new Error('Expo SQLite execAsync is not available on provided native driver');
    }
  }

  private sanitizeParams(params: unknown[]): any[] {
    return params.map((p) => (p === undefined ? null : p));
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (typeof this.nativeDb.runAsync === 'function') {
      const result = await this.nativeDb.runAsync(sql, ...this.sanitizeParams(params));
      return {
        changes: Number(result.changes || 0),
        lastInsertRowId: Number(result.lastInsertRowId || 0),
      };
    }
    throw new Error('Expo SQLite runAsync is not available on provided native driver');
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (typeof this.nativeDb.getAllAsync === 'function') {
      return await this.nativeDb.getAllAsync(sql, ...this.sanitizeParams(params));
    }
    throw new Error('Expo SQLite getAllAsync is not available on provided native driver');
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (typeof this.nativeDb.getFirstAsync === 'function') {
      const row = await this.nativeDb.getFirstAsync(sql, ...this.sanitizeParams(params));
      return (row as T) ?? null;
    }
    throw new Error('Expo SQLite getFirstAsync is not available on provided native driver');
  }

  async withTransactionAsync<T>(action: () => Promise<T>): Promise<T> {
    if (typeof this.nativeDb.withTransactionAsync === 'function') {
      return await this.nativeDb.withTransactionAsync(action);
    }
    // Fallback manual transaction control
    await this.execAsync('BEGIN TRANSACTION');
    try {
      const result = await action();
      await this.execAsync('COMMIT');
      return result;
    } catch (err) {
      await this.execAsync('ROLLBACK');
      throw err;
    }
  }

  async closeAsync(): Promise<void> {
    if (typeof this.nativeDb.closeAsync === 'function') {
      await this.nativeDb.closeAsync();
    }
  }
}
