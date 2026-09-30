import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { MediaService } from './media.service.js';

export class MediaController {
  /**
   * POST /api/v1/patients/:id/media
   * Initiates media attachment intake for a patient and returns a pre-signed upload URL.
   */
  static async initiateUpload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MediaService.initiateUpload(
        req.params.id as string,
        req.body,
        req.auth!
      );
      ApiResponse.created(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/patients/:id/media
   * Lists all media attachments for a patient with pagination.
   */
  static async listPatientMedia(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MediaService.listPatientMedia(
        req.params.id as string,
        req.query as any
      );
      ApiResponse.paginated(res, result.items, result.page, result.limit, result.total);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/media/:id
   * Retrieves media metadata and a fresh signed access URL.
   */
  static async getMedia(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MediaService.getMediaById(
        req.params.id as string
      );
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/media/:id/upload
   * Direct binary upload endpoint for mobile/web clients.
   * Performs binary magic bytes inspection and storage.
   */
  static async directUpload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer)) {
        throw ApiError.badRequest('Expected raw binary body payload');
      }

      const mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
      const result = await MediaService.directUpload(
        req.params.id as string,
        buffer,
        mimeType,
        req.auth!
      );
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/media/:id/verify
   * Confirms that an upload completed in cloud storage.
   */
  static async verifyUpload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MediaService.verifyUpload(
        req.params.id as string,
        req.body?.checksumSha256
      );
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/media/:id
   * Deletes a media attachment from storage and marks/removes in database.
   */
  static async deleteMedia(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MediaService.deleteMedia(
        req.params.id as string,
        req.auth!
      );
      ApiResponse.success(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
