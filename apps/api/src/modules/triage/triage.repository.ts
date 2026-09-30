import { Prisma, TriageAssessment, TriageCategory } from '@prisma/client';
import { prisma } from '../../database/prisma.js';

export class TriageRepository {
  /**
   * Executes database operations within an isolated transaction.
   */
  static async withTransaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(action, {
      maxWait: 5000,
      timeout: 10000,
    });
  }

  /**
   * Persists an immutable clinical assessment record.
   * Strictly append-only: database trigger fn_prevent_modification prevents any update or deletion.
   */
  static async createAssessment(
    data: Prisma.TriageAssessmentUncheckedCreateInput,
    tx?: Prisma.TransactionClient
  ): Promise<TriageAssessment> {
    const client = tx || prisma;
    return client.triageAssessment.create({
      data,
    });
  }

  /**
   * Retrieves an assessment by UUID.
   */
  static async findById(
    id: string,
    tx?: Prisma.TransactionClient
  ): Promise<TriageAssessment | null> {
    const client = tx || prisma;
    return client.triageAssessment.findUnique({
      where: { id },
    });
  }

  /**
   * Retrieves the authoritative latest assessment for a patient by assessment timestamp.
   */
  static async findLatestByPatientId(
    patientId: string,
    tx?: Prisma.TransactionClient
  ): Promise<TriageAssessment | null> {
    const client = tx || prisma;
    return client.triageAssessment.findFirst({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
    });
  }

  /**
   * Retrieves complete chronological assessment history for a patient.
   */
  static async findHistoryByPatientId(
    patientId: string,
    params: { skip: number; take: number }
  ): Promise<TriageAssessment[]> {
    return prisma.triageAssessment.findMany({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
      skip: params.skip,
      take: params.take,
    });
  }

  /**
   * Counts total triage assessments for a patient.
   */
  static async countByPatientId(patientId: string): Promise<number> {
    return prisma.triageAssessment.count({
      where: { patientId },
    });
  }

  /**
   * Fetches patient record with currently linked assessment.
   */
  static async findPatientForTriage(
    patientId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || prisma;
    return client.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      include: { currentTriageAssessment: true },
    });
  }

  /**
   * Atomically updates a patient's active triage category and current assessment pointer.
   * If expectedVersion is provided, enforces Optimistic Concurrency Control (OCC).
   */
  static async updatePatientActiveTriage(
    patientId: string,
    expectedVersion: number | undefined,
    data: {
      currentTriageAssessmentId: string;
      currentTriageCategory: TriageCategory;
    },
    tx: Prisma.TransactionClient
  ): Promise<{ count: number }> {
    if (expectedVersion !== undefined) {
      return tx.patient.updateMany({
        where: {
          id: patientId,
          version: expectedVersion,
          deletedAt: null,
        },
        data: {
          ...data,
          version: { increment: 1 },
        },
      });
    }

    // D-03: Use updateMany (not update) so count reflects the actual number of rows
    // matched. An unconditional update() always returns a row object (never throws
    // a "not found" on soft-deleted rows) and would return count: 1 even when the
    // patient was concurrently soft-deleted, defeating the count===0 safety check.
    return tx.patient.updateMany({
      where: { id: patientId, deletedAt: null },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  /**
   * Lists patients in the triage queue ordered by urgency category.
   */
  static async findTriageQueue(params: {
    incidentId?: string;
    category?: TriageCategory;
    skip: number;
    take: number;
  }) {
    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
    };

    if (params.incidentId) {
      where.incidentId = params.incidentId;
    }

    if (params.category) {
      where.currentTriageCategory = params.category;
    }

    const [patients, total] = await Promise.all([
      prisma.patient.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: [{ currentTriageCategory: 'asc' }, { updatedAt: 'desc' }],
        include: { currentTriageAssessment: true },
      }),
      prisma.patient.count({ where }),
    ]);

    return { patients, total };
  }
}
