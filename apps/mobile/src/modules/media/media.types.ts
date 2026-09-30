export type MobileMediaType = 'PHOTO' | 'AUDIO';

export type MediaSyncStatus = 'PENDING' | 'UPLOADING' | 'SYNCED' | 'FAILED';

export interface ImageProcessingOptions {
  maxWidth?: number; // default 1600
  quality?: number;  // default 0.75 (75%)
}

export interface ImageProcessingResult {
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  checksumSha256: string;
  compressed: boolean;
  processedBuffer?: Buffer;
}

export interface AudioProcessingResult {
  uri: string;
  mimeType: string;
  durationSeconds: number;
  fileSizeBytes: number;
  checksumSha256: string;
  processedBuffer?: Buffer;
}

export interface CapturePhotoInput {
  localPatientId: string;
  serverPatientId?: string | null;
  localUri: string;
  mimeType?: string;
  fileSizeBytes?: number;
  capturedAt?: number;
}

export interface RecordVoiceMemoInput {
  localPatientId: string;
  serverPatientId?: string | null;
  localUri: string;
  durationSeconds: number;
  mimeType?: string;
  fileSizeBytes?: number;
  capturedAt?: number;
}
