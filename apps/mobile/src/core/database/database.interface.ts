export interface QueryResult {
  changes: number;
  lastInsertRowId: number;
}

export interface ISqliteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<QueryResult>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  withTransactionAsync<T>(action: () => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}
