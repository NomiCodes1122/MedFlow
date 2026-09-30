import {
  SyncEntityType,
  SyncOpType,
  SyncProcessingStatus,
  UserRole,
  VitalSource,
  IncidentStatus,
} from '@prisma/client';
import { logger } from '../../common/logging/logger.js';
import { AuthenticatedUserContext } from '../../types/express.js';
import {
  SyncBatchInput,
  SyncBatchResult,
  SyncOperationResult,
} from './sync.types.js';
import { SyncRepository } from './sync.repository.js';
import { PatientService } from '../patients/patient.service.js';
import { validateSyncPayload } from './sync.schemas.js';

export class SyncService {
  /**
   * Processes a batch of queued offline operations idempotently.
   * Employs Batch Failure Isolation so an invalid or failed operation does not
   * roll back or cancel unrelated valid operations in the same batch.
   */
  static async processBatch(
    batch: SyncBatchInput,
    userContext: AuthenticatedUserContext
  ): Promise<SyncBatchResult> {
    const startTime = Date.now();
    const operationCount = batch.operations.length;

    logger.info(
      {
        deviceId: batch.deviceId,
        userId: userContext.userId,
        role: userContext.role,
        operationCount,
      },
      'Offline sync batch ingestion started'
    );

    const results: SyncOperationResult[] = [];

    // Process each operation in an isolated transaction to guarantee failure isolation
    for (const op of batch.operations) {
      try {
        const opResult = await SyncRepository.withTransaction(async (tx) => {
          return await this.processSingleOperation(tx, op, batch.deviceId, userContext);
        });
        results.push(opResult);
      } catch (err: any) {
        logger.error(
          {
            operationId: op.operationId,
            entityType: op.entityType,
            entityId: op.entityId,
            errMessage: err.message,
          },
          'Unexpected error processing sync operation; isolating failure'
        );

        // Record non-transient mutation failure into sync_history in isolated transaction
        try {
          await SyncRepository.withTransaction(async (tx) => {
            await SyncRepository.recordOperation(tx, {
              operationId: op.operationId,
              deviceId: batch.deviceId,
              userId: userContext.userId,
              entityType: op.entityType,
              entityId: op.entityId,
              operationType: op.operationType,
              clientTimestamp: new Date(op.clientTimestamp),
              status: SyncProcessingStatus.FAILED,
              conflictDetails: { message: err.message },
            });
          });
        } catch (historyErr: any) {
          logger.warn(
            { operationId: op.operationId, err: historyErr.message },
            'Failed to record syncHistory entry for failed operation'
          );
        }

        results.push({
          operationId: op.operationId,
          status: SyncProcessingStatus.FAILED,
          serverTimestamp: new Date().toISOString(),
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to apply mutation due to server constraint',
          },
        });
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(
      {
        deviceId: batch.deviceId,
        operationCount,
        durationMs,
      },
      'Offline sync batch ingestion completed'
    );

    return {
      processedAt: new Date().toISOString(),
      results,
    };
  }

  /**
   * Processes a single operation within its isolated database transaction.
   */
  private static async processSingleOperation(
    tx: any,
    op: any,
    deviceId: string,
    userContext: AuthenticatedUserContext
  ): Promise<SyncOperationResult> {
    const serverTimestamp = new Date();

    // 1. Idempotency Check: Has this operation already been processed?
    const existing = await SyncRepository.findOperation(tx, op.operationId);
    if (existing) {
      logger.info(
        {
          operationId: op.operationId,
          entityType: op.entityType,
          entityId: op.entityId,
          originalStatus: existing.status,
        },
        'Duplicate sync operation detected; returning cached response'
      );

      return {
        operationId: op.operationId,
        status: SyncProcessingStatus.DUPLICATE_IGNORED,
        serverTimestamp: existing.serverTimestamp.toISOString(),
        responsePayload: (existing.responsePayload as Record<string, any>) || null,
        conflictDetails: (existing.conflictDetails as any) || null,
      };
    }

    // 2. Strict Domain Payload Validation
    const validation = validateSyncPayload(op.entityType, op.operationType, op.payload);
    if (!validation.success) {
      const errorMessage = validation.errors.join('; ');
      logger.warn(
        {
          operationId: op.operationId,
          entityType: op.entityType,
          errors: validation.errors,
        },
        'Sync operation payload failed domain schema validation'
      );

      await SyncRepository.recordOperation(tx, {
        operationId: op.operationId,
        deviceId,
        userId: userContext.userId,
        entityType: op.entityType,
        entityId: op.entityId,
        operationType: op.operationType,
        clientTimestamp: new Date(op.clientTimestamp),
        status: SyncProcessingStatus.FAILED,
        conflictDetails: { validationErrors: validation.errors },
      });

      return {
        operationId: op.operationId,
        status: SyncProcessingStatus.FAILED,
        serverTimestamp: serverTimestamp.toISOString(),
        error: {
          code: 'VALIDATION_ERROR',
          message: errorMessage,
        },
      };
    }

    // Use validated payload
    const validatedPayload = validation.data;

    // 3. Process based on Entity Type & Operation Type
    return await this.applyOperation(tx, { ...op, payload: validatedPayload }, deviceId, userContext);
  }

  /**
   * Applies an individual sync operation inside the active Prisma transaction.
   */
  private static async applyOperation(
    tx: any,
    op: any,
    deviceId: string,
    userContext: AuthenticatedUserContext
  ): Promise<SyncOperationResult> {
    const serverTimestamp = new Date();

    // ----------------------------------------------------
    // ENTITY: PATIENT
    // ----------------------------------------------------
    if (op.entityType === SyncEntityType.PATIENT) {
      if (op.operationType === SyncOpType.CREATE) {
        // Handle patient creation
        let demoId = op.payload.demoId;
        if (!demoId) {
          const timestampPart = Date.now().toString(36).toUpperCase();
          const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
          demoId = `MED-PT-${timestampPart}-${randomPart}`;
        }

        // Validate incident if specified
        if (op.payload.incidentId) {
          const incident = await tx.incident.findUnique({
            where: { id: op.payload.incidentId },
          });
          if (!incident || incident.status === IncidentStatus.CLOSED) {
            const conflictDetails = {
              message: 'Referenced incident does not exist or is closed',
            };
            await SyncRepository.recordOperation(tx, {
              operationId: op.operationId,
              deviceId,
              userId: userContext.userId,
              entityType: op.entityType,
              entityId: op.entityId,
              operationType: op.operationType,
              clientTimestamp: new Date(op.clientTimestamp),
              status: SyncProcessingStatus.FAILED,
              conflictDetails,
            });
            return {
              operationId: op.operationId,
              status: SyncProcessingStatus.FAILED,
              serverTimestamp: serverTimestamp.toISOString(),
              error: {
                code: 'INVALID_INCIDENT',
                message: 'Referenced incident does not exist or is closed',
              },
            };
          }
        }

        const clientCreatedAt = op.payload.clientCreatedAt
          ? new Date(op.payload.clientCreatedAt)
          : new Date(op.clientTimestamp);

        const patient = await SyncRepository.createPatient(tx, {
          id: op.entityId,
          demoId,
          incidentId: op.payload.incidentId || null,
          firstName: op.payload.firstName || null,
          lastName: op.payload.lastName || null,
          estimatedAge: op.payload.estimatedAge ?? null,
          gender: op.payload.gender || 'UNKNOWN',
          status: op.payload.status || 'FIELD_INTAKE',
          chiefComplaint: op.payload.chiefComplaint || null,
          notes: op.payload.notes || null,
          clientCreatedAt,
        });

        const responsePayload = PatientService.toPatientResponse(patient);

        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload: responsePayload as any,
        });

        logger.info(
          {
            operationId: op.operationId,
            patientId: patient.id,
            demoId: patient.demoId,
          },
          'Sync patient creation applied successfully'
        );

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload,
        };
      }

      if (op.operationType === SyncOpType.UPDATE) {
        // Fetch current server state
        const existing = await SyncRepository.findPatientById(tx, op.entityId);
        if (!existing) {
          const conflictDetails = {
            message: `Patient '${op.entityId}' not found on server`,
          };
          await SyncRepository.recordOperation(tx, {
            operationId: op.operationId,
            deviceId,
            userId: userContext.userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: new Date(op.clientTimestamp),
            status: SyncProcessingStatus.FAILED,
            conflictDetails,
          });
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.FAILED,
            serverTimestamp: serverTimestamp.toISOString(),
            error: {
              code: 'NOT_FOUND',
              message: `Patient '${op.entityId}' not found on server`,
            },
          };
        }

        const expectedVersion = op.baseVersion ?? op.payload.version;

        // OCC Verification: Detect stale update
        if (expectedVersion === undefined || existing.version !== expectedVersion) {
          const conflictDetails = {
            message: `Optimistic concurrency conflict: database version is ${existing.version}, but mutation expected version ${expectedVersion}`,
            currentServerVersion: existing.version,
            expectedVersion,
            currentServerState: PatientService.toPatientResponse(existing),
          };

          await SyncRepository.recordOperation(tx, {
            operationId: op.operationId,
            deviceId,
            userId: userContext.userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: new Date(op.clientTimestamp),
            status: SyncProcessingStatus.CONFLICT,
            conflictDetails: conflictDetails as any,
          });

          logger.warn(
            {
              operationId: op.operationId,
              patientId: op.entityId,
              currentVersion: existing.version,
              expectedVersion,
            },
            'Sync patient update rejected due to version mismatch (OCC)'
          );

          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.CONFLICT,
            serverTimestamp: serverTimestamp.toISOString(),
            conflictDetails,
          };
        }

        // Apply update with atomic version increment
        const updateData: any = {};
        if (op.payload.firstName !== undefined) updateData.firstName = op.payload.firstName;
        if (op.payload.lastName !== undefined) updateData.lastName = op.payload.lastName;
        if (op.payload.estimatedAge !== undefined) updateData.estimatedAge = op.payload.estimatedAge;
        if (op.payload.gender !== undefined) updateData.gender = op.payload.gender;
        if (op.payload.status !== undefined) updateData.status = op.payload.status;
        if (op.payload.currentTriageCategory !== undefined)
          updateData.currentTriageCategory = op.payload.currentTriageCategory;
        if (op.payload.chiefComplaint !== undefined)
          updateData.chiefComplaint = op.payload.chiefComplaint;
        if (op.payload.notes !== undefined) updateData.notes = op.payload.notes;
        if (op.payload.incidentId !== undefined) updateData.incidentId = op.payload.incidentId;

        const updateResult = await SyncRepository.updatePatientWithOCC(
          tx,
          op.entityId,
          expectedVersion,
          updateData
        );

        if (updateResult.count === 0) {
          // Concurrent race won by another transaction
          const fresh = await SyncRepository.findPatientById(tx, op.entityId);
          const conflictDetails = {
            message: 'Concurrent update conflict detected during atomic write',
            currentServerVersion: fresh?.version,
            expectedVersion,
            currentServerState: fresh ? PatientService.toPatientResponse(fresh) : null,
          };
          await SyncRepository.recordOperation(tx, {
            operationId: op.operationId,
            deviceId,
            userId: userContext.userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: new Date(op.clientTimestamp),
            status: SyncProcessingStatus.CONFLICT,
            conflictDetails: conflictDetails as any,
          });
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.CONFLICT,
            serverTimestamp: serverTimestamp.toISOString(),
            conflictDetails,
          };
        }

        const updated = await SyncRepository.findPatientById(tx, op.entityId);
        const responsePayload = updated ? PatientService.toPatientResponse(updated) : null;

        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload: responsePayload as any,
        });

        logger.info(
          {
            operationId: op.operationId,
            patientId: op.entityId,
            newVersion: updated?.version,
          },
          'Sync patient update applied successfully with incremented version'
        );

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload,
        };
      }
    }

    // ----------------------------------------------------
    // ENTITY: OBSERVATION (Vitals)
    // ----------------------------------------------------
    if (op.entityType === SyncEntityType.OBSERVATION) {
      if (op.operationType === SyncOpType.CREATE) {
        const patientId = op.payload.patientId || op.entityId;
        const patient = await SyncRepository.findPatientById(tx, patientId);
        if (!patient) {
          const conflictDetails = {
            message: `Associated patient '${patientId}' not found on server`,
          };
          await SyncRepository.recordOperation(tx, {
            operationId: op.operationId,
            deviceId,
            userId: userContext.userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: new Date(op.clientTimestamp),
            status: SyncProcessingStatus.FAILED,
            conflictDetails,
          });
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.FAILED,
            serverTimestamp: serverTimestamp.toISOString(),
            error: {
              code: 'NOT_FOUND',
              message: `Associated patient '${patientId}' not found on server`,
            },
          };
        }

        const recordedAt = op.payload.recordedAt
          ? new Date(op.payload.recordedAt)
          : new Date(op.clientTimestamp);

        const vital = await SyncRepository.createVitalSign(tx, {
          id: op.entityId,
          patientId: patient.id,
          recordedBy: userContext.userId,
          systolicBp: op.payload.systolicBp ?? null,
          diastolicBp: op.payload.diastolicBp ?? null,
          heartRate: op.payload.heartRate ?? null,
          respiratoryRate: op.payload.respiratoryRate ?? null,
          oxygenSaturation: op.payload.oxygenSaturation ?? null,
          temperature: op.payload.temperature ?? null,
          gcsScore: op.payload.gcsScore ?? null,
          source: VitalSource.OFFLINE_SYNC,
          recordedAt,
        });

        const responsePayload = {
          id: vital.id,
          patientId: vital.patientId,
          recordedBy: vital.recordedBy,
          systolicBp: vital.systolicBp,
          diastolicBp: vital.diastolicBp,
          heartRate: vital.heartRate,
          respiratoryRate: vital.respiratoryRate,
          oxygenSaturation: vital.oxygenSaturation ? Number(vital.oxygenSaturation) : null,
          temperature: vital.temperature ? Number(vital.temperature) : null,
          gcsScore: vital.gcsScore,
          source: vital.source,
          recordedAt: vital.recordedAt.toISOString(),
          createdAt: vital.createdAt.toISOString(),
        };

        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload,
        });

        logger.info(
          {
            operationId: op.operationId,
            vitalId: vital.id,
            patientId: vital.patientId,
          },
          'Sync vital signs observation recorded (append-only)'
        );

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload,
        };
      }
    }

    // ----------------------------------------------------
    // ENTITY: TRIAGE
    // ----------------------------------------------------
    if (op.entityType === SyncEntityType.TRIAGE) {
      if (op.operationType === SyncOpType.CREATE) {
        const patientId = op.payload.patientId || op.entityId;
        const patient = await tx.patient.findFirst({
          where: { id: patientId, deletedAt: null },
          include: { currentTriageAssessment: true },
        });

        if (!patient) {
          const conflictDetails = {
            message: `Associated patient '${patientId}' not found on server`,
          };
          await SyncRepository.recordOperation(tx, {
            operationId: op.operationId,
            deviceId,
            userId: userContext.userId,
            entityType: op.entityType,
            entityId: op.entityId,
            operationType: op.operationType,
            clientTimestamp: new Date(op.clientTimestamp),
            status: SyncProcessingStatus.FAILED,
            conflictDetails,
          });
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.FAILED,
            serverTimestamp: serverTimestamp.toISOString(),
            error: {
              code: 'NOT_FOUND',
              message: `Associated patient '${patientId}' not found on server`,
            },
          };
        }

        const assessedAt = op.payload.assessedAt
          ? new Date(op.payload.assessedAt)
          : new Date(op.clientTimestamp);

        const effectiveCategory =
          op.payload.overriddenCategory || op.payload.calculatedCategory;

        // D-01: Enforce the same override authorization as the direct API.
        // An overridden category that differs from the calculated category requires:
        //   (a) a descriptive overrideReason and (b) TRIAGE_DOCTOR or HOSPITAL_SUPERINTENDENT role.
        const isOverride =
          op.payload.overriddenCategory &&
          op.payload.overriddenCategory !== op.payload.calculatedCategory;

        if (isOverride) {
          const hasValidReason =
            op.payload.overrideReason &&
            op.payload.overrideReason.trim().length >= 5;

          if (!hasValidReason) {
            const conflictDetails = {
              message: 'Clinical triage category override requires an explicit, descriptive overrideReason (minimum 5 characters).',
            };
            await SyncRepository.recordOperation(tx, {
              operationId: op.operationId,
              deviceId,
              userId: userContext.userId,
              entityType: op.entityType,
              entityId: op.entityId,
              operationType: op.operationType,
              clientTimestamp: new Date(op.clientTimestamp),
              status: SyncProcessingStatus.FAILED,
              conflictDetails,
            });
            return {
              operationId: op.operationId,
              status: SyncProcessingStatus.FAILED,
              serverTimestamp: serverTimestamp.toISOString(),
              error: {
                code: 'VALIDATION_ERROR',
                message: conflictDetails.message,
              },
            };
          }

          if (
            userContext.role !== UserRole.TRIAGE_DOCTOR &&
            userContext.role !== UserRole.HOSPITAL_SUPERINTENDENT
          ) {
            logger.warn(
              {
                operationId: op.operationId,
                actorId: userContext.userId,
                actorRole: userContext.role,
                patientId: patient.id,
              },
              'Sync: Unauthorized attempt to override clinical triage category'
            );
            const conflictDetails = {
              message: 'Clinical triage category override requires authorization (TRIAGE_DOCTOR or HOSPITAL_SUPERINTENDENT role required).',
            };
            await SyncRepository.recordOperation(tx, {
              operationId: op.operationId,
              deviceId,
              userId: userContext.userId,
              entityType: op.entityType,
              entityId: op.entityId,
              operationType: op.operationType,
              clientTimestamp: new Date(op.clientTimestamp),
              status: SyncProcessingStatus.FAILED,
              conflictDetails,
            });
            return {
              operationId: op.operationId,
              status: SyncProcessingStatus.FAILED,
              serverTimestamp: serverTimestamp.toISOString(),
              error: {
                code: 'FORBIDDEN',
                message: conflictDetails.message,
              },
            };
          }
        }

        // Append immutable assessment record
        const assessment = await tx.triageAssessment.create({
          data: {
            id: op.entityId,
            patientId: patient.id,
            assessedBy: userContext.userId,
            protocolCode: op.payload.protocolCode || 'START',
            protocolVersion: op.payload.protocolVersion || '1.0.0',
            careSetting: op.payload.careSetting || 'PRE_HOSPITAL',
            calculatedCategory: op.payload.calculatedCategory,
            overriddenCategory: op.payload.overriddenCategory ?? null,
            overrideReason: op.payload.overrideReason ?? null,
            assessmentData: op.payload.assessmentData ?? undefined,
            decisionTrace: op.payload.decisionTrace ?? undefined,
            assessmentSource: op.payload.assessmentSource || 'FIELD_START',
            assessedAt,
            isCurrent: false,
            canWalk: op.payload.canWalk ?? null,
            hasRespirations: op.payload.hasRespirations ?? null,
            respiratoryRate: op.payload.respiratoryRate ?? null,
            radialPulse: op.payload.radialPulse ?? null,
            capillaryRefillSec: op.payload.capillaryRefillSec ?? null,
            followsCommands: op.payload.followsCommands ?? null,
          },
        });

        // Deterministic out-of-order resolution:
        // Do not overwrite patient active state if a newer assessment already exists
        let isAuthoritative = true;
        const currentAssessment = patient.currentTriageAssessment;
        if (currentAssessment) {
          if (assessedAt.getTime() < currentAssessment.assessedAt.getTime()) {
            isAuthoritative = false;
            logger.info(
              {
                operationId: op.operationId,
                patientId: patient.id,
                incomingAssessedAt: assessedAt.toISOString(),
                currentAssessedAt: currentAssessment.assessedAt.toISOString(),
              },
              'Sync triage assessment is older than patient current assessment; recorded to history without rolling back active state'
            );
          }
        }

        if (isAuthoritative) {
          // D-03 parity: use updateMany with deletedAt: null guard for version increment
          await tx.patient.updateMany({
            where: { id: patient.id, deletedAt: null },
            data: {
              currentTriageAssessmentId: assessment.id,
              currentTriageCategory: effectiveCategory,
              version: { increment: 1 },
            },
          });
        }

        const responsePayload = {
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
          isCurrent: isAuthoritative,
          assessedAt: assessment.assessedAt.toISOString(),
          createdAt: assessment.createdAt.toISOString(),
        };

        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload,
        });

        logger.info(
          {
            operationId: op.operationId,
            assessmentId: assessment.id,
            patientId: assessment.patientId,
            isAuthoritative,
          },
          'Sync clinical triage assessment applied (immutable)'
        );

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload,
        };
      }
    }
    
    if (op.entityType === SyncEntityType.ALERT) {
      if (op.operationType === SyncOpType.UPDATE) {
        // Find existing alert
        const alert = await tx.alert.findUnique({
          where: { id: op.entityId }
        });
        
        if (!alert) {
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.FAILED,
            serverTimestamp: serverTimestamp.toISOString(),
            error: { code: 'NOT_FOUND', message: 'Alert not found' }
          };
        }
        
        // Extract status
        const { status } = op.payload as { status: string };
        const validStatuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED'];
        const currentIdx = validStatuses.indexOf(alert.status);
        const newIdx = validStatuses.indexOf(status);
        
        // Strict forward progression only (like in controller)
        if (newIdx <= currentIdx && alert.status !== status) {
          return {
            operationId: op.operationId,
            status: SyncProcessingStatus.FAILED,
            serverTimestamp: serverTimestamp.toISOString(),
            error: { code: 'VALIDATION_ERROR', message: `Cannot transition from ${alert.status} to ${status}` }
          };
        }

        // Update alert
        await tx.alert.update({
          where: { id: op.entityId },
          data: { status: status as any }
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId: userContext.userId,
            action: 'UPDATE',
            entityType: 'Alert',
            entityId: alert.id,
            details: { oldStatus: alert.status, newStatus: status, source: 'offline_sync' },
            ipAddress: 'sync-engine',
          }
        });

        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload: { id: alert.id, status }
        });

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload: { id: alert.id, status }
        };
      }
    }

    if (op.entityType === SyncEntityType.NOTIFICATION) {
      if (op.operationType === SyncOpType.UPDATE) {
        const { read } = op.payload as { read: boolean };
        if (read) {
          await tx.notificationDelivery.updateMany({
            where: {
              id: op.entityId,
              recipientUserId: userContext.userId
            },
            data: {
              status: 'READ',
              readAt: new Date()
            }
          });
        }
        
        await SyncRepository.recordOperation(tx, {
          operationId: op.operationId,
          deviceId,
          userId: userContext.userId,
          entityType: op.entityType,
          entityId: op.entityId,
          operationType: op.operationType,
          clientTimestamp: new Date(op.clientTimestamp),
          status: SyncProcessingStatus.APPLIED,
          responsePayload: { id: op.entityId, read }
        });

        return {
          operationId: op.operationId,
          status: SyncProcessingStatus.APPLIED,
          serverTimestamp: serverTimestamp.toISOString(),
          responsePayload: { id: op.entityId, read }
        };
      }
    }

    // Unsupported entity or operation
    await SyncRepository.recordOperation(tx, {
      operationId: op.operationId,
      deviceId,
      userId: userContext.userId,
      entityType: op.entityType,
      entityId: op.entityId,
      operationType: op.operationType,
      clientTimestamp: new Date(op.clientTimestamp),
      status: SyncProcessingStatus.FAILED,
      conflictDetails: { message: `Operation ${op.operationType} on ${op.entityType} is not supported in Phase 7` },
    });

    return {
      operationId: op.operationId,
      status: SyncProcessingStatus.FAILED,
      serverTimestamp: serverTimestamp.toISOString(),
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `Operation ${op.operationType} on ${op.entityType} is not supported in Phase 7`,
      },
    };
  }
}
