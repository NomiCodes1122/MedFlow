import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { PatientService } from './patient.service.js';

export class PatientController {
  /**
   * POST /api/v1/patients
   * Registers a new patient intake record.
   */
  static async createPatient(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const patient = await PatientService.createPatient(req.body, req.auth!);
      ApiResponse.created(res, patient);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/patients/:id
   * Retrieves a single patient by UUID.
   */
  static async getPatient(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const patient = await PatientService.getPatientById(req.params.id as string);
      ApiResponse.success(res, patient, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/patients
   * Lists patients with pagination and optional status/incident filters.
   */
  static async listPatients(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await PatientService.listPatients(req.query as any);
      ApiResponse.paginated(res, result.items, result.page, result.limit, result.total);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/patients/:id
   * Updates an existing patient record using Optimistic Concurrency Control (OCC).
   */
  static async updatePatient(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const patient = await PatientService.updatePatient(
        req.params.id as string,
        req.body,
        req.auth!
      );
      ApiResponse.success(res, patient, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/patients/:id/vitals
   * Appends a new physiological vital sign observation for a patient.
   */
  static async createVital(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const vital = await PatientService.createPatientVital(
        req.params.id as string,
        req.body,
        req.auth!
      );
      ApiResponse.created(res, vital);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/patients/:id/vitals
   * Retrieves chronological vital signs history for a patient.
   */
  static async getVitals(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const vitals = await PatientService.getPatientVitals(req.params.id as string);
      ApiResponse.success(res, vitals, 200);
    } catch (error) {
      next(error);
    }
  }
}
