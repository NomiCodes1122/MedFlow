import { Router } from 'express';
import { AlertController } from './alert.controller.js';
import { requireAuthentication, requireRoles } from '../auth/auth.middleware.js';
import { UserRole } from '@prisma/client';

export function createAlertRouter(controller: AlertController): Router {
  const router = Router();

  router.use(requireAuthentication);

  router.post(
    '/',
    requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR, UserRole.HOSPITAL_SUPERINTENDENT]),
    controller.createAlert
  );
  
  router.get('/', controller.listAlerts);
  
  router.get('/:id', controller.getAlert);
  
  router.patch(
    '/:id/status',
    requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR, UserRole.HOSPITAL_SUPERINTENDENT]),
    controller.updateStatus
  );

  return router;
}
