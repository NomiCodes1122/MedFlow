import { PrismaClient, Prisma, AlertStatus, AlertType, AlertSeverity } from '@prisma/client';
import { AlertRepository } from './alert.repository.js';
import { CreateAlertInput } from './alert.types.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { NotificationRepository } from '../notifications/notification.repository.js';

export class AlertService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly alertRepo: AlertRepository,
    private readonly notificationRepo: NotificationRepository
  ) {}

  async createAlert(input: CreateAlertInput, actorId: string, ipAddress?: string): Promise<any> {
    if (input.idempotencyKey) {
      const existing = await this.alertRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Create Alert
      const alert = await tx.alert.create({
        data: {
          type: input.type,
          severity: input.severity,
          title: input.title,
          description: input.description,
          patientId: input.patientId,
          incidentId: input.incidentId,
          createdBy: actorId,
          assignedTo: input.assignedTo,
          idempotencyKey: input.idempotencyKey,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          action: 'ALERT_CREATED',
          entityType: 'ALERT',
          entityId: alert.id,
          ipAddress,
          metadata: { type: alert.type, severity: alert.severity },
        },
      });

      // Notification
      let recipients: string[] = [];
      if (input.assignedTo) {
        recipients.push(input.assignedTo);
      } else {
        // If unassigned, notify HOSPITAL_SUPERINTENDENTs
        const supers = await tx.user.findMany({
          where: { role: 'HOSPITAL_SUPERINTENDENT', status: 'ACTIVE' },
          select: { id: true },
        });
        recipients = supers.map(s => s.id);
      }

      if (recipients.length > 0) {
        await this.notificationRepo.createWithDeliveries(
          {
            priority: input.severity === 'CRITICAL' ? 'CRITICAL' : 'MODERATE',
            title: `Alert: ${alert.title}`,
            body: alert.description,
            category: 'ALERT',
            entityType: 'ALERT',
            entityId: alert.id,
          },
          recipients,
          tx
        );
      }

      return alert;
    });
  }

  async updateAlertStatus(alertId: string, newStatus: AlertStatus, actorId: string, ipAddress?: string) {
    const alert = await this.alertRepo.findById(alertId);
    if (!alert) {
      throw ApiError.notFound('Alert not found');
    }

    if (alert.status === newStatus) {
      return alert;
    }

    // Lifecycle transitions validation
    if (alert.status === AlertStatus.CLOSED) {
      throw ApiError.conflict('Cannot update a closed alert');
    }

    if (alert.status === AlertStatus.RESOLVED && newStatus !== AlertStatus.CLOSED) {
      throw ApiError.conflict('A resolved alert can only be closed');
    }

    let timestampField: 'acknowledgedAt' | 'resolvedAt' | 'closedAt' | undefined;
    if (newStatus === AlertStatus.ACKNOWLEDGED) timestampField = 'acknowledgedAt';
    if (newStatus === AlertStatus.RESOLVED) timestampField = 'resolvedAt';
    if (newStatus === AlertStatus.CLOSED) timestampField = 'closedAt';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.alert.update({
        where: { id: alertId },
        data: {
          status: newStatus,
          ...(timestampField ? { [timestampField]: new Date() } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          action: `ALERT_${newStatus}`,
          entityType: 'ALERT',
          entityId: alertId,
          ipAddress,
          metadata: { previousStatus: alert.status, newStatus },
        },
      });

      return updated;
    });
  }
}
