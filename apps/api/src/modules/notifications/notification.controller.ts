import { Request, Response, NextFunction } from 'express';
import { NotificationRepository } from './notification.repository.js';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { z } from 'zod';

export class NotificationController {
  constructor(private readonly repo: NotificationRepository) {}

  listNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).auth?.userId;
      if (!userId) {
        ApiResponse.error(res, 401, 'UNAUTHORIZED', 'Authentication required', (req as any).id);
        return;
      }

      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;

      const { data, total } = await this.repo.getUserNotifications(userId, offset, limit);
      const page = Math.floor(offset / limit) + 1;
      ApiResponse.paginated(res, data, page, limit, total);
    } catch (error) {
      next(error);
    }
  };

  markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as any).auth?.userId;
      if (!userId) {
        ApiResponse.error(res, 401, 'UNAUTHORIZED', 'Authentication required', (req as any).id);
        return;
      }

      const id = req.params.id as string;
      const success = await this.repo.markAsRead(id, userId);

      if (!success) {
        // Might be not found, or not belonging to user, or already read.
        ApiResponse.success(res, { message: 'Notification not found or already read' });
        return;
      }
      
      ApiResponse.success(res, { success: true });
    } catch (error) {
      next(error);
    }
  };
}
