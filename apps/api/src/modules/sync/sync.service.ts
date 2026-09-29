import {
  SyncEntityType,
  SyncOpType,
  SyncProcessingStatus,
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

export class SyncService {
  /**
   * Processes a batch of queued offline operations idempotently within a transaction.
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

    const results = await SyncRepository.withTransaction(async (tx) => {
      const opResults: SyncOperationResult[] = [];

      for (const op of batch.operations) {
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

          opResults.push({
            operationId: op.operationId,
            status: SyncProcessingStatus.DUPLICATE_IGNORED,
            serverTimestamp: existing.serverTimestamp.toISOString(),
            responsePayload: (existing.responsePayload as Record<string, any>) || null,
            conflictDetails: (existing.conflictDetails as any) || null,
          });
          continue;
        }

        // 2. Process based on Entity Type & Operation Type
        try {
          const outcome = await this.applyOperation(tx, op, batch.deviceId, userContext);
          opResults.push(outcome);
        } catch (err: any) {
          logger.error(
            {
              operationId: op.operationId,
              entityType: op.entityType,
              entityId: op.entityId,
              errMessage: err.message,
            },
            'Unexpected error processing sync operation'
          );

          // Record non-transient mutation failure into sync_history
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

          opResults.push({
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

      return opResults;
    });

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
          currentTriageCategory: op.payload.currentTriageCategory || 'UNASSESSED',
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

    // Unsupported entity or operation
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
