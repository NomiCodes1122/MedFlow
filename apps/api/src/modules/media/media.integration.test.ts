import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  Gender,
  PatientStatus,
  TriageCategory,
  UserRole,
  UserStatus,
  MediaType,
  MediaStatus,
} from '@prisma/client';
import { app } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { TokenService } from '../auth/token.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import {
  MemoryStorageProvider,
  FirebaseStorageProvider,
  SupabaseStorageProvider,
  setStorageProvider,
} from './storage.provider.js';
import { ApiError } from '../../common/errors/ApiError.js';

vi.mock('../../database/prisma.js', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
      },
      refreshToken: {
        findUnique: vi.fn(),
      },
      patient: {
        findUnique: vi.fn(),
      },
      patientMedia: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

describe('Media Domain API Integration Tests (Phase 8)', () => {
  let memoryStorage: MemoryStorageProvider;

  const mockParamedic = {
    id: '11111111-1111-1111-1111-111111111111',
    supabaseUid: 'fb-paramedic-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor (Lead Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockDoctor = {
    id: '22222222-2222-2222-2222-222222222222',
    supabaseUid: 'fb-doctor-001',
    phone: '+15550100002',
    displayName: 'Dr. Marcus Vance (ER Lead)',
    role: UserRole.TRIAGE_DOCTOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockSuperintendent = {
    id: '33333333-3333-3333-3333-333333333333',
    supabaseUid: 'fb-super-001',
    phone: '+15550100003',
    displayName: 'Chief Elena Rostova',
    role: UserRole.HOSPITAL_SUPERINTENDENT,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockOtherParamedic = {
    id: '44444444-4444-4444-4444-444444444444',
    supabaseUid: 'fb-paramedic-002',
    phone: '+15550100004',
    displayName: 'John Davis (Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const samplePatient = {
    id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    demoId: 'DEMO-PT-001',
    incidentId: 'inc-9999-8888-7777',
    firstName: 'Jane',
    lastName: 'Doe',
    estimatedAge: 28,
    gender: Gender.FEMALE,
    status: PatientStatus.FIELD_INTAKE,
    currentTriageCategory: TriageCategory.YELLOW,
    chiefComplaint: 'Laceration left forearm',
    notes: 'Bandaged',
    version: 1,
    clientCreatedAt: new Date('2026-09-29T08:00:00.000Z'),
    createdAt: new Date('2026-09-29T08:00:01.000Z'),
    updatedAt: new Date('2026-09-29T08:00:01.000Z'),
    deletedAt: null,
  };

  const sampleMediaRecord = {
    id: 'e1e2e3e4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    patientId: samplePatient.id,
    uploadedBy: mockParamedic.id,
    mediaType: MediaType.PHOTO,
    storagePath: `incidents/${samplePatient.incidentId}/patients/${samplePatient.id}/e1e2e3e4-e5f6-4a5b-8c9d-0e1f2a3b4c5d.jpg`,
    publicUrl: 'https://mock-storage.medflow.internal/test-photo.jpg',
    mimeType: 'image/jpeg',
    fileSizeBytes: 245000,
    durationSeconds: null,
    checksumSha256: 'a'.repeat(64),
    status: MediaStatus.PENDING_UPLOAD,
    clientCapturedAt: new Date('2026-09-29T08:10:00.000Z'),
    createdAt: new Date('2026-09-29T08:10:01.000Z'),
    updatedAt: new Date('2026-09-29T08:10:01.000Z'),
    patient: {
      id: samplePatient.id,
      incidentId: samplePatient.incidentId,
      demoId: samplePatient.demoId,
    },
    uploader: {
      id: mockParamedic.id,
      displayName: mockParamedic.displayName,
      role: mockParamedic.role,
    },
  };

  const paramedicToken = TokenService.signAccessToken({
    sub: mockParamedic.id,
    supabaseUid: mockParamedic.supabaseUid,
    phone: mockParamedic.phone,
    role: mockParamedic.role,
    sessionId: 'session-paramedic',
  });

  const doctorToken = TokenService.signAccessToken({
    sub: mockDoctor.id,
    supabaseUid: mockDoctor.supabaseUid,
    phone: mockDoctor.phone,
    role: mockDoctor.role,
    sessionId: 'session-doctor',
  });

  const superToken = TokenService.signAccessToken({
    sub: mockSuperintendent.id,
    supabaseUid: mockSuperintendent.supabaseUid,
    phone: mockSuperintendent.phone,
    role: mockSuperintendent.role,
    sessionId: 'session-super',
  });

  const otherParamedicToken = TokenService.signAccessToken({
    sub: mockOtherParamedic.id,
    supabaseUid: mockOtherParamedic.supabaseUid,
    phone: mockOtherParamedic.phone,
    role: mockOtherParamedic.role,
    sessionId: 'session-other-paramedic',
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockImplementation((args: any) => {
      const userId = args.where?.id;
      if (userId === mockParamedic.id) return Promise.resolve(mockParamedic as any);
      if (userId === mockDoctor.id) return Promise.resolve(mockDoctor as any);
      if (userId === mockSuperintendent.id) return Promise.resolve(mockSuperintendent as any);
      if (userId === mockOtherParamedic.id) return Promise.resolve(mockOtherParamedic as any);
      return Promise.resolve(null);
    });
    memoryStorage = new MemoryStorageProvider();
    setStorageProvider(memoryStorage);
  });

  describe('Upload Initiation (POST /api/v1/patients/:id/media)', () => {
    it('should reject unauthenticated request with 401 AUTH_REQUIRED', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 102400,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('should reject role without upload permission (e.g. Superintendent cannot initiate intake) with 403', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 102400,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('AUTH_ROLE_REQUIRED');
    });

    it('should return 404 NOT_FOUND if patient does not exist', async () => {
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 102400,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should successfully initiate photo upload for Paramedic', async () => {
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(samplePatient as any);
      vi.mocked(prisma.patientMedia.create).mockResolvedValue(sampleMediaRecord as any);

      const payload = {
        mediaType: 'PHOTO',
        mimeType: 'image/jpeg',
        fileSizeBytes: 350000,
        checksumSha256: 'b'.repeat(64),
        clientCapturedAt: new Date().toISOString(),
      };

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.uploadUrl).toBeDefined();
      expect(response.body.data.media.mediaType).toBe('PHOTO');
      expect(response.body.data.media.status).toBe('PENDING_UPLOAD');
    });

    it('should successfully initiate voice memo audio upload for Triage Doctor', async () => {
      const audioMediaRecord = {
        ...sampleMediaRecord,
        mediaType: MediaType.AUDIO,
        mimeType: 'audio/m4a',
        durationSeconds: 45,
      };

      vi.mocked(prisma.patient.findUnique).mockResolvedValue(samplePatient as any);
      vi.mocked(prisma.patientMedia.create).mockResolvedValue(audioMediaRecord as any);

      const payload = {
        mediaType: 'AUDIO',
        mimeType: 'audio/m4a',
        fileSizeBytes: 512000,
        durationSeconds: 45,
        clientCapturedAt: new Date().toISOString(),
      };

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.uploadUrl).toBeDefined();
      expect(response.body.data.media.mediaType).toBe('AUDIO');
      expect(response.body.data.media.durationSeconds).toBe(45);
    });

    it('should reject photo exceeding 5 MB limit with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 6 * 1024 * 1024, // 6 MB > 5 MB
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject audio exceeding 2 MB limit with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'AUDIO',
          mimeType: 'audio/m4a',
          fileSizeBytes: 3 * 1024 * 1024, // 3 MB > 2 MB
          durationSeconds: 30,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject audio exceeding 120s duration limit with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'AUDIO',
          mimeType: 'audio/m4a',
          fileSizeBytes: 400000,
          durationSeconds: 150, // 150s > 120s
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject prohibited / unwhitelisted MIME types with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'application/x-msdownload', // .exe
          fileSizeBytes: 2048,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Direct Upload & Magic Bytes Inspection (POST /api/v1/media/:id/upload)', () => {
    it('should successfully upload valid JPEG binary and update status to VERIFIED', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);
      vi.mocked(prisma.patientMedia.update).mockImplementation((args) => {
        return Promise.resolve({
          ...sampleMediaRecord,
          ...(args.data as any),
        } as any);
      });

      // Valid JPEG buffer starting with FF D8 FF
      const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

      const response = await request(app)
        .post(`/api/v1/media/${sampleMediaRecord.id}/upload`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .set('Content-Type', 'image/jpeg')
        .send(validJpegBuffer);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('VERIFIED');
      expect(response.body.data.publicUrl).toBeDefined();
    });

    it('should reject executable file disguised as image (e.g. DOS MZ header) with 400', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);
      vi.mocked(prisma.patientMedia.update).mockResolvedValue({
        ...sampleMediaRecord,
        status: MediaStatus.FAILED,
      } as any);

      // Malicious buffer starting with 'MZ' (0x4D, 0x5A)
      const fakeImageBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

      const response = await request(app)
        .post(`/api/v1/media/${sampleMediaRecord.id}/upload`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .set('Content-Type', 'image/jpeg')
        .send(fakeImageBuffer);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Binary file validation failed');
      expect(prisma.patientMedia.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: MediaStatus.FAILED },
        })
      );
    });

    it('should reject upload if user is not uploader or Superintendent with 403', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);

      const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const response = await request(app)
        .post(`/api/v1/media/${sampleMediaRecord.id}/upload`)
        .set('Authorization', `Bearer ${otherParamedicToken}`)
        .set('Content-Type', 'image/jpeg')
        .send(validJpegBuffer);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Media Query & Retrieval (GET /api/v1/media/:id & GET /api/v1/patients/:id/media)', () => {
    it('should retrieve a single media record by ID', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);

      const response = await request(app)
        .get(`/api/v1/media/${sampleMediaRecord.id}`)
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(sampleMediaRecord.id);
    });

    it('should list media attachments for a patient with pagination', async () => {
      vi.mocked(prisma.patient.findUnique).mockResolvedValue(samplePatient as any);
      vi.mocked(prisma.patientMedia.findMany).mockResolvedValue([sampleMediaRecord as any]);
      vi.mocked(prisma.patientMedia.count).mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBe(1);
      expect(response.body.meta.pagination.total).toBe(1);
    });
  });

  describe('Media Deletion & Authorization (DELETE /api/v1/media/:id)', () => {
    it('should reject deletion attempt by a different non-superintendent responder with 403', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);

      const response = await request(app)
        .delete(`/api/v1/media/${sampleMediaRecord.id}`)
        .set('Authorization', `Bearer ${otherParamedicToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('You do not have permission to delete this media asset');
      expect(prisma.patientMedia.delete).not.toHaveBeenCalled();
    });

    it('should allow deletion by the original uploader (Paramedic)', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);
      vi.mocked(prisma.patientMedia.delete).mockResolvedValue(sampleMediaRecord as any);

      const response = await request(app)
        .delete(`/api/v1/media/${sampleMediaRecord.id}`)
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
      expect(prisma.patientMedia.delete).toHaveBeenCalledWith({
        where: { id: sampleMediaRecord.id },
      });
    });

    it('should allow deletion by Hospital Superintendent', async () => {
      vi.mocked(prisma.patientMedia.findUnique).mockResolvedValue(sampleMediaRecord as any);
      vi.mocked(prisma.patientMedia.delete).mockResolvedValue(sampleMediaRecord as any);

      const response = await request(app)
        .delete(`/api/v1/media/${sampleMediaRecord.id}`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deleted).toBe(true);
      expect(prisma.patientMedia.delete).toHaveBeenCalledWith({
        where: { id: sampleMediaRecord.id },
      });
    });
  });

  describe('Production Storage Provider Error Handling (No Silent Fallback)', () => {
    it('should return 503 SERVICE_UNAVAILABLE when storage bucket is unprovisioned and never silently fall back', async () => {
      // Simulate production configuration with unprovisioned bucket
      const unprovisionedProvider = new SupabaseStorageProvider({ bucketName: 'unprovisioned-bucket-medflow' });
      vi.spyOn(unprovisionedProvider, 'generateUploadUrl').mockRejectedValue(
        ApiError.serviceUnavailable('Supabase storage bucket is unprovisioned or unreachable: 404 Not Found')
      );
      setStorageProvider(unprovisionedProvider);

      vi.mocked(prisma.patient.findUnique).mockResolvedValue(samplePatient as any);

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/media`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          mediaType: 'PHOTO',
          mimeType: 'image/jpeg',
          fileSizeBytes: 204800,
          clientCapturedAt: new Date().toISOString(),
        });

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.error.message).toMatch(/storage/i);
    });
  });
});
