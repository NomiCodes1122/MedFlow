import { TriageCategory, TriageSource } from '@prisma/client';

export type CareSetting = 'PRE_HOSPITAL' | 'HOSPITAL';

export interface TriageEvaluationResult {
  calculatedCategory: TriageCategory;
  rationale: string;
  decisionTrace?: Record<string, unknown>;
  evaluatedAt: string;
}

export interface ProtocolMetadata {
  protocolCode: string;
  protocolVersion: string;
  name: string;
  careSetting: CareSetting;
  isApproved: boolean;
  approvalStatus: 'PENDING_CLINICAL_APPROVAL' | 'APPROVED' | 'DEPRECATED';
  description: string;
}

/**
 * Protocol-neutral interface for triage protocols.
 * Supports versioned, deterministic implementations while enforcing safety boundaries:
 * unapproved protocols must not execute clinical decision logic.
 */
export interface ITriageProtocol {
  readonly protocolCode: string;
  readonly protocolVersion: string;
  readonly name: string;
  readonly careSetting: CareSetting;
  readonly isApproved: boolean;
  readonly approvalStatus: 'PENDING_CLINICAL_APPROVAL' | 'APPROVED' | 'DEPRECATED';

  /**
   * Performs structural and boundary validation of input observations.
   */
  validateInputs(inputs: unknown): {
    valid: boolean;
    errors?: string[];
    sanitized?: Record<string, unknown>;
  };

  /**
   * Deterministic evaluation of triage category.
   * Throws ClinicalApprovalPendingError if called prior to formal clinical leadership approval.
   */
  evaluate(inputs: unknown): TriageEvaluationResult;
}

export interface CreateTriageAssessmentInput {
  patientId?: string;
  protocolCode: string;
  protocolVersion: string;
  careSetting?: string;
  calculatedCategory: TriageCategory;
  overriddenCategory?: TriageCategory | null;
  overrideReason?: string | null;
  assessmentData?: Record<string, unknown> | null;
  decisionTrace?: Record<string, unknown> | null;
  assessmentSource?: TriageSource;
  assessedAt?: string | Date;
  expectedPatientVersion?: number;

  // Legacy/START observation compatibility fields
  canWalk?: boolean | null;
  hasRespirations?: boolean | null;
  respiratoryRate?: number | null;
  radialPulse?: boolean | null;
  capillaryRefillSec?: number | null;
  followsCommands?: boolean | null;
}

export interface TriageAssessmentResponse {
  id: string;
  patientId: string;
  assessedBy: string;
  protocolCode: string;
  protocolVersion: string;
  careSetting: string;
  calculatedCategory: TriageCategory;
  overriddenCategory: TriageCategory | null;
  effectiveCategory: TriageCategory;
  overrideReason: string | null;
  assessmentData: Record<string, unknown> | null;
  decisionTrace: Record<string, unknown> | null;
  isCurrent: boolean;
  assessmentSource: TriageSource;
  assessedAt: string;
  createdAt: string;
}

export interface TriageQueueItem {
  patientId: string;
  demoId: string;
  incidentId: string | null;
  firstName: string | null;
  lastName: string | null;
  estimatedAge: number | null;
  gender: string;
  status: string;
  currentTriageCategory: TriageCategory;
  currentAssessmentId: string | null;
  lastAssessedAt: string | null;
  chiefComplaint: string | null;
}
