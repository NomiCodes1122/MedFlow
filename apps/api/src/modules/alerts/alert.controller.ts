import { Request, Response, NextFunction } from 'express';
import { AlertService } from './alert.service.js';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { createAlertSchema, updateAlertStatusSchema, alertFiltersSchema } from './alert.schemas.js';
import { AlertRepository } from './alert.repository.js';
import { PrismaClient } from '@prisma/client';

export class AlertController {
  constructor(
    private readonly alertService: AlertService,
    private readonly alertRepo: AlertRepository
  ) {}

  createAlert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createAlertSchema.parse(req.body);
      
      // We assume requireAuthentication middleware sets req.auth
      const actorId = (req as any).auth?.userId || 'SYSTEM'; 
      const ipAddress = req.ip;

      const alert = await this.alertService.createAlert(input, actorId, ipAddress);
      ApiResponse.created(res, alert);
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const { status } = updateAlertStatusSchema.parse(req.body);
      const actorId = (req as any).auth?.userId || 'SYSTEM';
      const ipAddress = req.ip;

      const updated = await this.alertService.updateAlertStatus(id, status, actorId, ipAddress);
      ApiResponse.success(res, updated);
    } catch (error) {
      next(error);
    }
  };

  listAlerts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filters = alertFiltersSchema.parse(req.query);
      const { limit, offset, ...whereClause } = filters;

      const { data, total } = await this.alertRepo.findMany(whereClause, offset, limit);
      // We compute page mathematically
      const page = Math.floor(offset / limit) + 1;
      ApiResponse.paginated(res, data, page, limit, total);
    } catch (error) {
      next(error);
    }
  };

  getAlert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const alert = await this.alertRepo.findById(id);
      if (!alert) {
        ApiResponse.error(res, 404, 'NOT_FOUND', 'Alert not found', (req as any).id);
        return;
      }
      ApiResponse.success(res, alert);
    } catch (error) {
      next(error);
    }
  };
}
