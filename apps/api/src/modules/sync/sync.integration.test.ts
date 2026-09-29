import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  Gender,
  PatientStatus,
  SyncEntityType,
  SyncOpType,
  SyncProcessingStatus,
  TriageCategory,
  UserRole,
  UserStatus,
  VitalSource,
} from '@prisma/client';
import { app } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { TokenService } from '../auth/token.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';

vi.mock('../../database/prisma.js', () => {
  return {
    prisma: {
      $transaction: vi.fn(async (cb) => {
        // Mock transaction by passing the mocked prisma client as the transaction client tx
        return cb(prisma);
      }),
      user: {
        findUnique: vi.fn(),
      },
      refreshToken: {
        findUnique: vi.fn(),
      },
      patient: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      patientVitalSign: {
        create: vi.fn(),
      },
      incident: {
        findUnique: vi.fn(),
      },
      syncHistory: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

describe('Offline Synchronization Batch API Integration Tests', () => {
  const mockParamedic = {
    id: '11111111-1111-1111-1111-111111111111',
    firebaseUid: 'fb-paramedic-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor (Lead Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockDoctor = {
    id: '22222222-2222-2222-2222-222222222222',
    firebaseUid: 'fb-doctor-001',
    phone: '+15550100002',
    displayName: 'Dr. Marcus Vance',
    role: UserRole.TRIAGE_DOCTOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockSuperintendent = {
    id: '33333333-3333-3333-3333-333333333333',
    firebaseUid: 'fb-super-001',
    phone: '+15550100003',
    displayName: 'Chief Elena Rostova',
    role: UserRole.HOSPITAL_SUPERINTENDENT,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const samplePatient = {
    id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    demoId: 'DEMO-PT-001',
    incidentId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    estimatedAge: 28,
    gender: Gender.FEMALE,
    status: PatientStatus.FIELD_INTAKE,
    currentTriageCategory: TriageCategory.YELLOW,
    chiefComplaint: 'Fractured clavicle',
    notes: 'Splint applied',
    version: 1,
    clientCreatedAt: new Date('2026-09-29T08:00:00.000Z'),
    createdAt: new Date('2026-09-29T08:00:01.000Z'),
    updatedAt: new Date('2026-09-29T08:00:01.000Z'),
    deletedAt: null,
  };

  const sampleVital = {
    id: 'e1e2e3e4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    patientId: samplePatient.id,
    recordedBy: mockParamedic.id,
    systolicBp: 118,
    diastolicBp: 78,
    heartRate: 80,
    respiratoryRate: 18,
    oxygenSaturation: 99.0,
    temperature: 37.0,
    gcsScore: 15,
    source: VitalSource.OFFLINE_SYNC,
    recordedAt: new Date('2026-09-29T08:05:00.000Z'),
    createdAt: new Date('2026-09-29T08:05:01.000Z'),
  };

  const paramedicToken = TokenService.signAccessToken({
    sub: mockParamedic.id,
    firebaseUid: mockParamedic.firebaseUid,
    phone: mockParamedic.phone,
    role: mockParamedic.role,
    sessionId: 'session-paramedic',
  });

  const superToken = TokenService.signAccessToken({
    sub: mockSuperintendent.id,
    firebaseUid: mockSuperintendent.firebaseUid,
    phone: mockSuperintendent.phone,
    role: mockSuperintendent.role,
    sessionId: 'session-super',
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);
  });

  describe('Authorization & Validation Guards', () => {
    it('should reject unauthenticated request with 401 AUTH_REQUIRED', async () => {
      const response = await request(app).post('/api/v1/sync/batch').send({
        deviceId: 'device-001',
        clientBatchTimestamp: new Date().toISOString(),
        operations: [],
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });

    it('should deny HOSPITAL_SUPERINTENDENT from submitting sync batches with 403 AUTH_ROLE_REQUIRED', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockSuperintendent as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId: 'b1111111-1111-4111-8111-111111111111',
              entityType: SyncEntityType.PATIENT,
              entityId: samplePatient.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: { firstName: 'Test' },
            },
          ],
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });

    it('should reject empty operations array with 400 VALIDATION_ERROR', async () => {
      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('Idempotency & Duplicate Prevention', () => {
    it('should detect duplicate operation in sync_history and return cached response without duplicating write', async () => {
      const operationId = 'b1111111-1111-4111-8111-111111111111';
      const cachedPayload = { id: samplePatient.id, firstName: 'Jane', demoId: 'DEMO-PT-001' };

      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce({
        operationId,
        deviceId: 'device-001',
        userId: mockParamedic.id,
        entityType: SyncEntityType.PATIENT,
        entityId: samplePatient.id,
        operationType: SyncOpType.CREATE,
        clientTimestamp: new Date(),
        serverTimestamp: new Date('2026-09-29T08:10:00.000Z'),
        status: SyncProcessingStatus.APPLIED,
        conflictDetails: null,
        responsePayload: cachedPayload,
        appliedAt: new Date('2026-09-29T08:10:00.000Z'),
      } as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId,
              entityType: SyncEntityType.PATIENT,
              entityId: samplePatient.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: { firstName: 'Jane' },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.results).toHaveLength(1);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.DUPLICATE_IGNORED);
      expect(response.body.data.results[0].responsePayload).toEqual(cachedPayload);
      // Ensure patient.create was NEVER called
      expect(prisma.patient.create).not.toHaveBeenCalled();
    });
  });

  describe('Patient Creation via Sync', () => {
    it('should create new patient and record APPLIED in sync_history', async () => {
      const operationId = 'b2222222-2222-4222-8222-222222222222';

      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.patient.create).mockResolvedValueOnce(samplePatient as any);
      vi.mocked(prisma.syncHistory.create).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId,
              entityType: SyncEntityType.PATIENT,
              entityId: samplePatient.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: {
                firstName: 'Jane',
                lastName: 'Doe',
                estimatedAge: 28,
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.APPLIED);
      expect(response.body.data.results[0].responsePayload.id).toBe(samplePatient.id);
      expect(prisma.syncHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationId,
            status: SyncProcessingStatus.APPLIED,
          }),
        })
      );
    });
  });

  describe('Patient Update & Optimistic Concurrency Control (OCC)', () => {
    it('should apply update and advance version when expectedVersion matches', async () => {
      const operationId = 'b3333333-3333-4333-8333-333333333333';

      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.patient.findFirst)
        .mockResolvedValueOnce(samplePatient as any) // pre-check
        .mockResolvedValueOnce({ ...samplePatient, status: PatientStatus.IN_TRANSIT, version: 2 } as any); // post-update fetch
      vi.mocked(prisma.patient.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.syncHistory.create).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId,
              entityType: SyncEntityType.PATIENT,
              entityId: samplePatient.id,
              operationType: SyncOpType.UPDATE,
              clientTimestamp: new Date().toISOString(),
              baseVersion: 1,
              payload: {
                status: PatientStatus.IN_TRANSIT,
                version: 1,
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.APPLIED);
      expect(response.body.data.results[0].responsePayload.version).toBe(2);
      expect(response.body.data.results[0].responsePayload.status).toBe(PatientStatus.IN_TRANSIT);
    });

    it('should detect OCC version conflict and record CONFLICT in sync_history when version is stale', async () => {
      const operationId = 'b4444444-4444-4444-8444-444444444444';

      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce({
        ...samplePatient,
        version: 3, // Database has moved to version 3
      } as any);
      vi.mocked(prisma.syncHistory.create).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId,
              entityType: SyncEntityType.PATIENT,
              entityId: samplePatient.id,
              operationType: SyncOpType.UPDATE,
              clientTimestamp: new Date().toISOString(),
              baseVersion: 1, // Stale client version 1
              payload: {
                status: PatientStatus.ARRIVED_ER,
                version: 1,
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.CONFLICT);
      expect(response.body.data.results[0].conflictDetails.currentServerVersion).toBe(3);
      expect(response.body.data.results[0].conflictDetails.expectedVersion).toBe(1);
      expect(prisma.patient.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Append-Only Vital Signs Observation Sync', () => {
    it('should record offline vital signs observation and record APPLIED in sync_history', async () => {
      const operationId = 'b5555555-5555-4555-8555-555555555555';

      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce(samplePatient as any);
      vi.mocked(prisma.patientVitalSign.create).mockResolvedValueOnce(sampleVital as any);
      vi.mocked(prisma.syncHistory.create).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId,
              entityType: SyncEntityType.OBSERVATION,
              entityId: sampleVital.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: {
                patientId: samplePatient.id,
                systolicBp: 118,
                diastolicBp: 78,
                heartRate: 80,
                oxygenSaturation: 99.0,
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.APPLIED);
      expect(response.body.data.results[0].responsePayload.id).toBe(sampleVital.id);
      expect(response.body.data.results[0].responsePayload.heartRate).toBe(80);
      expect(prisma.patientVitalSign.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: sampleVital.id,
            patientId: samplePatient.id,
            source: VitalSource.OFFLINE_SYNC,
          }),
        })
      );
    });
  });
});
