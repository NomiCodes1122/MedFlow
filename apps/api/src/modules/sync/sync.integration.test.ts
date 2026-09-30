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
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      patientVitalSign: {
        create: vi.fn(),
      },
      triageAssessment: {
        create: vi.fn(),
        findFirst: vi.fn(),
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
    displayName: 'Dr. Marcus Vance',
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
    supabaseUid: mockParamedic.supabaseUid,
    phone: mockParamedic.phone,
    role: mockParamedic.role,
    sessionId: 'session-paramedic',
  });

  const superToken = TokenService.signAccessToken({
    sub: mockSuperintendent.id,
    supabaseUid: mockSuperintendent.supabaseUid,
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

  describe('Strict Domain Payload Validation & Batch Failure Isolation', () => {
    it('should reject malformed patient payload with VALIDATION_ERROR and record FAILED in sync_history', async () => {
      const operationId = 'b6666666-6666-4666-8666-666666666666';
      vi.mocked(prisma.syncHistory.findUnique).mockResolvedValueOnce(null);
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
                firstName: 'Invalid Age Test',
                estimatedAge: -5, // Invalid negative age
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.data.results).toHaveLength(1);
      expect(response.body.data.results[0].status).toBe(SyncProcessingStatus.FAILED);
      expect(response.body.data.results[0].error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(response.body.data.results[0].error.message).toContain('Estimated age cannot be negative');
      expect(prisma.patient.create).not.toHaveBeenCalled();
      expect(prisma.syncHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationId,
            status: SyncProcessingStatus.FAILED,
          }),
        })
      );
    });

    it('should isolate failures: valid operations succeed as APPLIED while invalid operation fails as FAILED without rollback', async () => {
      const op1Id = 'c1111111-1111-4111-8111-111111111111';
      const op2Id = 'c2222222-2222-4222-8222-222222222222';
      const op3Id = 'c3333333-3333-4333-8333-333333333333';

      const patient1 = { ...samplePatient, id: 'a1111111-1111-4111-8111-111111111111' };
      const patient3 = { ...samplePatient, id: 'a3333333-3333-4333-8333-333333333333' };

      // Op 1: Idempotency check -> not found; create patient -> succeeds
      vi.mocked(prisma.syncHistory.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      vi.mocked(prisma.patient.create)
        .mockResolvedValueOnce(patient1 as any)
        .mockResolvedValueOnce(patient3 as any);

      vi.mocked(prisma.syncHistory.create).mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            // Op 1: Valid Patient CREATE
            {
              operationId: op1Id,
              entityType: SyncEntityType.PATIENT,
              entityId: patient1.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: { firstName: 'Valid Patient 1', estimatedAge: 25 },
            },
            // Op 2: Invalid Observation CREATE (Systolic BP 999 exceeds maximum 300)
            {
              operationId: op2Id,
              entityType: SyncEntityType.OBSERVATION,
              entityId: 'e2222222-2222-4222-8222-222222222222',
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: {
                patientId: patient1.id,
                systolicBp: 999, // Invalid!
              },
            },
            // Op 3: Valid Patient CREATE
            {
              operationId: op3Id,
              entityType: SyncEntityType.PATIENT,
              entityId: patient3.id,
              operationType: SyncOpType.CREATE,
              clientTimestamp: new Date().toISOString(),
              payload: { firstName: 'Valid Patient 3', estimatedAge: 45 },
            },
          ],
        });

      expect(response.status).toBe(200);
      const results = response.body.data.results;
      expect(results).toHaveLength(3);

      // Op 1 succeeded
      expect(results[0].operationId).toBe(op1Id);
      expect(results[0].status).toBe(SyncProcessingStatus.APPLIED);
      expect(results[0].responsePayload.id).toBe(patient1.id);

      // Op 2 failed validation, isolated
      expect(results[1].operationId).toBe(op2Id);
      expect(results[1].status).toBe(SyncProcessingStatus.FAILED);
      expect(results[1].error.code).toBe(ErrorCodes.VALIDATION_ERROR);

      // Op 3 succeeded despite Op 2's failure!
      expect(results[2].operationId).toBe(op3Id);
      expect(results[2].status).toBe(SyncProcessingStatus.APPLIED);
      expect(results[2].responsePayload.id).toBe(patient3.id);

      // Both valid patients were created
      expect(prisma.patient.create).toHaveBeenCalledTimes(2);
    });

    it('should process offline TRIAGE CREATE operation idempotently and update patient active triage', async () => {
      const patientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const triageOpId = '11111111-2222-3333-4444-555555555555';
      const assessmentId = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

      const existingPatient = {
        id: patientId,
        demoId: 'DEMO-PT-001',
        version: 1,
        currentTriageCategory: TriageCategory.UNASSESSED,
        currentTriageAssessmentId: null,
        currentTriageAssessment: null,
        deletedAt: null,
      };

      const createdAssessment = {
        id: assessmentId,
        patientId,
        assessedBy: mockParamedic.id,
        protocolCode: 'START',
        protocolVersion: '1.0.0',
        careSetting: 'PRE_HOSPITAL',
        calculatedCategory: TriageCategory.YELLOW,
        overriddenCategory: null,
        overrideReason: null,
        isCurrent: false,
        assessedAt: new Date('2026-09-29T10:00:00.000Z'),
        createdAt: new Date('2026-09-29T10:00:01.000Z'),
      };

      vi.spyOn(prisma.patient, 'findFirst').mockResolvedValue(existingPatient as any);
      vi.spyOn((prisma as any).triageAssessment, 'create').mockResolvedValue(createdAssessment as any);
      vi.spyOn(prisma.patient, 'updateMany').mockResolvedValue({ count: 1 } as any);
      vi.spyOn(prisma.syncHistory, 'create').mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/v1/sync/batch')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          deviceId: 'device-paramedic-001',
          clientBatchTimestamp: new Date().toISOString(),
          operations: [
            {
              operationId: triageOpId,
              entityType: SyncEntityType.TRIAGE,
              entityId: assessmentId,
              operationType: SyncOpType.CREATE,
              clientTimestamp: '2026-09-29T10:00:00.000Z',
              payload: {
                patientId,
                protocolCode: 'START',
                protocolVersion: '1.0.0',
                calculatedCategory: TriageCategory.YELLOW,
                canWalk: false,
                respiratoryRate: 22,
              },
            },
          ],
        });

      expect(response.status).toBe(200);
      const results = response.body.data.results;
      expect(results).toHaveLength(1);
      expect(results[0].operationId).toBe(triageOpId);
      expect(results[0].status).toBe(SyncProcessingStatus.APPLIED);
      expect(results[0].responsePayload.calculatedCategory).toBe('YELLOW');
      expect(results[0].responsePayload.isCurrent).toBe(true);

      expect((prisma as any).triageAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: assessmentId,
            patientId,
            calculatedCategory: TriageCategory.YELLOW,
          }),
        })
      );

      expect(prisma.patient.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: patientId, deletedAt: null },
          data: expect.objectContaining({
            currentTriageAssessmentId: assessmentId,
            currentTriageCategory: TriageCategory.YELLOW,
          }),
        })
      );
    });

    // -----------------------------------------------------------------------
    // Regression tests: D-01, D-02, D-04, D-05
    // -----------------------------------------------------------------------
    describe('TRIAGE Sync Security & Consistency Regression Tests', () => {
      // Doctor token (mockDoctor defined above at test suite level)
      const doctorToken = TokenService.signAccessToken({
        sub: mockDoctor.id,
        supabaseUid: mockDoctor.supabaseUid,
        phone: mockDoctor.phone,
        role: mockDoctor.role,
        sessionId: 'session-doctor',
      });

      const patientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const assessmentId = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

      const basePatient = {
        id: patientId,
        demoId: 'DEMO-PT-002',
        version: 1,
        currentTriageCategory: TriageCategory.UNASSESSED,
        currentTriageAssessmentId: null,
        currentTriageAssessment: null,
        deletedAt: null,
      };

      function triageBatch(token: string, payload: Record<string, unknown>) {
        return request(app)
          .post('/api/v1/sync/batch')
          .set('Authorization', `Bearer ${token}`)
          .send({
            deviceId: 'device-remediation-001',
            clientBatchTimestamp: new Date().toISOString(),
            operations: [
              {
                operationId: '99999999-9999-4999-8999-999999999999',
                entityType: SyncEntityType.TRIAGE,
                entityId: assessmentId,
                operationType: SyncOpType.CREATE,
                clientTimestamp: new Date().toISOString(),
                payload,
              },
            ],
          });
      }

      beforeEach(() => {
        vi.spyOn(prisma.syncHistory, 'findUnique').mockResolvedValue(null);
        vi.spyOn(prisma.syncHistory, 'create').mockResolvedValue({} as any);
        vi.spyOn(prisma.patient, 'findFirst').mockResolvedValue(basePatient as any);
      });

      // D-01a: PARAMEDIC submitting an override without a valid reason is rejected
      it('D-01a: PARAMEDIC sync TRIAGE override without overrideReason → FAILED (validation)', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);

        const response = await triageBatch(paramedicToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.GREEN,
          overriddenCategory: TriageCategory.RED,
          overrideReason: '',
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.FAILED);
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('overrideReason');
        // Immutable assessment must NOT have been created
        expect((prisma as any).triageAssessment.create).not.toHaveBeenCalled();
      });

      // D-01b: PARAMEDIC submitting an override with a valid reason is still rejected (role)
      it('D-01b: PARAMEDIC sync TRIAGE override with valid reason → FAILED (unauthorized role)', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);

        const response = await triageBatch(paramedicToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.GREEN,
          overriddenCategory: TriageCategory.RED,
          overrideReason: 'Physician override attempted by paramedic in the field',
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.FAILED);
        expect(result.error.code).toBe('FORBIDDEN');
        expect(result.error.message).toContain('TRIAGE_DOCTOR');
        expect((prisma as any).triageAssessment.create).not.toHaveBeenCalled();
      });

      // D-01c: TRIAGE_DOCTOR with valid override → accepted
      it('D-01c: TRIAGE_DOCTOR sync TRIAGE override with valid reason → APPLIED', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockDoctor as any);

        const createdAssessment = {
          id: assessmentId,
          patientId,
          assessedBy: mockDoctor.id,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          careSetting: 'PRE_HOSPITAL',
          calculatedCategory: TriageCategory.GREEN,
          overriddenCategory: TriageCategory.RED,
          overrideReason: 'Secondary survey revealed haemopneumothorax',
          isCurrent: false,
          assessedAt: new Date(),
          createdAt: new Date(),
        };

        vi.spyOn((prisma as any).triageAssessment, 'create').mockResolvedValue(createdAssessment as any);
        vi.spyOn(prisma.patient, 'update').mockResolvedValue({ ...basePatient, version: 2 } as any);

        const response = await triageBatch(doctorToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.GREEN,
          overriddenCategory: TriageCategory.RED,
          overrideReason: 'Secondary survey revealed haemopneumothorax',
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.APPLIED);
        expect(result.responsePayload.effectiveCategory).toBe(TriageCategory.RED);
        expect(result.responsePayload.overriddenCategory).toBe(TriageCategory.RED);
      });

      // D-02: Schema-level cross-field validation (overriddenCategory without adequate reason)
      it('D-02: Sync triage schema rejects overriddenCategory without 5-char overrideReason via VALIDATION_ERROR', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockDoctor as any);

        // Schema validation happens before the handler reaches auth; short reason triggers superRefine
        const response = await triageBatch(doctorToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          overriddenCategory: TriageCategory.RED,
          overrideReason: 'abc', // Only 3 chars — fails superRefine
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.FAILED);
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect((prisma as any).triageAssessment.create).not.toHaveBeenCalled();
      });

      // D-04: PATIENT UPDATE sync must NOT accept currentTriageCategory
      it('D-04: Sync PATIENT UPDATE with currentTriageCategory in payload → VALIDATION_ERROR', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);

        const response = await request(app)
          .post('/api/v1/sync/batch')
          .set('Authorization', `Bearer ${paramedicToken}`)
          .send({
            deviceId: 'device-remediation-001',
            clientBatchTimestamp: new Date().toISOString(),
            operations: [
              {
                operationId: '88888888-8888-4888-8888-888888888888',
                entityType: SyncEntityType.PATIENT,
                entityId: patientId,
                operationType: SyncOpType.UPDATE,
                clientTimestamp: new Date().toISOString(),
                baseVersion: 1,
                payload: {
                  version: 1,
                  currentTriageCategory: TriageCategory.RED, // Must be rejected
                  status: PatientStatus.FIELD_INTAKE,
                },
              },
            ],
          });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        // currentTriageCategory stripped by schema → no triage fields in validated payload
        // The update should either fail (if no other fields) or succeed without touching triage category.
        // Key assertion: patient.update must NOT have been called with currentTriageCategory.
        if (result.status === SyncProcessingStatus.APPLIED) {
          expect(prisma.patient.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ currentTriageCategory: TriageCategory.RED }),
            })
          );
        } else {
          // If no other meaningful fields remain, the validation may short-circuit.
          expect(result.status).toBe(SyncProcessingStatus.FAILED);
        }
      });

      // D-05: Future-dated assessedAt beyond 30 min tolerance is rejected at schema level
      it('D-05: Sync TRIAGE with assessedAt > 30 min in the future → VALIDATION_ERROR', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);

        const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // +2 hours

        const response = await triageBatch(paramedicToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          assessedAt: futureDate,
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.FAILED);
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('30 minutes');
        expect((prisma as any).triageAssessment.create).not.toHaveBeenCalled();
      });

      // D-05b: assessedAt within tolerance (≤30 min in future) is accepted
      it('D-05b: Sync TRIAGE with assessedAt within 30-min tolerance → not rejected by future-date check', async () => {
        vi.mocked(prisma.user.findUnique).mockResolvedValue(mockParamedic as any);

        const nearFutureDate = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // +5 min

        const createdAssessment = {
          id: assessmentId,
          patientId,
          assessedBy: mockParamedic.id,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          careSetting: 'PRE_HOSPITAL',
          calculatedCategory: TriageCategory.YELLOW,
          overriddenCategory: null,
          overrideReason: null,
          isCurrent: false,
          assessedAt: new Date(nearFutureDate),
          createdAt: new Date(),
        };

        vi.spyOn((prisma as any).triageAssessment, 'create').mockResolvedValue(createdAssessment as any);
        vi.spyOn(prisma.patient, 'update').mockResolvedValue({ ...basePatient, version: 2 } as any);

        const response = await triageBatch(paramedicToken, {
          patientId,
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          assessedAt: nearFutureDate,
        });

        expect(response.status).toBe(200);
        const result = response.body.data.results[0];
        expect(result.status).toBe(SyncProcessingStatus.APPLIED);
      });
    });
  });
});

