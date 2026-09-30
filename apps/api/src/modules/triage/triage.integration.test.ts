import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  Gender,
  PatientStatus,
  TriageCategory,
  UserRole,
  UserStatus,
  TriageSource,
} from '@prisma/client';
import { app } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { TokenService } from '../auth/token.service.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { TriageRepository } from './triage.repository.js';

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
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      triageAssessment: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  };
});

describe('Triage Domain API Integration Tests', () => {
  const mockParamedic = {
    id: '11111111-1111-1111-1111-111111111111',
    supabaseUid: 'fb-paramedic-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor (Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockDoctor = {
    id: '22222222-2222-2222-2222-222222222222',
    supabaseUid: 'fb-doctor-001',
    phone: '+15550100002',
    displayName: 'Dr. Marcus Vance (ER Doctor)',
    role: UserRole.TRIAGE_DOCTOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const mockSuperintendent = {
    id: '33333333-3333-3333-3333-333333333333',
    supabaseUid: 'fb-super-001',
    phone: '+15550100003',
    displayName: 'Chief Helen Cho (Superintendent)',
    role: UserRole.HOSPITAL_SUPERINTENDENT,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const validPatientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const samplePatient = {
    id: validPatientId,
    demoId: 'DEMO-PT-001',
    incidentId: null,
    firstName: 'John',
    lastName: 'Doe',
    estimatedAge: 35,
    gender: Gender.MALE,
    status: PatientStatus.FIELD_INTAKE,
    currentTriageCategory: TriageCategory.UNASSESSED,
    currentTriageAssessmentId: null,
    currentTriageAssessment: null,
    version: 1,
    deletedAt: null,
  };

  const sampleAssessment = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    patientId: validPatientId,
    assessedBy: mockParamedic.id,
    protocolCode: 'START',
    protocolVersion: '1.0.0',
    careSetting: 'PRE_HOSPITAL',
    calculatedCategory: TriageCategory.YELLOW,
    overriddenCategory: null,
    overrideReason: null,
    assessmentData: { canWalk: false, respiratoryRate: 20 },
    decisionTrace: null,
    isCurrent: false,
    assessmentSource: TriageSource.FIELD_START,
    assessedAt: new Date('2026-09-29T10:00:00.000Z'),
    createdAt: new Date('2026-09-29T10:00:00.000Z'),
    canWalk: false,
    hasRespirations: true,
    respiratoryRate: 20,
    radialPulse: true,
    capillaryRefillSec: 1.5,
    followsCommands: true,
  };

  const paramedicToken = TokenService.signAccessToken({
    sub: mockParamedic.id,
    supabaseUid: mockParamedic.supabaseUid,
    phone: mockParamedic.phone,
    role: mockParamedic.role,
    sessionId: 'session-paramedic-001',
  });

  const doctorToken = TokenService.signAccessToken({
    sub: mockDoctor.id,
    supabaseUid: mockDoctor.supabaseUid,
    phone: mockDoctor.phone,
    role: mockDoctor.role,
    sessionId: 'session-doctor-001',
  });

  const superToken = TokenService.signAccessToken({
    sub: mockSuperintendent.id,
    supabaseUid: mockSuperintendent.supabaseUid,
    phone: mockSuperintendent.phone,
    role: mockSuperintendent.role,
    sessionId: 'session-super-001',
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock auth middleware lookups
    vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValue(true);
    vi.spyOn(prisma.user, 'findUnique').mockImplementation((args: any) => {
      if (args.where.id === mockParamedic.id) return Promise.resolve(mockParamedic as any);
      if (args.where.id === mockDoctor.id) return Promise.resolve(mockDoctor as any);
      if (args.where.id === mockSuperintendent.id) return Promise.resolve(mockSuperintendent as any);
      return Promise.resolve(null);
    });
  });

  describe('Authentication & Authorization Enforcements', () => {
    it('POST /api/v1/patients/:id/triage returns 401 when unauthenticated', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .send({
          calculatedCategory: 'YELLOW',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('POST /api/v1/patients/:id/triage returns 403 when accessed by HOSPITAL_SUPERINTENDENT', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'YELLOW',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_ROLE_REQUIRED');
    });
  });

  describe('Triage Assessment Creation & Validation', () => {
    it('returns 400 if calculatedCategory is invalid or missing', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'INVALID_CATEGORY',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 if override is specified without an overrideReason', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'YELLOW',
          overriddenCategory: 'RED',
          overrideReason: '', // missing
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 403 if PARAMEDIC attempts to submit an override', async () => {
      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'YELLOW',
          overriddenCategory: 'RED',
          overrideReason: 'Paramedic attempting physician override',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Clinical triage category override requires authorization');
    });

    it('records valid triage assessment successfully by PARAMEDIC', async () => {
      const txMock = {
        patient: {
          findFirst: vi.fn().mockResolvedValue(samplePatient),
        },
        triageAssessment: {
          create: vi.fn().mockResolvedValue(sampleAssessment),
        },
      };

      vi.spyOn(TriageRepository, 'withTransaction').mockImplementation(async (cb: any) => {
        return cb(txMock);
      });

      vi.spyOn(TriageRepository, 'updatePatientActiveTriage').mockResolvedValue({
        count: 1,
      });

      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'YELLOW',
          assessmentData: { canWalk: false, respiratoryRate: 20 },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(sampleAssessment.id);
      expect(response.body.data.calculatedCategory).toBe('YELLOW');
      expect(response.body.data.effectiveCategory).toBe('YELLOW');
      expect(response.body.data.isCurrent).toBe(true);
    });

    it('records valid category override by TRIAGE_DOCTOR', async () => {
      const overriddenAssessment = {
        ...sampleAssessment,
        calculatedCategory: TriageCategory.YELLOW,
        overriddenCategory: TriageCategory.RED,
        overrideReason: 'Deterioration with tachypnea observed during secondary survey',
      };

      const txMock = {
        patient: {
          findFirst: vi.fn().mockResolvedValue(samplePatient),
        },
        triageAssessment: {
          create: vi.fn().mockResolvedValue(overriddenAssessment),
        },
      };

      vi.spyOn(TriageRepository, 'withTransaction').mockImplementation(async (cb: any) => {
        return cb(txMock);
      });

      vi.spyOn(TriageRepository, 'updatePatientActiveTriage').mockResolvedValue({
        count: 1,
      });

      const response = await request(app)
        .post(`/api/v1/patients/${validPatientId}/triage`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: 'YELLOW',
          overriddenCategory: 'RED',
          overrideReason: 'Deterioration with tachypnea observed during secondary survey',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.effectiveCategory).toBe('RED');
      expect(response.body.data.calculatedCategory).toBe('YELLOW');
      expect(response.body.data.overriddenCategory).toBe('RED');
    });
  });

  describe('Triage History, Queue, and Protocol Endpoints', () => {
    it('GET /api/v1/patients/:id/triage/history returns chronological assessments', async () => {
      vi.spyOn(TriageRepository, 'findPatientForTriage').mockResolvedValue(samplePatient as any);
      vi.spyOn(TriageRepository, 'findHistoryByPatientId').mockResolvedValue([sampleAssessment as any]);
      vi.spyOn(TriageRepository, 'countByPatientId').mockResolvedValue(1);

      const response = await request(app)
        .get(`/api/v1/patients/${validPatientId}/triage/history`)
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.meta.pagination.total).toBe(1);
    });

    it('GET /api/v1/triage/queue lists triage queue', async () => {
      vi.spyOn(TriageRepository, 'findTriageQueue').mockResolvedValue({
        patients: [
          {
            ...samplePatient,
            currentTriageAssessment: sampleAssessment,
          } as any,
        ],
        total: 1,
      });

      const response = await request(app)
        .get('/api/v1/triage/queue')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].patientId).toBe(validPatientId);
    });

    it('GET /api/v1/triage/protocols returns registered protocols with approval metadata', async () => {
      const response = await request(app)
        .get('/api/v1/triage/protocols')
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.protocols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            protocolCode: 'START',
            isApproved: false,
            approvalStatus: 'PENDING_CLINICAL_APPROVAL',
          }),
          expect.objectContaining({
            protocolCode: 'WHO_MC_IITT',
            isApproved: false,
            approvalStatus: 'PENDING_CLINICAL_APPROVAL',
          }),
        ])
      );
    });
  });
});
