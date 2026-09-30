import { Router } from 'express';
import { NotificationController } from './notification.controller.js';
import { requireAuthentication } from '../auth/auth.middleware.js';

export function createNotificationRouter(controller: NotificationController): Router {
  const router = Router();

  router.use(requireAuthentication);

  router.get('/', controller.listNotifications);
  router.post('/:id/read', controller.markAsRead);

  return router;
}
