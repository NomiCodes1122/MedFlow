import { IncidentStatus, Patient, PatientVitalSign } from '@prisma/client';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { AuthenticatedUserContext } from '../../types/express.js';
import { PatientRepository } from './patient.repository.js';
import {
  CreatePatientInput,
  UpdatePatientInput,
  PatientListQuery,
  CreateVitalSignInput,
  PatientResponse,
  PatientVitalSignResponse,
} from './patient.types.js';

export class PatientService {
  /**
   * Helper to format a database Patient model into a clean PatientResponse DTO.
   */
  public static toPatientResponse(patient: Patient): PatientResponse {
    return {
      id: patient.id,
      demoId: patient.demoId,
      incidentId: patient.incidentId,
      firstName: patient.firstName,
      lastName: patient.lastName,
      estimatedAge: patient.estimatedAge,
      gender: patient.gender,
      status: patient.status,
      currentTriageCategory: patient.currentTriageCategory,
      currentTriageAssessmentId: (patient as any).currentTriageAssessmentId ?? null,
      chiefComplaint: patient.chiefComplaint,
      notes: patient.notes,
      version: patient.version,
      clientCreatedAt: patient.clientCreatedAt.toISOString(),
      createdAt: patient.createdAt.toISOString(),
      updatedAt: patient.updatedAt.toISOString(),
    };
  }

  /**
   * Helper to format a database PatientVitalSign model into a PatientVitalSignResponse DTO.
   */
  public static toVitalSignResponse(vital: PatientVitalSign): PatientVitalSignResponse {
    return {
      id: vital.id,
      patientId: vital.patientId,
      recordedBy: vital.recordedBy,
      systolicBp: vital.systolicBp,
      diastolicBp: vital.diastolicBp,
      heartRate: vital.heartRate,
      respiratoryRate: vital.respiratoryRate,
      oxygenSaturation: vital.oxygenSaturation,
      temperature: vital.temperature,
      gcsScore: vital.gcsScore,
      source: vital.source,
      recordedAt: vital.recordedAt.toISOString(),
      createdAt: vital.createdAt.toISOString(),
    };
  }

  /**
   * Creates a new patient intake record.
   * Enforces incident validity and generates unique readable demoId if omitted.
   */
  static async createPatient(
    input: CreatePatientInput,
    userContext: AuthenticatedUserContext
  ): Promise<PatientResponse> {
    // 1. Validate incident relationship if incidentId provided
    if (input.incidentId) {
      const incident = await PatientRepository.findIncidentById(input.incidentId);
      if (!incident) {
        throw ApiError.badRequest(`Referenced incident '${input.incidentId}' does not exist`);
      }
      if (incident.status === IncidentStatus.CLOSED) {
        throw ApiError.badRequest('Cannot attach a new patient to a closed incident');
      }
    }

    // 2. Validate or generate readable demoId
    let demoId = input.demoId;
    if (demoId) {
      const existing = await PatientRepository.findByDemoId(demoId);
      if (existing) {
        throw ApiError.conflict(`Patient with identifier '${demoId}' already exists`);
      }
    } else {
      // Deterministic auto-generation format: MED-PT-<BASE36_TIMESTAMP>-<RANDOM>
      const timestampPart = Date.now().toString(36).toUpperCase();
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
      demoId = `MED-PT-${timestampPart}-${randomPart}`;
    }

    // 3. Client created timestamp handling
    const clientCreatedAt = input.clientCreatedAt
      ? new Date(input.clientCreatedAt)
      : new Date();

    // 4. Persist patient record
    const patient = await PatientRepository.create({
      demoId,
      incidentId: input.incidentId || null,
      firstName: input.firstName || null,
      lastName: input.lastName || null,
      estimatedAge: input.estimatedAge ?? null,
      gender: input.gender,
      status: input.status,
      chiefComplaint: input.chiefComplaint || null,
      notes: input.notes || null,
      clientCreatedAt,
    });

    logger.info(
      {
        patientId: patient.id,
        demoId: patient.demoId,
        incidentId: patient.incidentId,
        actorId: userContext.userId,
        actorRole: userContext.role,
      },
      'Patient intake record successfully created'
    );

    return this.toPatientResponse(patient);
  }

  /**
   * Retrieves a patient by UUID.
   */
  static async getPatientById(id: string): Promise<PatientResponse> {
    const patient = await PatientRepository.findById(id);

    if (!patient) {
      throw ApiError.notFound(`Patient with ID '${id}' was not found`);
    }

    return this.toPatientResponse(patient);
  }

  /**
   * Lists patients with bounded pagination and optional filtering.
   */
  static async listPatients(query: PatientListQuery): Promise<{
    items: PatientResponse[];
    page: number;
    limit: number;
    total: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.incidentId) {
      where.incidentId = query.incidentId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.triageCategory) {
      where.currentTriageCategory = query.triageCategory;
    }

    const [patients, total] = await Promise.all([
      PatientRepository.findMany({ skip, take: limit, where }),
      PatientRepository.count(where),
    ]);

    return {
      items: patients.map((p) => this.toPatientResponse(p)),
      page,
      limit,
      total,
    };
  }

  /**
   * Updates an existing patient record using strict Optimistic Concurrency Control (OCC).
   * Rejects stale updates if the client's version does not match the database version.
   */
  static async updatePatient(
    id: string,
    input: UpdatePatientInput,
    userContext: AuthenticatedUserContext
  ): Promise<PatientResponse> {
    // 1. Fetch current patient
    const existing = await PatientRepository.findById(id);
    if (!existing) {
      throw ApiError.notFound(`Patient with ID '${id}' was not found`);
    }

    // 2. Optimistic Concurrency Control (OCC) Verification
    if (existing.version !== input.version) {
      logger.warn(
        {
          patientId: id,
          currentVersion: existing.version,
          expectedVersion: input.version,
          actorId: userContext.userId,
        },
        'Patient update rejected due to version mismatch (OCC)'
      );
      throw ApiError.conflict(
        `Stale patient update rejected: version conflict. Current version is ${existing.version}, received ${input.version}. Please reload and reapply your changes.`,
        {
          currentVersion: existing.version,
          expectedVersion: input.version,
        }
      );
    }

    // 3. Validate incident reference if incidentId is being modified
    if (input.incidentId && input.incidentId !== existing.incidentId) {
      const incident = await PatientRepository.findIncidentById(input.incidentId);
      if (!incident) {
        throw ApiError.badRequest(`Referenced incident '${input.incidentId}' does not exist`);
      }
      if (incident.status === IncidentStatus.CLOSED) {
        throw ApiError.badRequest('Cannot associate patient with a closed incident');
      }
    }

    // 4. Construct sanitized update payload
    const updateData: any = {};
    if (input.incidentId !== undefined) updateData.incidentId = input.incidentId;
    if (input.firstName !== undefined) updateData.firstName = input.firstName;
    if (input.lastName !== undefined) updateData.lastName = input.lastName;
    if (input.estimatedAge !== undefined) updateData.estimatedAge = input.estimatedAge;
    if (input.gender !== undefined) updateData.gender = input.gender;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.chiefComplaint !== undefined) updateData.chiefComplaint = input.chiefComplaint;
    if (input.notes !== undefined) updateData.notes = input.notes;

    // 5. Execute atomic OCC update
    const result = await PatientRepository.updateWithOCC(id, input.version, updateData);

    if (result.count === 0) {
      // Concurrent write won the race between findById and updateMany
      throw ApiError.conflict(
        'Stale patient update rejected: concurrent modification detected during atomic write. Please reload and reapply.',
        { expectedVersion: input.version }
      );
    }

    // 6. Fetch and return updated record
    const updated = await PatientRepository.findById(id);
    if (!updated) {
      throw ApiError.internal('Failed to retrieve updated patient record');
    }

    logger.info(
      {
        patientId: id,
        newVersion: updated.version,
        actorId: userContext.userId,
        actorRole: userContext.role,
      },
      'Patient record updated successfully with incremented version'
    );

    return this.toPatientResponse(updated);
  }

  /**
   * Records a point-in-time clinical vital sign observation for a patient.
   * Strictly append-only: previous observations are never modified or overwritten.
   */
  static async createPatientVital(
    patientId: string,
    input: CreateVitalSignInput,
    userContext: AuthenticatedUserContext
  ): Promise<PatientVitalSignResponse> {
    // 1. Verify patient exists
    const patient = await PatientRepository.findById(patientId);
    if (!patient) {
      throw ApiError.notFound(`Patient with ID '${patientId}' was not found`);
    }

    // 2. Validate that at least one vital sign metric is provided
    const hasAnyMetric =
      input.systolicBp != null ||
      input.diastolicBp != null ||
      input.heartRate != null ||
      input.respiratoryRate != null ||
      input.oxygenSaturation != null ||
      input.temperature != null ||
      input.gcsScore != null;

    if (!hasAnyMetric) {
      throw ApiError.badRequest('At least one physiological vital sign metric must be provided');
    }

    const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();

    // 3. Append observation
    const vital = await PatientRepository.createVitalSign({
      patientId,
      recordedBy: userContext.userId,
      systolicBp: input.systolicBp ?? null,
      diastolicBp: input.diastolicBp ?? null,
      heartRate: input.heartRate ?? null,
      respiratoryRate: input.respiratoryRate ?? null,
      oxygenSaturation: input.oxygenSaturation ?? null,
      temperature: input.temperature ?? null,
      gcsScore: input.gcsScore ?? null,
      source: input.source,
      recordedAt,
    });

    logger.info(
      {
        vitalId: vital.id,
        patientId,
        recordedBy: userContext.userId,
        source: vital.source,
      },
      'Patient vital sign observation recorded (append-only)'
    );

    return this.toVitalSignResponse(vital);
  }

  /**
   * Retrieves all vital sign observations for a patient ordered chronologically descending.
   */
  static async getPatientVitals(patientId: string): Promise<PatientVitalSignResponse[]> {
    // 1. Verify patient exists
    const patient = await PatientRepository.findById(patientId);
    if (!patient) {
      throw ApiError.notFound(`Patient with ID '${patientId}' was not found`);
    }

    const vitals = await PatientRepository.findVitalsByPatientId(patientId);
    return vitals.map((v) => this.toVitalSignResponse(v));
  }
}
