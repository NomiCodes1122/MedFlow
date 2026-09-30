import { NotificationPriority, DeliveryStatus } from '@prisma/client';

export interface CreateNotificationInput {
  priority?: NotificationPriority;
  title: string;
  body: string;
  category: string;
  entityType?: string;
  entityId?: string;
  deepLink?: string;
  recipientUserIds: string[]; // Who gets this
}
