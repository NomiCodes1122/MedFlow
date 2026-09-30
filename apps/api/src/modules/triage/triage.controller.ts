import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { TriageService } from './triage.service.js';

export class TriageController {
  /**
   * POST /api/v1/patients/:id/triage
   * Records an immutable clinical triage assessment or reassessment.
   */
  static async createAssessment(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const patientId = req.params.id as string;
      const userContext = req.auth!;

      const assessment = await TriageService.recordAssessment(
        patientId,
        req.body,
        userContext
      );

      ApiResponse.created(
        res,
        assessment
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/patients/:id/triage/history
   * Retrieves complete chronological triage assessment history for a patient.
   */
  static async getPatientHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const patientId = req.params.id as string;
      const query = req.query as any;

      const result = await TriageService.getPatientHistory(patientId, query);

      ApiResponse.paginated(
        res,
        result.items,
        result.page,
        result.limit,
        result.total
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/triage/queue
   * Retrieves active triage queue prioritized by urgency.
   */
  static async getQueue(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const query = req.query as any;
      const result = await TriageService.getTriageQueue(query);

      ApiResponse.paginated(
        res,
        result.items,
        result.page,
        result.limit,
        result.total
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/triage/protocols
   * Lists available triage protocols and their formal clinical approval status.
   */
  static async getProtocols(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const protocols = TriageService.listProtocols();
      ApiResponse.success(res, { protocols });
    } catch (error) {
      next(error);
    }
  }
}
