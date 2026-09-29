import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { SyncService } from './sync.service.js';
import { SyncBatchInput } from './sync.types.js';

export class SyncController {
  /**
   * POST /api/v1/sync/batch
   * Process a batch of offline-queued mutations idempotently.
   */
  static async processBatch(
    req: Request<{}, {}, SyncBatchInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await SyncService.processBatch(req.body, req.auth!);
      ApiResponse.success(res, result);
    } catch (error) {
      next(error);
    }
  }
}
