import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseStorageProvider } from './storage.provider.js';
import { ApiError } from '../../common/errors/ApiError.js';

describe('SupabaseStorageProvider Unit Tests', () => {
  const mockSupabaseUrl = 'https://mock-proj.supabase.co';
  const mockServiceKey = 'mock-service-role-key-secret-12345';
  const mockBucket = 'medflow-media';

  let provider: SupabaseStorageProvider;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    provider = new SupabaseStorageProvider({
      supabaseUrl: mockSupabaseUrl,
      serviceKey: mockServiceKey,
      bucketName: mockBucket,
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should throw 503 SERVICE_UNAVAILABLE when service credentials are empty', async () => {
      const unconfigured = new SupabaseStorageProvider({
        supabaseUrl: '',
        serviceKey: '',
        bucketName: mockBucket,
      });

      await expect(
        unconfigured.generateUploadUrl('test.jpg', 'image/jpeg')
      ).rejects.toThrow(ApiError);

      try {
        await unconfigured.generateUploadUrl('test.jpg', 'image/jpeg');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
      }
    });
  });

  describe('Signed Upload URL Generation', () => {
    it('should send correct headers and return absolute signed upload URL on success', async () => {
      const mockRelativeUrl = '/object/upload/sign/medflow-media/patients/p1/photo.jpg?token=mock-upload-token';
      
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ url: mockRelativeUrl }),
      } as Response);

      const result = await provider.generateUploadUrl('patients/p1/photo.jpg', 'image/jpeg', 15);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];

      expect(url).toBe('https://mock-proj.supabase.co/storage/v1/object/upload/sign/medflow-media/patients/p1/photo.jpg');
      expect((init?.headers as any)['apikey']).toBe(mockServiceKey);
      expect((init?.headers as any)['Authorization']).toBe(`Bearer ${mockServiceKey}`);
      expect(result).toBe('https://mock-proj.supabase.co/storage/v1/object/upload/sign/medflow-media/patients/p1/photo.jpg?token=mock-upload-token');
    });

    it('should throw 503 when Supabase returns 404 bucket not found or 400 error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }),
      } as Response);

      await expect(
        provider.generateUploadUrl('patients/p1/photo.jpg', 'image/jpeg')
      ).rejects.toThrow(ApiError);

      try {
        await provider.generateUploadUrl('patients/p1/photo.jpg', 'image/jpeg');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.message).toMatch(/unprovisioned or unreachable/i);
      }
    });

    it('should throw 503 on network fetch failure without falling back to mock storage', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      await expect(
        provider.generateUploadUrl('patients/p1/photo.jpg', 'image/jpeg')
      ).rejects.toThrow(ApiError);

      try {
        await provider.generateUploadUrl('patients/p1/photo.jpg', 'image/jpeg');
      } catch (err: any) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
      }
    });
  });

  describe('Signed Download URL Generation', () => {
    it('should send expiration and return absolute signed download URL on success', async () => {
      const mockRelativeUrl = '/object/sign/medflow-media/patients/p1/photo.jpg?token=mock-download-token';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ signedUrl: mockRelativeUrl }),
      } as Response);

      const result = await provider.generateDownloadUrl('patients/p1/photo.jpg', 60);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];

      expect(url).toBe('https://mock-proj.supabase.co/storage/v1/object/sign/medflow-media/patients/p1/photo.jpg');
      expect(JSON.parse(init?.body as string)).toEqual({ expiresIn: 3600 });
      expect(result).toBe('https://mock-proj.supabase.co/storage/v1/object/sign/medflow-media/patients/p1/photo.jpg?token=mock-download-token');
    });

    it('should throw 503 when signed download generation fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal storage error',
      } as Response);

      await expect(
        provider.generateDownloadUrl('patients/p1/photo.jpg')
      ).rejects.toThrow(ApiError);
    });
  });

  describe('Object Verification & Metadata', () => {
    it('should return exists: true and metadata when object is found in bucket list', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            name: 'photo.jpg',
            id: 'uuid-object-1',
            metadata: {
              size: 204800,
              mimetype: 'image/jpeg',
              eTag: '"etag-12345"',
            },
          },
        ],
      } as Response);

      const result = await provider.verifyObject('incidents/inc-1/patients/p1/photo.jpg');

      expect(result.exists).toBe(true);
      expect(result.sizeBytes).toBe(204800);
      expect(result.contentType).toBe('image/jpeg');
    });

    it('should return exists: false when object is not found in folder', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      } as Response);

      const result = await provider.verifyObject('incidents/inc-1/patients/p1/missing.jpg');

      expect(result.exists).toBe(false);
    });
  });

  describe('Direct Binary Upload', () => {
    it('should upload binary buffer with x-upsert header', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Key: 'medflow-media/test.jpg' }),
      } as Response);

      const data = Buffer.from('mock binary data');
      await expect(provider.uploadDirect('test.jpg', data, 'image/jpeg')).resolves.not.toThrow();

      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toBe('https://mock-proj.supabase.co/storage/v1/object/medflow-media/test.jpg');
      expect((init?.headers as any)['x-upsert']).toBe('true');
    });

    it('should throw 503 when direct upload fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Access Denied',
      } as Response);

      const data = Buffer.from('mock binary data');
      await expect(provider.uploadDirect('test.jpg', data, 'image/jpeg')).rejects.toThrow(ApiError);
    });
  });

  describe('Object Deletion', () => {
    it('should send prefixes array and return true on successful deletion', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ message: 'Successfully deleted' }]),
      } as Response);

      const deleted = await provider.deleteObject('incidents/inc-1/patients/p1/photo.jpg');

      expect(deleted).toBe(true);
      const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(url).toBe('https://mock-proj.supabase.co/storage/v1/object/medflow-media');
      expect(JSON.parse(init?.body as string)).toEqual({
        prefixes: ['incidents/inc-1/patients/p1/photo.jpg'],
      });
    });

    it('should return false when deletion endpoint returns non-ok status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      } as Response);

      const deleted = await provider.deleteObject('missing.jpg');
      expect(deleted).toBe(false);
    });
  });
});
