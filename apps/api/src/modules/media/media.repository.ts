import { PatientMedia, Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { MediaQueryFilters } from './media.types.js';

export class MediaRepository {
  /**
   * Inserts a new patient media record.
   */
  static async create(data: Prisma.PatientMediaCreateInput): Promise<PatientMedia> {
    return prisma.patientMedia.create({
      data,
    });
  }

  /**
   * Finds a patient media record by its unique identifier.
   */
  static async findById(id: string): Promise<PatientMedia | null> {
    return prisma.patientMedia.findUnique({
      where: { id },
      include: {
        patient: {
          select: {
            id: true,
            incidentId: true,
            demoId: true,
          },
        },
        uploader: {
          select: {
            id: true,
            displayName: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Finds all media records for a given patient with optional filters and pagination.
   */
  static async findByPatientId(
    patientId: string,
    filters: MediaQueryFilters = {}
  ): Promise<PatientMedia[]> {
    const { mediaType, status, page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.PatientMediaWhereInput = {
      patientId,
      ...(mediaType ? { mediaType } : {}),
      ...(status ? { status } : {}),
    };

    return prisma.patientMedia.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        uploader: {
          select: {
            id: true,
            displayName: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Counts total media records matching filters for pagination.
   */
  static async countByPatientId(
    patientId: string,
    filters: MediaQueryFilters = {}
  ): Promise<number> {
    const { mediaType, status } = filters;
    const where: Prisma.PatientMediaWhereInput = {
      patientId,
      ...(mediaType ? { mediaType } : {}),
      ...(status ? { status } : {}),
    };

    return prisma.patientMedia.count({ where });
  }

  /**
   * Updates an existing media record's status, public URL, or checksum.
   */
  static async update(
    id: string,
    data: Prisma.PatientMediaUpdateInput
  ): Promise<PatientMedia> {
    return prisma.patientMedia.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletes a patient media record.
   */
  static async delete(id: string): Promise<PatientMedia> {
    return prisma.patientMedia.delete({
      where: { id },
    });
  }
}
