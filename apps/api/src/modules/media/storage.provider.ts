import { getFirebaseStorage } from '../../integrations/firebase/admin.js';
import { logger } from '../../common/logging/logger.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { env } from '../../config/env.js';
import {
  IStorageProvider,
  StorageObjectMetadata,
} from './media.types.js';

/**
 * Firebase Cloud Storage Provider
 * Generates signed v4 upload/download URLs and coordinates with Google Cloud Storage.
 * When the bucket is unreachable or unprovisioned, throws an explicit 503 SERVICE_UNAVAILABLE error.
 */
export class FirebaseStorageProvider implements IStorageProvider {
  private bucketName?: string;

  constructor(bucketName?: string) {
    this.bucketName = bucketName;
  }

  private getBucket() {
    const storage = getFirebaseStorage();
    if (!storage) {
      throw ApiError.serviceUnavailable(
        'Firebase Storage service is not initialized. Ensure Firebase project credentials are configured.'
      );
    }
    return this.bucketName ? storage.bucket(this.bucketName) : storage.bucket();
  }

  async generateUploadUrl(
    storagePath: string,
    mimeType: string,
    expiresInMinutes: number = 10
  ): Promise<string> {
    try {
      const bucket = this.getBucket();
      const file = bucket.file(storagePath);

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
        contentType: mimeType,
      });

      return url;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Failed to generate signed upload URL from Firebase Storage');
      throw ApiError.serviceUnavailable(
        `Cloud storage bucket is unprovisioned or unreachable: ${err.message}`
      );
    }
  }

  async generateDownloadUrl(
    storagePath: string,
    expiresInMinutes: number = 60
  ): Promise<string> {
    try {
      const bucket = this.getBucket();
      const file = bucket.file(storagePath);

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresInMinutes * 60 * 1000,
      });

      return url;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Failed to generate signed download URL from Firebase Storage');
      throw ApiError.serviceUnavailable(
        `Cloud storage bucket is unprovisioned or unreachable: ${err.message}`
      );
    }
  }

  async verifyObject(storagePath: string): Promise<StorageObjectMetadata> {
    try {
      const bucket = this.getBucket();
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) {
        return { exists: false };
      }

      const [metadata] = await file.getMetadata();
      return {
        exists: true,
        sizeBytes: Number(metadata.size),
        contentType: metadata.contentType,
        etag: metadata.etag,
      };
    } catch (err: any) {
      logger.warn(
        { storagePath, err: err.message },
        'Failed to verify storage object in Firebase Storage'
      );
      return { exists: false };
    }
  }

  async uploadBuffer(
    storagePath: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    try {
      const bucket = this.getBucket();
      const file = bucket.file(storagePath);

      await file.save(buffer, {
        metadata: {
          contentType: mimeType,
        },
        resumable: false,
      });

      return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Direct binary upload to Firebase Storage failed');
      throw ApiError.serviceUnavailable(
        `Direct upload failed; cloud storage bucket is unprovisioned or unreachable: ${err.message}`
      );
    }
  }

  async deleteObject(storagePath: string): Promise<boolean> {
    try {
      const bucket = this.getBucket();
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (exists) {
        await file.delete();
      }
      return true;
    } catch (err: any) {
      logger.error(
        { storagePath, err: err.message },
        'Error deleting object from Firebase Storage'
      );
      return false;
    }
  }
}

/**
 * In-Memory Storage Provider
 * Permitted ONLY through explicit test configuration.
 * Must never be silently used as a production fallback.
 */
export class MemoryStorageProvider implements IStorageProvider {
  private objects = new Map<
    string,
    { buffer: Buffer; mimeType: string; uploadedAt: Date }
  >();

  async generateUploadUrl(
    storagePath: string,
    _mimeType: string,
    expiresInMinutes: number = 10
  ): Promise<string> {
    const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
    return `https://mock-storage.medflow.internal/${encodeURIComponent(
      storagePath
    )}?expires=${expiresAt}`;
  }

  async generateDownloadUrl(
    storagePath: string,
    expiresInMinutes: number = 60
  ): Promise<string> {
    const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
    return `https://mock-storage.medflow.internal/${encodeURIComponent(
      storagePath
    )}?access=read&expires=${expiresAt}`;
  }

  async verifyObject(storagePath: string): Promise<StorageObjectMetadata> {
    const obj = this.objects.get(storagePath);
    if (!obj) {
      return { exists: false };
    }
    return {
      exists: true,
      sizeBytes: obj.buffer.length,
      contentType: obj.mimeType,
      etag: `etag-${obj.buffer.length}-${obj.uploadedAt.getTime()}`,
    };
  }

  async uploadBuffer(
    storagePath: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    this.objects.set(storagePath, {
      buffer,
      mimeType,
      uploadedAt: new Date(),
    });
    return `https://mock-storage.medflow.internal/${encodeURIComponent(storagePath)}`;
  }

  async deleteObject(storagePath: string): Promise<boolean> {
    return this.objects.delete(storagePath);
  }

  clear(): void {
    this.objects.clear();
  }

  getStoredBuffer(storagePath: string): Buffer | undefined {
    return this.objects.get(storagePath)?.buffer;
  }
}

/**
 * Supabase Storage Provider
 * Implements multimedia storage against Supabase Storage REST API using private buckets
 * and server-side service_role credentials.
 * Throws 503 SERVICE_UNAVAILABLE when bucket or service is unreachable.
 */
export class SupabaseStorageProvider implements IStorageProvider {
  private supabaseUrl: string;
  private serviceKey: string;
  private bucketName: string;

  constructor(options?: { supabaseUrl?: string; serviceKey?: string; bucketName?: string }) {
    this.supabaseUrl = options?.supabaseUrl !== undefined ? options.supabaseUrl : (env.SUPABASE_URL || '');
    this.serviceKey = options?.serviceKey !== undefined ? options.serviceKey : (env.SUPABASE_SERVICE_ROLE_KEY || '');
    this.bucketName = options?.bucketName !== undefined ? options.bucketName : (env.SUPABASE_STORAGE_BUCKET || 'medflow-media');
  }

  private ensureConfigured(): void {
    if (!this.supabaseUrl || !this.serviceKey) {
      throw ApiError.serviceUnavailable(
        'Supabase Storage is not configured. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
      );
    }
  }

  private getBaseUrl(): string {
    const cleanUrl = this.supabaseUrl.replace(/\/+$/, '');
    return `${cleanUrl}/storage/v1`;
  }

  private getHeaders(contentType: string = 'application/json'): Record<string, string> {
    return {
      'apikey': this.serviceKey,
      'Authorization': `Bearer ${this.serviceKey}`,
      'Content-Type': contentType,
    };
  }

  async generateUploadUrl(
    storagePath: string,
    mimeType: string,
    expiresInMinutes: number = 10
  ): Promise<string> {
    this.ensureConfigured();
    const cleanPath = storagePath.replace(/^\/+/, '');
    const endpoint = `${this.getBaseUrl()}/object/upload/sign/${encodeURIComponent(this.bucketName)}/${cleanPath}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, body: errorText, storagePath }, 'Supabase Storage signed upload URL failed');
        throw ApiError.serviceUnavailable(
          `Supabase storage bucket is unprovisioned or unreachable: [${response.status}] ${errorText}`
        );
      }

      const data = (await response.json()) as { url?: string; signedURL?: string; signedUrl?: string };
      const rawUploadUrl = data.url || data.signedURL || data.signedUrl;
      if (!rawUploadUrl) {
        throw ApiError.serviceUnavailable('Invalid response from Supabase Storage: missing signed upload URL');
      }

      const baseUrl = this.getBaseUrl();
      const relative = rawUploadUrl.startsWith('/') ? rawUploadUrl : `/${rawUploadUrl}`;
      return `${baseUrl}${relative}`;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Failed to generate signed upload URL from Supabase Storage');
      throw ApiError.serviceUnavailable(`Supabase storage bucket is unprovisioned or unreachable: ${err.message}`);
    }
  }

  async generateDownloadUrl(
    storagePath: string,
    expiresInMinutes: number = 60
  ): Promise<string> {
    this.ensureConfigured();
    const cleanPath = storagePath.replace(/^\/+/, '');
    const endpoint = `${this.getBaseUrl()}/object/sign/${encodeURIComponent(this.bucketName)}/${cleanPath}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({
          expiresIn: expiresInMinutes * 60,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, body: errorText, storagePath }, 'Supabase Storage signed download URL failed');
        throw ApiError.serviceUnavailable(
          `Supabase storage bucket is unprovisioned or unreachable: [${response.status}] ${errorText}`
        );
      }

      const data = (await response.json()) as { signedURL?: string; signedUrl?: string; url?: string };
      const rawSignedUrl = data.signedURL || data.signedUrl || data.url;
      if (!rawSignedUrl) {
        throw ApiError.serviceUnavailable('Invalid response from Supabase Storage: missing signed download URL');
      }

      const baseUrl = this.getBaseUrl();
      const relative = rawSignedUrl.startsWith('/') ? rawSignedUrl : `/${rawSignedUrl}`;
      return `${baseUrl}${relative}`;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Failed to generate signed download URL from Supabase Storage');
      throw ApiError.serviceUnavailable(`Supabase storage bucket is unprovisioned or unreachable: ${err.message}`);
    }
  }

  async verifyObject(storagePath: string): Promise<StorageObjectMetadata> {
    this.ensureConfigured();
    const cleanPath = storagePath.replace(/^\/+/, '');
    const segments = cleanPath.split('/');
    const filename = segments.pop() || cleanPath;
    const prefix = segments.join('/');

    const endpoint = `${this.getBaseUrl()}/object/list/${encodeURIComponent(this.bucketName)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({
          prefix,
          search: filename,
          limit: 10,
        }),
      });

      if (!response.ok) {
        logger.warn({ status: response.status, storagePath }, 'Failed to list objects in Supabase Storage');
        return { exists: false };
      }

      const items = (await response.json()) as any[];
      const match = Array.isArray(items) ? items.find((i) => i.name === filename) : null;
      if (!match) {
        return { exists: false };
      }

      return {
        exists: true,
        sizeBytes: match.metadata?.size ? Number(match.metadata.size) : undefined,
        contentType: match.metadata?.mimetype,
        etag: match.id || match.metadata?.eTag,
      };
    } catch (err: any) {
      logger.warn({ storagePath, err: err.message }, 'Failed to verify object in Supabase Storage');
      throw ApiError.serviceUnavailable(`Supabase storage bucket is unprovisioned or unreachable: ${err.message}`);
    }
  }

  async uploadBuffer(
    storagePath: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    this.ensureConfigured();
    const cleanPath = storagePath.replace(/^\/+/, '');
    const endpoint = `${this.getBaseUrl()}/object/${encodeURIComponent(this.bucketName)}/${cleanPath}`;

    try {
      const headers = this.getHeaders(mimeType);
      headers['x-upsert'] = 'true';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: buffer as any,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return `${this.getBaseUrl()}/object/authenticated/${encodeURIComponent(this.bucketName)}/${cleanPath}`;
    } catch (err: any) {
      if (err instanceof ApiError) throw err;
      logger.error({ storagePath, err: err.message }, 'Failed to upload direct binary buffer to Supabase Storage');
      throw ApiError.serviceUnavailable(`Supabase storage bucket is unprovisioned or unreachable: ${err.message}`);
    }
  }

  async uploadDirect(
    storagePath: string,
    data: Buffer,
    mimeType: string
  ): Promise<void> {
    await this.uploadBuffer(storagePath, data, mimeType);
  }

  async deleteObject(storagePath: string): Promise<boolean> {
    this.ensureConfigured();
    const cleanPath = storagePath.replace(/^\/+/, '');
    const endpoint = `${this.getBaseUrl()}/object/${encodeURIComponent(this.bucketName)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: this.getHeaders('application/json'),
        body: JSON.stringify({
          prefixes: [cleanPath],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ status: response.status, errorText, storagePath }, 'Failed to delete object from Supabase Storage');
        return false;
      }

      return true;
    } catch (err: any) {
      logger.error({ storagePath, err: err.message }, 'Failed to delete object from Supabase Storage');
      return false;
    }
  }
}

/**
 * Explicit storage provider registry.
 * Default in production/runtime: SupabaseStorageProvider.
 * Mock storage is permitted only through explicit test configuration via setStorageProvider.
 */
let configuredStorageProvider: IStorageProvider | null = null;

export function getStorageProvider(): IStorageProvider {
  if (configuredStorageProvider) {
    return configuredStorageProvider;
  }
  // Production default: real Supabase Storage provider
  return new SupabaseStorageProvider();
}

export function setStorageProvider(provider: IStorageProvider | null): void {
  configuredStorageProvider = provider;
}
