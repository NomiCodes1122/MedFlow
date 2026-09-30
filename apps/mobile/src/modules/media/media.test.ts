import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeSqliteAdapter } from '../../core/database/sqlite.adapter.js';
import { runMigrations } from '../../core/database/migrations/index.js';
import { MediaLocalRepository } from '../../core/database/repositories/media.repository.js';
import { ImageProcessor } from './image-processor.js';
import { AudioProcessor } from './audio-processor.js';
import { MediaUploadWorker } from './media-upload.worker.js';
import { MobileMediaService } from './media.service.js';

describe('Mobile Multimedia Module Tests (Phase 8)', () => {
  describe('ImageProcessor', () => {
    it('should process a valid JPEG photo, compute SHA-256 and scale dimensions', () => {
      const mockBuffer = Buffer.from('mock-jpeg-image-bytes-'.repeat(100));
      const result = ImageProcessor.processPhoto(
        'file:///cache/photo_01.jpg',
        mockBuffer,
        'image/jpeg',
        { maxWidth: 1200 }
      );

      expect(result.uri).toBe('file:///cache/photo_01.jpg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBeLessThanOrEqual(1200);
      expect(result.checksumSha256).toHaveLength(64);
      expect(result.fileSizeBytes).toBe(mockBuffer.length);
      expect(result.compressed).toBe(true);
    });

    it('should parse real binary JPEG SOF0 markers and scale dimensions to 1600px', () => {
      // Valid minimal JPEG with SOF0: height=1800 (0x0708), width=2400 (0x0960)
      const soi = Buffer.from([0xff, 0xd8]);
      const sof0 = Buffer.from([
        0xff, 0xc0, 0x00, 0x11, 0x08,
        0x07, 0x08, // height: 1800
        0x09, 0x60, // width: 2400
        0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      ]);
      const eoi = Buffer.from([0xff, 0xd9]);
      const realJpeg = Buffer.concat([soi, sof0, eoi]);

      const result = ImageProcessor.processPhoto(
        'file:///cache/real_wound.jpg',
        realJpeg,
        'image/jpeg',
        { maxWidth: 1600 }
      );

      expect(result.width).toBe(1600);
      expect(result.height).toBe(1200); // 1800 * (1600/2400) = 1200
      expect(result.compressed).toBe(true);
      expect(result.processedBuffer).toBeDefined();
    });

    it('should parse real binary PNG IHDR chunk and scale dimensions', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const ihdr = Buffer.alloc(25);
      ihdr.writeUInt32BE(13, 0); // chunk length
      ihdr.write('IHDR', 4);
      ihdr.writeUInt32BE(2000, 8); // width: 2000
      ihdr.writeUInt32BE(1500, 12); // height: 1500
      const realPng = Buffer.concat([pngHeader, ihdr]);

      const result = ImageProcessor.processPhoto(
        'file:///cache/real_xray.png',
        realPng,
        'image/png',
        { maxWidth: 1600 }
      );

      expect(result.width).toBe(1600);
      expect(result.height).toBe(1200);
      expect(result.compressed).toBe(true);
    });

    it('should reject image file exceeding hard 5 MB limit', () => {
      // 6 MB buffer
      const oversizedBuffer = Buffer.alloc(6 * 1024 * 1024);

      expect(() => {
        ImageProcessor.processPhoto(
          'file:///cache/oversized.jpg',
          oversizedBuffer,
          'image/jpeg'
        );
      }).toThrow(/exceeds hard limit of 5 MB/);
    });

    it('should reject unsupported image MIME types', () => {
      const mockBuffer = Buffer.from('pdf-content-bytes-header');

      expect(() => {
        ImageProcessor.processPhoto(
          'file:///cache/doc.pdf',
          mockBuffer,
          'application/pdf'
        );
      }).toThrow(/Unsupported image MIME type/);
    });
  });

  describe('AudioProcessor', () => {
    it('should process a valid AAC/M4A voice memo within duration and size bounds', () => {
      const mockAudioBuffer = Buffer.from('mock-audio-data-bytes-'.repeat(50));
      const result = AudioProcessor.processAudio(
        'file:///cache/memo_01.m4a',
        mockAudioBuffer,
        45, // 45 seconds duration
        'audio/m4a'
      );

      expect(result.uri).toBe('file:///cache/memo_01.m4a');
      expect(result.mimeType).toBe('audio/m4a');
      expect(result.durationSeconds).toBe(45);
      expect(result.checksumSha256).toHaveLength(64);
      expect(result.fileSizeBytes).toBe(mockAudioBuffer.length);
    });

    it('should parse real binary M4A moov/mvhd box timescale and duration', () => {
      const ftyp = Buffer.alloc(16);
      ftyp.writeUInt32BE(16, 0);
      ftyp.write('ftyp', 4);
      ftyp.write('M4A ', 8);

      const mvhd = Buffer.alloc(32);
      mvhd.writeUInt32BE(32, 0);
      mvhd.write('mvhd', 4);
      mvhd[8] = 0; // version 0
      mvhd.writeUInt32BE(1000, 20); // timescale: 1000 units/sec
      mvhd.writeUInt32BE(35000, 24); // duration: 35000 units = 35.0s

      const moov = Buffer.concat([Buffer.alloc(8), mvhd]);
      moov.writeUInt32BE(moov.length, 0);
      moov.write('moov', 4);

      const realM4a = Buffer.concat([ftyp, moov]);

      const result = AudioProcessor.processAudio(
        'file:///cache/real_memo.m4a',
        realM4a,
        35,
        'audio/m4a'
      );

      expect(result.durationSeconds).toBe(35);
      expect(result.fileSizeBytes).toBe(realM4a.length);
      expect(result.checksumSha256).toBeDefined();
    });

    it('should reject audio exceeding 120 seconds duration', () => {
      const mockAudioBuffer = Buffer.from('mock-audio-data');

      expect(() => {
        AudioProcessor.processAudio(
          'file:///cache/memo_too_long.m4a',
          mockAudioBuffer,
          150, // 150 seconds > 120s limit
          'audio/m4a'
        );
      }).toThrow(/outside allowed range/);
    });

    it('should reject audio exceeding 2 MB size limit', () => {
      const oversizedAudio = Buffer.alloc(2.5 * 1024 * 1024);

      expect(() => {
        AudioProcessor.processAudio(
          'file:///cache/huge_audio.m4a',
          oversizedAudio,
          60,
          'audio/m4a'
        );
      }).toThrow(/exceeds maximum permitted limit of 2 MB/);
    });

    it('should reject unsupported audio MIME formats', () => {
      const mockAudioBuffer = Buffer.from('mock-wav-data');

      expect(() => {
        AudioProcessor.processAudio(
          'file:///cache/unsupported.wav',
          mockAudioBuffer,
          30,
          'audio/wav'
        );
      }).toThrow(/Unsupported audio format/);
    });
  });

  describe('MediaLocalRepository & SQLite Queue', () => {
    let db: NodeSqliteAdapter;
    let mediaRepo: MediaLocalRepository;

    beforeEach(async () => {
      db = new NodeSqliteAdapter(':memory:');
      await runMigrations(db);
      mediaRepo = new MediaLocalRepository(db);
    });

    it('should enqueue a media record into local_media_queue with PENDING status', async () => {
      const now = Date.now();
      await mediaRepo.enqueue({
        id: 'media-local-001',
        local_patient_id: 'patient-local-001',
        server_patient_id: null,
        media_type: 'PHOTO',
        local_uri: 'file:///cache/injury_photo.jpg',
        mime_type: 'image/jpeg',
        file_size_bytes: 450000,
        duration_seconds: null,
        checksum_sha256: 'c'.repeat(64),
        sync_status: 'PENDING',
        retry_count: 0,
        max_retries: 5,
        last_error_message: null,
        next_retry_at: null,
        server_media_id: null,
        storage_path: null,
        remote_url: null,
        captured_at: now,
        created_at: now,
        updated_at: now,
      });

      const retrieved = await mediaRepo.findById('media-local-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.local_patient_id).toBe('patient-local-001');
      expect(retrieved?.media_type).toBe('PHOTO');
      expect(retrieved?.sync_status).toBe('PENDING');
    });

    it('should retrieve media items by patient local ID in descending order', async () => {
      const now = Date.now();
      await mediaRepo.enqueue({
        id: 'photo-1',
        local_patient_id: 'pt-100',
        server_patient_id: null,
        media_type: 'PHOTO',
        local_uri: 'file:///photo1.jpg',
        mime_type: 'image/jpeg',
        file_size_bytes: 300000,
        duration_seconds: null,
        checksum_sha256: null,
        sync_status: 'PENDING',
        retry_count: 0,
        max_retries: 5,
        last_error_message: null,
        next_retry_at: null,
        server_media_id: null,
        storage_path: null,
        remote_url: null,
        captured_at: now - 1000,
        created_at: now - 1000,
        updated_at: now - 1000,
      });

      await mediaRepo.enqueue({
        id: 'audio-1',
        local_patient_id: 'pt-100',
        server_patient_id: null,
        media_type: 'AUDIO',
        local_uri: 'file:///memo1.m4a',
        mime_type: 'audio/m4a',
        file_size_bytes: 120000,
        duration_seconds: 30,
        checksum_sha256: null,
        sync_status: 'PENDING',
        retry_count: 0,
        max_retries: 5,
        last_error_message: null,
        next_retry_at: null,
        server_media_id: null,
        storage_path: null,
        remote_url: null,
        captured_at: now,
        created_at: now,
        updated_at: now,
      });

      const items = await mediaRepo.findByPatientId('pt-100');
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe('audio-1'); // Most recent first
      expect(items[1].id).toBe('photo-1');
    });
  });

  describe('MediaUploadWorker & MobileMediaService', () => {
    let db: NodeSqliteAdapter;
    let mediaRepo: MediaLocalRepository;

    beforeEach(async () => {
      db = new NodeSqliteAdapter(':memory:');
      await runMigrations(db);
      mediaRepo = new MediaLocalRepository(db);
    });

    it('should successfully upload pending media item and transition status to SYNCED', async () => {
      const mockUploadHandler = vi.fn().mockResolvedValue({
        serverMediaId: 'server-media-uuid-999',
        storagePath: 'incidents/general/patients/p1/server-media-uuid-999.jpg',
        remoteUrl: 'https://storage.medflow.internal/file.jpg',
      });

      const worker = new MediaUploadWorker(mediaRepo, mockUploadHandler);
      const mediaService = new MobileMediaService(mediaRepo);

      const record = await mediaService.enqueuePhoto({
        localPatientId: 'pt-test-01',
        localUri: 'file:///data/photo.jpg',
        fileSizeBytes: 250000,
      });

      const processed = await worker.processQueue();
      expect(processed).toBe(1);
      expect(mockUploadHandler).toHaveBeenCalledWith(
        expect.objectContaining({ id: record.id })
      );

      const updated = await mediaRepo.findById(record.id);
      expect(updated?.sync_status).toBe('SYNCED');
      expect(updated?.server_media_id).toBe('server-media-uuid-999');
      expect(updated?.storage_path).toBeDefined();
    });

    it('should handle upload error with exponential retry backoff and FAILED status', async () => {
      const mockUploadHandler = vi.fn().mockRejectedValue(new Error('Network connection timeout'));

      const worker = new MediaUploadWorker(mediaRepo, mockUploadHandler);
      const mediaService = new MobileMediaService(mediaRepo);

      const record = await mediaService.enqueueVoiceMemo({
        localPatientId: 'pt-test-02',
        localUri: 'file:///data/voice.m4a',
        durationSeconds: 40,
        fileSizeBytes: 180000,
      });

      const now = Date.now();
      const processed = await worker.processQueue(now);
      expect(processed).toBe(1);

      const updated = await mediaRepo.findById(record.id);
      expect(updated?.sync_status).toBe('FAILED');
      expect(updated?.retry_count).toBe(1);
      expect(updated?.last_error_message).toBe('Network connection timeout');
      expect(updated?.next_retry_at).toBeGreaterThan(now);
    });

    it('should automatically trigger worker when worker is injected into service', async () => {
      let resolveUpload: (val: any) => void;
      const uploadPromise = new Promise((resolve) => {
        resolveUpload = resolve;
      });

      const mockUploadHandler = vi.fn().mockImplementation(async () => {
        resolveUpload({
          serverMediaId: 'server-auto-001',
          storagePath: 'incidents/auto/patients/p1/001.jpg',
          remoteUrl: 'https://storage.medflow.internal/auto.jpg',
        });
        return {
          serverMediaId: 'server-auto-001',
          storagePath: 'incidents/auto/patients/p1/001.jpg',
          remoteUrl: 'https://storage.medflow.internal/auto.jpg',
        };
      });

      const worker = new MediaUploadWorker(mediaRepo, mockUploadHandler);
      const mediaService = new MobileMediaService(mediaRepo, worker);

      const record = await mediaService.enqueuePhoto({
        localPatientId: 'pt-auto-01',
        localUri: 'file:///data/auto.jpg',
        fileSizeBytes: 100000,
      });

      // Wait for the non-blocking worker execution triggered by enqueuePhoto
      await uploadPromise;

      // Small delay to allow updateStatus to finish
      await new Promise((r) => setTimeout(r, 50));

      const updated = await mediaRepo.findById(record.id);
      expect(updated?.sync_status).toBe('SYNCED');
    });
  });
});
