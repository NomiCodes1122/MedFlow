import { prisma } from '../../database/prisma.js';
import { NotificationRepository } from './notification.repository.js';
import { NotificationService } from './notification.service.js';
import { NotificationController } from './notification.controller.js';
import { createNotificationRouter } from './notification.routes.js';

export const notificationRepository = new NotificationRepository(prisma);
export const notificationService = new NotificationService(notificationRepository);
export const notificationController = new NotificationController(notificationRepository);
export const notificationRouter = createNotificationRouter(notificationController);

// Start the worker
if (process.env.NODE_ENV !== 'test') {
  notificationService.startWorker();
}
