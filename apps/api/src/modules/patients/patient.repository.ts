import { Patient, PatientVitalSign, Incident, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';

export class PatientRepository {
  /**
   * Persists a newly created patient record.
   */
  static async create(data: Prisma.PatientUncheckedCreateInput): Promise<Patient> {
    return prisma.patient.create({
      data,
    });
  }

  /**
   * Retrieves a non-deleted patient by UUID.
   */
  static async findById(id: string): Promise<Patient | null> {
    return prisma.patient.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  /**
   * Retrieves a non-deleted patient by readable demoId.
   */
  static async findByDemoId(demoId: string): Promise<Patient | null> {
    return prisma.patient.findFirst({
      where: {
        demoId,
        deletedAt: null,
      },
    });
  }

  /**
   * Lists patients with deterministic pagination and ordering.
   */
  static async findMany(params: {
    skip: number;
    take: number;
    where?: Prisma.PatientWhereInput;
  }): Promise<Patient[]> {
    return prisma.patient.findMany({
      skip: params.skip,
      take: params.take,
      where: {
        ...params.where,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  /**
   * Counts total non-deleted patients matching filter criteria.
   */
  static async count(where?: Prisma.PatientWhereInput): Promise<number> {
    return prisma.patient.count({
      where: {
        ...where,
        deletedAt: null,
      },
    });
  }

  /**
   * Performs an atomic optimistic concurrency control (OCC) update.
   * Updates fields and increments version ONLY IF the expected version matches.
   */
  static async updateWithOCC(
    id: string,
    expectedVersion: number,
    data: Prisma.PatientUncheckedUpdateInput
  ): Promise<{ count: number }> {
    return prisma.patient.updateMany({
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
   * Soft-deletes a patient by setting deletedAt.
   */
  static async softDelete(id: string): Promise<{ count: number }> {
    return prisma.patient.updateMany({
      where: {
        id,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Inserts an append-only patient vital sign observation.
   */
  static async createVitalSign(
    data: Prisma.PatientVitalSignUncheckedCreateInput
  ): Promise<PatientVitalSign> {
    return prisma.patientVitalSign.create({
      data,
    });
  }

  /**
   * Retrieves all vital sign observations for a patient ordered chronologically descending.
   */
  static async findVitalsByPatientId(patientId: string): Promise<PatientVitalSign[]> {
    return prisma.patientVitalSign.findMany({
      where: {
        patientId,
      },
      orderBy: {
        recordedAt: 'desc',
      },
    });
  }

  /**
   * Checks if an incident exists for foreign key validation.
   */
  static async findIncidentById(incidentId: string): Promise<Incident | null> {
    return prisma.incident.findUnique({
      where: { id: incidentId },
    });
  }
}
