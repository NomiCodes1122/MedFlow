import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  Gender,
  PatientStatus,
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
      user: {
        findUnique: vi.fn(),
      },
      refreshToken: {
        findUnique: vi.fn(),
      },
      patient: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      patientVitalSign: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      incident: {
        findUnique: vi.fn(),
      },
    },
  };
});

describe('Patient Domain API Integration Tests', () => {
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
    displayName: 'Dr. Marcus Vance (ER Lead)',
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
    id: 'v1v2v3v4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    patientId: samplePatient.id,
    recordedBy: mockParamedic.id,
    systolicBp: 118,
    diastolicBp: 78,
    heartRate: 80,
    respiratoryRate: 18,
    oxygenSaturation: 99.0,
    temperature: 37.0,
    gcsScore: 15,
    source: VitalSource.PARAMEDIC_FIELD,
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

  const doctorToken = TokenService.signAccessToken({
    sub: mockDoctor.id,
    firebaseUid: mockDoctor.firebaseUid,
    phone: mockDoctor.phone,
    role: mockDoctor.role,
    sessionId: 'session-doctor',
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
  });

  describe('Authentication & Authorization Guards', () => {
    it('should reject unauthenticated request with 401 AUTH_REQUIRED', async () => {
      const response = await request(app).get('/api/v1/patients');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });

    it('should allow PARAMEDIC to create patient', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.patient.create).mockResolvedValueOnce(samplePatient as any);

      const response = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
          estimatedAge: 28,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(samplePatient.id);
    });

    it('should allow TRIAGE_DOCTOR to create patient', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockDoctor as any);
      vi.mocked(prisma.patient.create).mockResolvedValueOnce(samplePatient as any);

      const response = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should deny HOSPITAL_SUPERINTENDENT from creating patient with 403 AUTH_ROLE_REQUIRED', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockSuperintendent as any);

      const response = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });
  });

  describe('GET /api/v1/patients (List Patients)', () => {
    it('should allow HOSPITAL_SUPERINTENDENT to list patients', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockSuperintendent as any);
      vi.mocked(prisma.patient.findMany).mockResolvedValueOnce([samplePatient as any]);
      vi.mocked(prisma.patient.count).mockResolvedValueOnce(1);

      const response = await request(app)
        .get('/api/v1/patients?page=1&limit=10')
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.pagination.totalPages).toBe(1);
    });
  });

  describe('GET /api/v1/patients/:id (Get Patient)', () => {
    it('should return patient when UUID exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce(samplePatient as any);

      const response = await request(app)
        .get(`/api/v1/patients/${samplePatient.id}`)
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.demoId).toBe('DEMO-PT-001');
    });

    it('should return 400 VALIDATION_ERROR on malformed UUID parameter', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(app)
        .get('/api/v1/patients/not-a-valid-uuid')
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return 404 NOT_FOUND when patient does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce(null);

      const response = await request(app)
        .get(`/api/v1/patients/${samplePatient.id}`)
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  describe('PATCH /api/v1/patients/:id (Update & OCC)', () => {
    it('should require version field for optimistic concurrency control', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(app)
        .patch(`/api/v1/patients/${samplePatient.id}`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          status: PatientStatus.IN_TRANSIT,
          // Omitted version
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return 409 CONFLICT when stale version is presented', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockDoctor as any);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce({
        ...samplePatient,
        version: 2, // Database has moved to version 2
      } as any);

      const response = await request(app)
        .patch(`/api/v1/patients/${samplePatient.id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          version: 1, // Stale client version
          status: PatientStatus.ARRIVED_ER,
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(ErrorCodes.CONFLICT);
      expect(response.body.error.message).toContain('version conflict');
    });

    it('should update successfully and increment version when version matches', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockDoctor as any);
      vi.mocked(prisma.patient.findFirst)
        .mockResolvedValueOnce(samplePatient as any) // lookup check
        .mockResolvedValueOnce({
          ...samplePatient,
          status: PatientStatus.ARRIVED_ER,
          version: 2,
        } as any); // updated record fetch

      vi.mocked(prisma.patient.updateMany).mockResolvedValueOnce({ count: 1 });

      const response = await request(app)
        .patch(`/api/v1/patients/${samplePatient.id}`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          version: 1,
          status: PatientStatus.ARRIVED_ER,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.version).toBe(2);
      expect(response.body.data.status).toBe(PatientStatus.ARRIVED_ER);
    });
  });

  describe('POST /api/v1/patients/:id/vitals (Append-Only Observations)', () => {
    it('should record vital signs observation successfully', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce(samplePatient as any);
      vi.mocked(prisma.patientVitalSign.create).mockResolvedValueOnce(sampleVital as any);

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/vitals`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          systolicBp: 118,
          diastolicBp: 78,
          heartRate: 80,
          oxygenSaturation: 99.0,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.systolicBp).toBe(118);
      expect(response.body.data.heartRate).toBe(80);
    });

    it('should reject out-of-bounds physiological vital signs', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(app)
        .post(`/api/v1/patients/${samplePatient.id}/vitals`)
        .set('Authorization', `Bearer ${paramedicToken}`)
        .send({
          heartRate: 350, // Impossible tachycardia > 300 bpm
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('GET /api/v1/patients/:id/vitals (Get Vital Signs History)', () => {
    it('should return chronological history of vitals', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockDoctor as any);
      vi.mocked(prisma.patient.findFirst).mockResolvedValueOnce(samplePatient as any);
      vi.mocked(prisma.patientVitalSign.findMany).mockResolvedValueOnce([sampleVital as any]);

      const response = await request(app)
        .get(`/api/v1/patients/${samplePatient.id}/vitals`)
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].patientId).toBe(samplePatient.id);
    });
  });
});
