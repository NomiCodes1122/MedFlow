export type SyncEngineState = 'IDLE' | 'SYNCING' | 'PAUSED' | 'ERROR';

export type ErrorCategory =
  | 'RETRYABLE'
  | 'NON_RETRYABLE'
  | 'CONFLICT'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'VALIDATION';

export interface SyncOperationResult {
  operationId: string;
  status: 'APPLIED' | 'DUPLICATE_IGNORED' | 'CONFLICT' | 'FAILED';
  serverTimestamp: string;
  responsePayload?: Record<string, any> | null;
  conflictDetails?: {
    message: string;
    currentServerVersion?: number;
    expectedVersion?: number;
    currentServerState?: Record<string, any> | null;
  } | null;
  error?: {
    code: string;
    message: string;
  } | null;
}

export interface SyncBatchResponse {
  processedAt: string;
  results: SyncOperationResult[];
}

export interface ConflictReport {
  operationId: string;
  entityType: string;
  entityId: string;
  localPayload: Record<string, any>;
  serverVersion?: number;
  expectedVersion?: number;
  message: string;
  detectedAt: number;
}
