import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Gender,
  PatientStatus,
  TriageCategory,
  UserRole,
  IncidentStatus,
  VitalSource,
} from '@prisma/client';
import { PatientService } from './patient.service.js';
import { PatientRepository } from './patient.repository.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';
import { AuthenticatedUserContext } from '../../types/express.js';

describe('PatientService Unit Tests', () => {
  const mockUserContext: AuthenticatedUserContext = {
    userId: '11111111-1111-1111-1111-111111111111',
    firebaseUid: 'fb-paramedic-001',
    phone: '+15550100001',
    role: UserRole.PARAMEDIC,
    sessionId: 'session-uuid-001',
  };

  const mockDoctorContext: AuthenticatedUserContext = {
    userId: '22222222-2222-2222-2222-222222222222',
    firebaseUid: 'fb-doctor-001',
    phone: '+15550100002',
    role: UserRole.TRIAGE_DOCTOR,
    sessionId: 'session-uuid-002',
  };

  const samplePatient = {
    id: 'pt-uuid-0000-0000-0000-000000000001',
    demoId: 'DEMO-PT-001',
    incidentId: 'inc-uuid-0000-0000-0000-000000000001',
    firstName: 'John',
    lastName: 'Doe',
    estimatedAge: 35,
    gender: Gender.MALE,
    status: PatientStatus.FIELD_INTAKE,
    currentTriageCategory: TriageCategory.YELLOW,
    chiefComplaint: 'Blunt chest trauma',
    notes: 'Conscious and oriented',
    version: 1,
    clientCreatedAt: new Date('2026-09-29T08:00:00.000Z'),
    createdAt: new Date('2026-09-29T08:00:05.000Z'),
    updatedAt: new Date('2026-09-29T08:00:05.000Z'),
    deletedAt: null,
  };

  const sampleIncident = {
    id: 'inc-uuid-0000-0000-0000-000000000001',
    incidentNumber: 'INC-2026-001',
    title: 'Multi-Vehicle Collision Hwy 101',
    description: 'Pileup with mass casualties',
    status: IncidentStatus.ACTIVE,
    priority: 'HIGH' as const,
    latitude: 37.7749,
    longitude: -122.4194,
    address: 'Hwy 101 Mile Marker 14',
    reportedAt: new Date(),
    resolvedAt: null,
    version: 1,
    createdBy: 'user-super-01',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sampleVital = {
    id: 'vital-uuid-0001',
    patientId: samplePatient.id,
    recordedBy: mockUserContext.userId,
    systolicBp: 120,
    diastolicBp: 80,
    heartRate: 72,
    respiratoryRate: 16,
    oxygenSaturation: 98.5,
    temperature: 36.8,
    gcsScore: 15,
    source: VitalSource.PARAMEDIC_FIELD,
    recordedAt: new Date('2026-09-29T08:05:00.000Z'),
    createdAt: new Date('2026-09-29T08:05:01.000Z'),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPatient', () => {
    it('should create a patient with valid input and auto-generated demoId', async () => {
      vi.spyOn(PatientRepository, 'create').mockResolvedValueOnce(samplePatient as any);

      const result = await PatientService.createPatient(
        {
          firstName: 'John',
          lastName: 'Doe',
          estimatedAge: 35,
          gender: Gender.MALE,
          status: PatientStatus.FIELD_INTAKE,
        },
        mockUserContext
      );

      expect(result.id).toBe(samplePatient.id);
      expect(result.demoId).toBe(samplePatient.demoId);
      expect(result.version).toBe(1);
      expect(PatientRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'John',
          lastName: 'Doe',
          gender: Gender.MALE,
          status: PatientStatus.FIELD_INTAKE,
        })
      );
    });

    it('should validate incident association and reject non-existent incident', async () => {
      vi.spyOn(PatientRepository, 'findIncidentById').mockResolvedValueOnce(null);

      try {
        await PatientService.createPatient(
          {
            incidentId: 'non-existent-inc-id',
          },
          mockUserContext
        );
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe(ErrorCodes.BAD_REQUEST);
      }
    });

    it('should reject attaching patient to a CLOSED incident', async () => {
      vi.spyOn(PatientRepository, 'findIncidentById').mockResolvedValueOnce({
        ...sampleIncident,
        status: IncidentStatus.CLOSED,
      } as any);

      try {
        await PatientService.createPatient(
          {
            incidentId: sampleIncident.id,
          },
          mockUserContext
        );
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('closed incident');
      }
    });

    it('should reject creation if custom demoId is already in use', async () => {
      vi.spyOn(PatientRepository, 'findByDemoId').mockResolvedValueOnce(samplePatient as any);

      try {
        await PatientService.createPatient(
          {
            demoId: 'DEMO-PT-001',
          },
          mockUserContext
        );
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe(ErrorCodes.CONFLICT);
      }
    });
  });

  describe('getPatientById', () => {
    it('should retrieve patient by UUID successfully', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(samplePatient as any);

      const result = await PatientService.getPatientById(samplePatient.id);
      expect(result.id).toBe(samplePatient.id);
      expect(result.firstName).toBe('John');
      expect(result.chiefComplaint).toBe('Blunt chest trauma');
    });

    it('should throw 404 NOT_FOUND if patient does not exist', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(null);

      try {
        await PatientService.getPatientById('missing-uuid');
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe(ErrorCodes.NOT_FOUND);
      }
    });
  });

  describe('listPatients', () => {
    it('should return paginated patients with default bounds', async () => {
      vi.spyOn(PatientRepository, 'findMany').mockResolvedValueOnce([samplePatient as any]);
      vi.spyOn(PatientRepository, 'count').mockResolvedValueOnce(1);

      const result = await PatientService.listPatients({ page: 1, limit: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter patients by incidentId and status', async () => {
      vi.spyOn(PatientRepository, 'findMany').mockResolvedValueOnce([samplePatient as any]);
      vi.spyOn(PatientRepository, 'count').mockResolvedValueOnce(1);

      await PatientService.listPatients({
        incidentId: sampleIncident.id,
        status: PatientStatus.FIELD_INTAKE,
      });

      expect(PatientRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            incidentId: sampleIncident.id,
            status: PatientStatus.FIELD_INTAKE,
          }),
        })
      );
    });
  });

  describe('updatePatient & OCC (Optimistic Concurrency Control)', () => {
    it('should update patient successfully and increment version when version matches', async () => {
      vi.spyOn(PatientRepository, 'findById')
        .mockResolvedValueOnce(samplePatient as any) // for initial check
        .mockResolvedValueOnce({
          ...samplePatient,
          status: PatientStatus.IN_TRANSIT,
          version: 2,
        } as any); // after updateWithOCC

      vi.spyOn(PatientRepository, 'updateWithOCC').mockResolvedValueOnce({ count: 1 });

      const result = await PatientService.updatePatient(
        samplePatient.id,
        {
          version: 1, // expected version
          status: PatientStatus.IN_TRANSIT,
        },
        mockUserContext
      );

      expect(result.version).toBe(2);
      expect(result.status).toBe(PatientStatus.IN_TRANSIT);
      expect(PatientRepository.updateWithOCC).toHaveBeenCalledWith(
        samplePatient.id,
        1,
        expect.objectContaining({ status: PatientStatus.IN_TRANSIT })
      );
    });

    it('should reject stale update with 409 CONFLICT when version does not match', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce({
        ...samplePatient,
        version: 3, // current DB version is 3
      } as any);

      try {
        await PatientService.updatePatient(
          samplePatient.id,
          {
            version: 1, // stale client sends version 1
            status: PatientStatus.IN_TRANSIT,
          },
          mockUserContext
        );
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(409);
        expect(err.code).toBe(ErrorCodes.CONFLICT);
        expect(err.message).toContain('version conflict');
      }
    });

    it('should throw 404 NOT_FOUND when updating non-existent patient', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(null);

      try {
        await PatientService.updatePatient(
          'missing-id',
          { version: 1, status: PatientStatus.IN_TRANSIT },
          mockUserContext
        );
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe(ErrorCodes.NOT_FOUND);
      }
    });
  });

  describe('Patient Vitals (Append-Only Observations)', () => {
    it('should append a clinical vital sign observation successfully', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(samplePatient as any);
      vi.spyOn(PatientRepository, 'createVitalSign').mockResolvedValueOnce(sampleVital as any);

      const result = await PatientService.createPatientVital(
        samplePatient.id,
        {
          systolicBp: 120,
          diastolicBp: 80,
          heartRate: 72,
          oxygenSaturation: 98.5,
        },
        mockDoctorContext
      );

      expect(result.id).toBe(sampleVital.id);
      expect(result.patientId).toBe(samplePatient.id);
      expect(result.systolicBp).toBe(120);
      expect(PatientRepository.createVitalSign).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: samplePatient.id,
          recordedBy: mockDoctorContext.userId,
          systolicBp: 120,
          heartRate: 72,
        })
      );
    });

    it('should reject vital sign record with no physiological metrics provided', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(samplePatient as any);

      try {
        await PatientService.createPatientVital(samplePatient.id, {}, mockUserContext);
        expect.fail('Should have thrown ApiError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.statusCode).toBe(400);
        expect(err.message).toContain('At least one physiological vital sign metric');
      }
    });

    it('should retrieve chronological vital signs history for a patient', async () => {
      vi.spyOn(PatientRepository, 'findById').mockResolvedValueOnce(samplePatient as any);
      vi.spyOn(PatientRepository, 'findVitalsByPatientId').mockResolvedValueOnce([
        sampleVital as any,
      ]);

      const result = await PatientService.getPatientVitals(samplePatient.id);
      expect(result).toHaveLength(1);
      expect(result[0].heartRate).toBe(72);
      expect(result[0].recordedBy).toBe(mockUserContext.userId);
    });
  });
});
