import { PrismaClient, Notification, NotificationDelivery, DeliveryStatus, Prisma } from '@prisma/client';

export class NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createWithDeliveries(
    notificationData: Prisma.NotificationUncheckedCreateInput,
    recipientUserIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Notification> {
    const db = tx || this.prisma;
    return db.notification.create({
      data: {
        ...notificationData,
        deliveries: {
          create: recipientUserIds.map((userId) => ({
            recipientUserId: userId,
            status: DeliveryStatus.QUEUED,
          })),
        },
      },
      include: {
        deliveries: true,
      },
    });
  }

  async getPendingDeliveries(batchSize = 50): Promise<any[]> {
    return this.prisma.notificationDelivery.findMany({
      where: { status: DeliveryStatus.QUEUED },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
      include: {
        notification: true,
        recipient: {
          include: {
            devices: {
              where: { pushToken: { not: null } }
            }
          }
        }
      }
    });
  }

  async updateDeliveryStatus(
    deliveryId: string,
    status: DeliveryStatus,
    updateData: Partial<NotificationDelivery> = {}
  ): Promise<void> {
    const data: Prisma.NotificationDeliveryUpdateInput = { ...updateData, status };
    if (status === DeliveryStatus.SENT_FCM) {
      data.sentAt = new Date();
    } else if (status === DeliveryStatus.DELIVERED) {
      data.deliveredAt = new Date();
    } else if (status === DeliveryStatus.READ) {
      data.readAt = new Date();
    }

    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data,
    });
  }

  async getUserNotifications(userId: string, skip: number, take: number) {
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notificationDelivery.findMany({
        where: { recipientUserId: userId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { notification: true },
      }),
      this.prisma.notificationDelivery.count({
        where: { recipientUserId: userId },
      }),
    ]);
    return { data, total };
  }

  async markAsRead(deliveryId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { id: deliveryId, recipientUserId: userId, status: { not: DeliveryStatus.READ } },
      data: {
        status: DeliveryStatus.READ,
        readAt: new Date(),
      },
    });
    return result.count > 0;
  }
}
