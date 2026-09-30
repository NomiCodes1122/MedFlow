import { Prisma, TriageAssessment, UserRole } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { AuthenticatedUserContext } from '../../types/express.js';
import {
  CreateTriageAssessmentInput,
  TriageAssessmentResponse,
  TriageQueueItem,
  ProtocolMetadata,
} from './triage.types.js';
import { TriageRepository } from './triage.repository.js';
import { TriageProtocolRegistry } from './engine/registry.js';

export class TriageService {
  /**
   * Transforms a database TriageAssessment record to a clean API response DTO.
   */
  public static toResponse(
    assessment: TriageAssessment,
    isAuthoritativeCurrent: boolean = false
  ): TriageAssessmentResponse {
    const effectiveCategory = assessment.overriddenCategory || assessment.calculatedCategory;

    return {
      id: assessment.id,
      patientId: assessment.patientId,
      assessedBy: assessment.assessedBy,
      protocolCode: assessment.protocolCode,
      protocolVersion: assessment.protocolVersion,
      careSetting: assessment.careSetting,
      calculatedCategory: assessment.calculatedCategory,
      overriddenCategory: assessment.overriddenCategory,
      effectiveCategory,
      overrideReason: assessment.overrideReason,
      assessmentData: (assessment.assessmentData as Record<string, unknown>) || null,
      decisionTrace: (assessment.decisionTrace as Record<string, unknown>) || null,
      isCurrent: isAuthoritativeCurrent,
      assessmentSource: assessment.assessmentSource,
      assessedAt: assessment.assessedAt.toISOString(),
      createdAt: assessment.createdAt.toISOString(),
    };
  }

  /**
   * Records a clinical triage assessment.
   *
   * Architectural & Safety Invariants:
   * 1. Strictly append-only: every assessment creates a new immutable record.
   * 2. Reassessments do not overwrite historical records.
   * 3. Authoritative active state is atomically maintained on Patient (Option B).
   * 4. Delayed out-of-order offline submissions are appended to clinical history
   *    without demoting or rolling back a newer authoritative current assessment.
   * 5. Clinical category overrides strictly require documented rationale and authorized clinical roles.
   * 6. Clinical rules are NOT silently executed or invented for unapproved protocols.
   */
  static async recordAssessment(
    patientId: string,
    input: CreateTriageAssessmentInput,
    userContext: AuthenticatedUserContext
  ): Promise<TriageAssessmentResponse> {
    // 1. Verify protocol registration and perform structural observation validation
    const protocol = TriageProtocolRegistry.get(input.protocolCode, input.protocolVersion);
    if (!protocol) {
      throw ApiError.badRequest(
        `Unsupported or unregistered triage protocol: '${input.protocolCode}' version '${input.protocolVersion}'`
      );
    }

    if (input.assessmentData) {
      const validation = protocol.validateInputs(input.assessmentData);
      if (!validation.valid && validation.errors?.length) {
        throw ApiError.badRequest(
          `Invalid protocol observation data: ${validation.errors.join('; ')}`
        );
      }
    }

    // 2. Override authorization & documentation enforcement
    const isOverride =
      input.overriddenCategory &&
      input.overriddenCategory !== input.calculatedCategory;

    if (isOverride) {
      if (!input.overrideReason || input.overrideReason.trim().length < 5) {
        throw ApiError.badRequest(
          'Clinical triage category override requires an explicit, descriptive overrideReason (minimum 5 characters).'
        );
      }

      // Enforce clinical authority for overrides (e.g. TRIAGE_DOCTOR)
      if (
        userContext.role !== UserRole.TRIAGE_DOCTOR &&
        userContext.role !== UserRole.HOSPITAL_SUPERINTENDENT
      ) {
        logger.warn(
          {
            actorId: userContext.userId,
            actorRole: userContext.role,
            patientId,
          },
          'Unauthorized attempt to override clinical triage category'
        );
        throw ApiError.forbidden(
          'Clinical triage category override requires authorization (TRIAGE_DOCTOR or HOSPITAL_SUPERINTENDENT role required).'
        );
      }
    }

    const assessedAt = input.assessedAt ? new Date(input.assessedAt) : new Date();
    const effectiveCategory = input.overriddenCategory || input.calculatedCategory;

    // 3. Atomic transaction: Append assessment + update patient active state under OCC
    return await TriageRepository.withTransaction(async (tx) => {
      // 3a. Retrieve patient record
      const patient = await tx.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        include: { currentTriageAssessment: true },
      });

      if (!patient) {
        throw ApiError.notFound(`Patient with ID '${patientId}' was not found`);
      }

      // 3b. Verify Optimistic Concurrency Control (OCC) if expected version provided
      if (
        input.expectedPatientVersion !== undefined &&
        patient.version !== input.expectedPatientVersion
      ) {
        logger.warn(
          {
            patientId,
            currentVersion: patient.version,
            expectedVersion: input.expectedPatientVersion,
            actorId: userContext.userId,
          },
          'Triage reassessment rejected due to version conflict (OCC)'
        );
        throw ApiError.conflict(
          `Stale triage assessment rejected: patient record was modified concurrently. Current version is ${patient.version}, received ${input.expectedPatientVersion}.`,
          {
            currentVersion: patient.version,
            expectedVersion: input.expectedPatientVersion,
          }
        );
      }

      // 3c. Append immutable assessment record
      const assessmentDataToPersist: Prisma.TriageAssessmentUncheckedCreateInput = {
        patientId,
        assessedBy: userContext.userId,
        protocolCode: protocol.protocolCode,
        protocolVersion: protocol.protocolVersion,
        careSetting: input.careSetting || protocol.careSetting,
        assessmentData: input.assessmentData ? (input.assessmentData as any) : Prisma.JsonNull,
        decisionTrace: input.decisionTrace ? (input.decisionTrace as any) : Prisma.JsonNull,
        calculatedCategory: input.calculatedCategory,
        overriddenCategory: input.overriddenCategory ?? null,
        overrideReason: input.overrideReason ?? null,
        isCurrent: false, // Invariant: true authoritative pointer resides in patients.current_triage_assessment_id
        assessmentSource: input.assessmentSource || 'FIELD_START',
        assessedAt,
        canWalk: input.canWalk ?? null,
        hasRespirations: input.hasRespirations ?? null,
        respiratoryRate: input.respiratoryRate ?? null,
        radialPulse: input.radialPulse ?? null,
        capillaryRefillSec: input.capillaryRefillSec ?? null,
        followsCommands: input.followsCommands ?? null,
      };

      const createdAssessment = await tx.triageAssessment.create({
        data: assessmentDataToPersist,
      });

      // 3d. Deterministic Authoritative State Resolution
      // Delayed offline uploads must NOT automatically supersede a newer authoritative assessment
      const currentAssessment = patient.currentTriageAssessment;
      let shouldUpdatePatientActiveState = true;

      if (currentAssessment) {
        const currentAssessedTime = currentAssessment.assessedAt.getTime();
        const incomingAssessedTime = assessedAt.getTime();

        if (incomingAssessedTime < currentAssessedTime) {
          // Incoming assessment is older than the patient's current assessment
          shouldUpdatePatientActiveState = false;
          logger.info(
            {
              patientId,
              incomingAssessmentId: createdAssessment.id,
              incomingAssessedAt: assessedAt.toISOString(),
              currentAssessmentId: currentAssessment.id,
              currentAssessedAt: currentAssessment.assessedAt.toISOString(),
            },
            'Delayed offline assessment appended to historical ledger without overwriting newer authoritative current assessment'
          );
        }
      }

      let isAuthoritative = false;
      if (shouldUpdatePatientActiveState) {
        // Atomic update of current category and pointer on Patient
        const updateResult = await TriageRepository.updatePatientActiveTriage(
          patientId,
          input.expectedPatientVersion,
          {
            currentTriageAssessmentId: createdAssessment.id,
            currentTriageCategory: effectiveCategory,
          },
          tx
        );

        if (updateResult.count === 0) {
          throw ApiError.conflict(
            'Concurrent modification detected while updating active patient triage category'
          );
        }

        isAuthoritative = true;
      }

      logger.info(
        {
          assessmentId: createdAssessment.id,
          patientId,
          assessedBy: userContext.userId,
          effectiveCategory,
          isAuthoritative,
          isOverride,
          protocolCode: protocol.protocolCode,
        },
        'Clinical triage assessment successfully recorded (immutable)'
      );

      return this.toResponse(createdAssessment, isAuthoritative);
    });
  }

  /**
   * Retrieves complete chronological assessment history for a patient.
   */
  static async getPatientHistory(
    patientId: string,
    query: { page?: number; limit?: number }
  ): Promise<{
    items: TriageAssessmentResponse[];
    page: number;
    limit: number;
    total: number;
  }> {
    const patient = await TriageRepository.findPatientForTriage(patientId);
    if (!patient) {
      throw ApiError.notFound(`Patient with ID '${patientId}' was not found`);
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const [assessments, total] = await Promise.all([
      TriageRepository.findHistoryByPatientId(patientId, { skip, take: limit }),
      TriageRepository.countByPatientId(patientId),
    ]);

    const currentId = patient.currentTriageAssessmentId;

    return {
      items: assessments.map((a) => this.toResponse(a, a.id === currentId)),
      page,
      limit,
      total,
    };
  }

  /**
   * Retrieves current active triage queue.
   */
  static async getTriageQueue(query: {
    incidentId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: TriageQueueItem[];
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const { patients, total } = await TriageRepository.findTriageQueue({
      incidentId: query.incidentId,
      skip,
      take: limit,
    });

    const items: TriageQueueItem[] = patients.map((p) => ({
      patientId: p.id,
      demoId: p.demoId,
      incidentId: p.incidentId,
      firstName: p.firstName,
      lastName: p.lastName,
      estimatedAge: p.estimatedAge,
      gender: p.gender,
      status: p.status,
      currentTriageCategory: p.currentTriageCategory,
      currentAssessmentId: p.currentTriageAssessmentId,
      lastAssessedAt: p.currentTriageAssessment
        ? p.currentTriageAssessment.assessedAt.toISOString()
        : null,
      chiefComplaint: p.chiefComplaint,
    }));

    return {
      items,
      page,
      limit,
      total,
    };
  }

  /**
   * Lists registered triage protocols and clinical approval status.
   */
  static listProtocols(): ProtocolMetadata[] {
    return TriageProtocolRegistry.listProtocols();
  }
}
