import { SyncEntityType, SyncOpType, SyncProcessingStatus } from '@prisma/client';

export interface SyncOperationInput {
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operationType: SyncOpType;
  clientTimestamp: string;
  baseVersion?: number;
  payload: Record<string, any>;
}

export interface SyncBatchInput {
  deviceId: string;
  clientBatchTimestamp: string;
  operations: SyncOperationInput[];
}

export interface SyncOperationConflictDetails {
  message: string;
  currentServerVersion?: number;
  expectedVersion?: number;
  currentServerState?: Record<string, any> | null;
}

export interface SyncOperationErrorDetails {
  code: string;
  message: string;
}

export interface SyncOperationResult {
  operationId: string;
  status: SyncProcessingStatus;
  serverTimestamp: string;
  responsePayload?: Record<string, any> | null;
  conflictDetails?: SyncOperationConflictDetails | null;
  error?: SyncOperationErrorDetails | null;
}

export interface SyncBatchResult {
  processedAt: string;
  results: SyncOperationResult[];
}
