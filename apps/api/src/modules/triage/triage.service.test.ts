import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriageCategory, TriageSource, UserRole } from '@prisma/client';
import { TriageService } from './triage.service.js';
import { TriageRepository } from './triage.repository.js';
import { TriageProtocolRegistry, ClinicalApprovalPendingError, StartProtocol } from './engine/registry.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { AuthenticatedUserContext } from '../../types/express.js';

describe('TriageService Unit Tests', () => {
  const mockDoctorContext: AuthenticatedUserContext = {
    userId: '22222222-2222-2222-2222-222222222222',
    supabaseUid: 'fb-doctor-001',
    phone: '+15550100002',
    role: UserRole.TRIAGE_DOCTOR,
    sessionId: 'session-uuid-002',
  };

  const mockParamedicContext: AuthenticatedUserContext = {
    userId: '11111111-1111-1111-1111-111111111111',
    supabaseUid: 'fb-paramedic-001',
    phone: '+15550100001',
    role: UserRole.PARAMEDIC,
    sessionId: 'session-uuid-001',
  };

  const samplePatient = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    demoId: 'DEMO-PT-001',
    version: 1,
    currentTriageCategory: TriageCategory.UNASSESSED,
    currentTriageAssessmentId: null,
    currentTriageAssessment: null,
    deletedAt: null,
  };

  const sampleAssessment = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    assessedBy: mockParamedicContext.userId,
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

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Safety Gate: Inactive Clinical Decision Algorithms', () => {
    it('throws ClinicalApprovalPendingError if clinical evaluation is invoked on unapproved START protocol', () => {
      const protocol = TriageProtocolRegistry.get('START', '1.0.0');
      expect(protocol).toBeDefined();
      expect(protocol!.isApproved).toBe(false);
      expect(protocol!.approvalStatus).toBe('PENDING_CLINICAL_APPROVAL');

      expect(() => {
        protocol!.evaluate({ canWalk: false, respiratoryRate: 20 });
      }).toThrowError(ClinicalApprovalPendingError);
    });

    it('performs structural input validation without evaluating clinical decisions', () => {
      const protocol = new StartProtocol();
      const valid = protocol.validateInputs({
        canWalk: false,
        respiratoryRate: 24,
        radialPulse: true,
      });
      expect(valid.valid).toBe(true);

      const invalid = protocol.validateInputs({
        respiratoryRate: -5,
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContain(
        'respiratoryRate must be an integer between 0 and 100 breaths/min'
      );
    });
  });

  describe('2. Assessment Creation & Reassessment (Strictly Append-Only)', () => {
    it('records an initial triage assessment and updates patient active state atomically', async () => {
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

      const result = await TriageService.recordAssessment(
        samplePatient.id,
        {
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          assessmentData: { canWalk: false, respiratoryRate: 20 },
          assessedAt: '2026-09-29T10:00:00.000Z',
        },
        mockParamedicContext
      );

      expect(result.id).toBe(sampleAssessment.id);
      expect(result.effectiveCategory).toBe(TriageCategory.YELLOW);
      expect(result.isCurrent).toBe(true);
      expect(TriageRepository.updatePatientActiveTriage).toHaveBeenCalledWith(
        samplePatient.id,
        undefined,
        {
          currentTriageAssessmentId: sampleAssessment.id,
          currentTriageCategory: TriageCategory.YELLOW,
        },
        txMock
      );
    });

    it('records a reassessment without modifying or deleting the previous assessment', async () => {
      const patientWithCurrent = {
        ...samplePatient,
        version: 2,
        currentTriageCategory: TriageCategory.YELLOW,
        currentTriageAssessmentId: sampleAssessment.id,
        currentTriageAssessment: sampleAssessment,
      };

      const reassessment = {
        ...sampleAssessment,
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        calculatedCategory: TriageCategory.RED,
        assessedAt: new Date('2026-09-29T10:30:00.000Z'),
      };

      const txMock = {
        patient: {
          findFirst: vi.fn().mockResolvedValue(patientWithCurrent),
        },
        triageAssessment: {
          create: vi.fn().mockResolvedValue(reassessment),
        },
      };

      vi.spyOn(TriageRepository, 'withTransaction').mockImplementation(async (cb: any) => {
        return cb(txMock);
      });

      vi.spyOn(TriageRepository, 'updatePatientActiveTriage').mockResolvedValue({
        count: 1,
      });

      const result = await TriageService.recordAssessment(
        samplePatient.id,
        {
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.RED,
          assessedAt: '2026-09-29T10:30:00.000Z',
        },
        mockParamedicContext
      );

      expect(result.id).toBe(reassessment.id);
      expect(result.effectiveCategory).toBe(TriageCategory.RED);
      expect(result.isCurrent).toBe(true);

      // Verify new assessment was inserted as append-only
      expect(txMock.triageAssessment.create).toHaveBeenCalled();
      // Verify patient pointer moved to the new assessment
      expect(TriageRepository.updatePatientActiveTriage).toHaveBeenCalledWith(
        samplePatient.id,
        undefined,
        {
          currentTriageAssessmentId: reassessment.id,
          currentTriageCategory: TriageCategory.RED,
        },
        txMock
      );
    });
  });

  describe('3. Concurrency & Out-of-Order Synchronization', () => {
    it('enforces Optimistic Concurrency Control (OCC) when expectedPatientVersion is supplied', async () => {
      const patientWithCurrent = {
        ...samplePatient,
        version: 5,
      };

      const txMock = {
        patient: {
          findFirst: vi.fn().mockResolvedValue(patientWithCurrent),
        },
      };

      vi.spyOn(TriageRepository, 'withTransaction').mockImplementation(async (cb: any) => {
        return cb(txMock);
      });

      await expect(
        TriageService.recordAssessment(
          samplePatient.id,
          {
            protocolCode: 'START',
            protocolVersion: '1.0.0',
            calculatedCategory: TriageCategory.YELLOW,
            expectedPatientVersion: 3, // stale version
          },
          mockParamedicContext
        )
      ).rejects.toThrowError(ApiError);
    });

    it('does NOT roll back authoritative current assessment when an out-of-order delayed submission arrives', async () => {
      // Patient already has a newer assessment from 10:30
      const newerAssessment = {
        ...sampleAssessment,
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        calculatedCategory: TriageCategory.RED,
        assessedAt: new Date('2026-09-29T10:30:00.000Z'),
      };

      const patientWithNewer = {
        ...samplePatient,
        currentTriageCategory: TriageCategory.RED,
        currentTriageAssessmentId: newerAssessment.id,
        currentTriageAssessment: newerAssessment,
      };

      // Delayed assessment from field arriving late (assessed at 10:15)
      const delayedOldAssessment = {
        ...sampleAssessment,
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        calculatedCategory: TriageCategory.YELLOW,
        assessedAt: new Date('2026-09-29T10:15:00.000Z'),
      };

      const txMock = {
        patient: {
          findFirst: vi.fn().mockResolvedValue(patientWithNewer),
        },
        triageAssessment: {
          create: vi.fn().mockResolvedValue(delayedOldAssessment),
        },
      };

      vi.spyOn(TriageRepository, 'withTransaction').mockImplementation(async (cb: any) => {
        return cb(txMock);
      });

      const updateSpy = vi.spyOn(TriageRepository, 'updatePatientActiveTriage');

      const result = await TriageService.recordAssessment(
        samplePatient.id,
        {
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          assessedAt: '2026-09-29T10:15:00.000Z',
        },
        mockParamedicContext
      );

      // Delayed assessment IS inserted for historical audit completeness
      expect(result.id).toBe(delayedOldAssessment.id);
      // But it is NOT marked as current
      expect(result.isCurrent).toBe(false);
      // And the patient's active state is NOT touched
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. Override Documentation and Authorization', () => {
    it('allows authorized TRIAGE_DOCTOR to override category with documented reason', async () => {
      const overriddenAssessment = {
        ...sampleAssessment,
        calculatedCategory: TriageCategory.YELLOW,
        overriddenCategory: TriageCategory.RED,
        overrideReason: 'Severe respiratory distress noted upon secondary clinical examination',
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

      const result = await TriageService.recordAssessment(
        samplePatient.id,
        {
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
          overriddenCategory: TriageCategory.RED,
          overrideReason:
            'Severe respiratory distress noted upon secondary clinical examination',
        },
        mockDoctorContext
      );

      expect(result.effectiveCategory).toBe(TriageCategory.RED);
      expect(result.calculatedCategory).toBe(TriageCategory.YELLOW);
      expect(result.overriddenCategory).toBe(TriageCategory.RED);
      expect(result.overrideReason).toBe(
        'Severe respiratory distress noted upon secondary clinical examination'
      );
    });

    it('rejects override attempts if overrideReason is missing or too short', async () => {
      await expect(
        TriageService.recordAssessment(
          samplePatient.id,
          {
            protocolCode: 'START',
            protocolVersion: '1.0.0',
            calculatedCategory: TriageCategory.YELLOW,
            overriddenCategory: TriageCategory.RED,
            overrideReason: 'red', // too short (< 5 chars)
          },
          mockDoctorContext
        )
      ).rejects.toThrowError('Clinical triage category override requires an explicit, descriptive overrideReason');
    });

    it('rejects unauthorized role (PARAMEDIC) attempting to override clinical triage category', async () => {
      await expect(
        TriageService.recordAssessment(
          samplePatient.id,
          {
            protocolCode: 'START',
            protocolVersion: '1.0.0',
            calculatedCategory: TriageCategory.YELLOW,
            overriddenCategory: TriageCategory.RED,
            overrideReason: 'Physician override attempted by paramedic',
          },
          mockParamedicContext
        )
      ).rejects.toThrowError('Clinical triage category override requires authorization');
    });
  });

  describe('5. Protocol Registry Listing', () => {
    it('lists registered protocols with accurate approval status', () => {
      const protocols = TriageService.listProtocols();
      expect(protocols.length).toBeGreaterThanOrEqual(2);

      const start = protocols.find((p) => p.protocolCode === 'START');
      expect(start).toBeDefined();
      expect(start!.isApproved).toBe(false);
      expect(start!.approvalStatus).toBe('PENDING_CLINICAL_APPROVAL');

      const who = protocols.find((p) => p.protocolCode === 'WHO_MC_IITT');
      expect(who).toBeDefined();
      expect(who!.isApproved).toBe(false);
      expect(who!.approvalStatus).toBe('PENDING_CLINICAL_APPROVAL');
    });
  });

  // -----------------------------------------------------------------------
  // D-03: OCC safety-net regression
  // -----------------------------------------------------------------------
  describe('6. OCC Safety-Net (D-03 Remediation)', () => {
    it('throws conflict error when updatePatientActiveTriage returns count 0 (concurrent modification)', async () => {
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

      // Simulate the updateMany returning count: 0, e.g. patient soft-deleted
      // between findFirst and the updateMany, or a concurrent transaction won the race
      vi.spyOn(TriageRepository, 'updatePatientActiveTriage').mockResolvedValue({ count: 0 });

      await expect(
        TriageService.recordAssessment(
          samplePatient.id,
          {
            protocolCode: 'START',
            protocolVersion: '1.0.0',
            calculatedCategory: TriageCategory.YELLOW,
          },
          mockParamedicContext
        )
      ).rejects.toThrow('Concurrent modification detected while updating active patient triage category');
    });

    it('succeeds and marks assessment as current when count returns 1 (no version supplied)', async () => {
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

      vi.spyOn(TriageRepository, 'updatePatientActiveTriage').mockResolvedValue({ count: 1 });

      const result = await TriageService.recordAssessment(
        samplePatient.id,
        {
          protocolCode: 'START',
          protocolVersion: '1.0.0',
          calculatedCategory: TriageCategory.YELLOW,
        },
        mockParamedicContext
      );

      expect(result.isCurrent).toBe(true);
      expect(result.effectiveCategory).toBe(TriageCategory.YELLOW);
    });
  });
});

