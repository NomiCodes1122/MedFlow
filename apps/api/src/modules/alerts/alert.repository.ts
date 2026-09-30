import { PrismaClient, Alert, AlertStatus, Prisma } from '@prisma/client';

export class AlertRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Prisma.AlertUncheckedCreateInput): Promise<Alert> {
    return this.prisma.alert.create({
      data,
    });
  }

  async findById(id: string): Promise<Alert | null> {
    return this.prisma.alert.findUnique({ where: { id } });
  }

  async findByIdempotencyKey(key: string): Promise<Alert | null> {
    return this.prisma.alert.findUnique({ where: { idempotencyKey: key } });
  }

  async updateStatus(
    id: string,
    status: AlertStatus,
    timestampField?: 'acknowledgedAt' | 'resolvedAt' | 'closedAt'
  ): Promise<Alert> {
    const data: Prisma.AlertUpdateInput = { status };
    if (timestampField) {
      data[timestampField] = new Date();
    }
    return this.prisma.alert.update({
      where: { id },
      data,
    });
  }

  async findMany(where: Prisma.AlertWhereInput, skip: number, take: number): Promise<{ data: Alert[]; total: number }> {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.alert.count({ where }),
    ]);
    return { data, total };
  }
}
