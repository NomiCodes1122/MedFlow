import { prisma } from '../../database/prisma.js';
import { AlertRepository } from './alert.repository.js';
import { AlertService } from './alert.service.js';
import { AlertController } from './alert.controller.js';
import { createAlertRouter } from './alert.routes.js';
import { notificationRepository } from '../notifications/index.js';

export const alertRepository = new AlertRepository(prisma);
export const alertService = new AlertService(prisma, alertRepository, notificationRepository);
export const alertController = new AlertController(alertService, alertRepository);
export const alertRouter = createAlertRouter(alertController);
