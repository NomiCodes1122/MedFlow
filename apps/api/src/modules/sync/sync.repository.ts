import { Prisma, SyncHistory } from '@prisma/client';
import { prisma } from '../../database/prisma.js';

export class SyncRepository {
  /**
   * Executes operations within an isolated Prisma transaction.
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
   * Checks if an operation has already been recorded in sync_history (Idempotency Check).
   */
  static async findOperation(
    tx: Prisma.TransactionClient,
    operationId: string
  ): Promise<SyncHistory | null> {
    return tx.syncHistory.findUnique({
      where: { operationId },
    });
  }

  /**
   * Records a sync operation outcome into sync_history.
   */
  static async recordOperation(
    tx: Prisma.TransactionClient,
    data: Prisma.SyncHistoryUncheckedCreateInput
  ): Promise<SyncHistory> {
    return tx.syncHistory.create({
      data,
    });
  }

  /**
   * Finds a non-deleted patient by ID within a transaction.
   */
  static async findPatientById(
    tx: Prisma.TransactionClient,
    id: string
  ) {
    return tx.patient.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * Creates a new patient within a transaction.
   */
  static async createPatient(
    tx: Prisma.TransactionClient,
    data: Prisma.PatientUncheckedCreateInput
  ) {
    return tx.patient.create({
      data,
    });
  }

  /**
   * Updates an existing patient with atomic OCC check within a transaction.
   */
  static async updatePatientWithOCC(
    tx: Prisma.TransactionClient,
    id: string,
    expectedVersion: number,
    data: Prisma.PatientUncheckedUpdateInput
  ) {
    return tx.patient.updateMany({
      where: {
        id,
        version: expectedVersion,
        deletedAt: null,
      },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
  }

  /**
   * Appends a vital sign observation within a transaction.
   */
  static async createVitalSign(
    tx: Prisma.TransactionClient,
    data: Prisma.PatientVitalSignUncheckedCreateInput
  ) {
    return tx.patientVitalSign.create({
      data,
    });
  }
}
