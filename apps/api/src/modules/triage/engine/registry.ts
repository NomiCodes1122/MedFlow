import { ITriageProtocol, ProtocolMetadata, TriageEvaluationResult } from '../triage.types.js';
import { ApiError } from '../../../common/errors/ApiError.js';

export class ClinicalApprovalPendingError extends ApiError {
  constructor(protocolCode: string, protocolVersion: string) {
    super(
      501,
      'CLINICAL_APPROVAL_PENDING',
      `Triage protocol '${protocolCode}' version '${protocolVersion}' clinical evaluation logic is pending formal review and authorization by local emergency-care leadership. Automated clinical decision categorization cannot be executed.`
    );
  }
}

/**
 * START (Simple Triage and Rapid Treatment) Protocol definition.
 * Clinical evaluation logic remains strictly inactive until local medical direction approval.
 */
export class StartProtocol implements ITriageProtocol {
  readonly protocolCode = 'START';
  readonly protocolVersion = '1.0.0';
  readonly name = 'Simple Triage and Rapid Treatment (Adult Mass Casualty)';
  readonly careSetting = 'PRE_HOSPITAL' as const;
  readonly isApproved = false;
  readonly approvalStatus = 'PENDING_CLINICAL_APPROVAL' as const;

  validateInputs(inputs: any): {
    valid: boolean;
    errors?: string[];
    sanitized?: Record<string, unknown>;
  } {
    const errors: string[] = [];
    if (!inputs || typeof inputs !== 'object') {
      return { valid: false, errors: ['START input observations must be a non-empty object'] };
    }

    const sanitized: Record<string, unknown> = {};

    if (inputs.canWalk !== undefined && typeof inputs.canWalk !== 'boolean') {
      errors.push('canWalk must be a boolean');
    } else {
      sanitized.canWalk = inputs.canWalk;
    }

    if (inputs.hasRespirations !== undefined && typeof inputs.hasRespirations !== 'boolean') {
      errors.push('hasRespirations must be a boolean');
    } else {
      sanitized.hasRespirations = inputs.hasRespirations;
    }

    if (inputs.respiratoryRate !== undefined && inputs.respiratoryRate !== null) {
      if (typeof inputs.respiratoryRate !== 'number' || !Number.isInteger(inputs.respiratoryRate) || inputs.respiratoryRate < 0 || inputs.respiratoryRate > 100) {
        errors.push('respiratoryRate must be an integer between 0 and 100 breaths/min');
      } else {
        sanitized.respiratoryRate = inputs.respiratoryRate;
      }
    }

    if (inputs.radialPulse !== undefined && typeof inputs.radialPulse !== 'boolean') {
      errors.push('radialPulse must be a boolean');
    } else {
      sanitized.radialPulse = inputs.radialPulse;
    }

    if (inputs.capillaryRefillSec !== undefined && inputs.capillaryRefillSec !== null) {
      if (typeof inputs.capillaryRefillSec !== 'number' || inputs.capillaryRefillSec < 0 || inputs.capillaryRefillSec > 20) {
        errors.push('capillaryRefillSec must be a number between 0 and 20 seconds');
      } else {
        sanitized.capillaryRefillSec = inputs.capillaryRefillSec;
      }
    }

    if (inputs.followsCommands !== undefined && typeof inputs.followsCommands !== 'boolean') {
      errors.push('followsCommands must be a boolean');
    } else {
      sanitized.followsCommands = inputs.followsCommands;
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      sanitized,
    };
  }

  evaluate(_inputs: unknown): TriageEvaluationResult {
    throw new ClinicalApprovalPendingError(this.protocolCode, this.protocolVersion);
  }
}

/**
 * WHO MC-IITT (Mass Casualty Initial Injury Triage Tool) Protocol definition.
 * Clinical evaluation logic remains strictly inactive until local emergency-care leadership approval.
 */
export class WhoMcIittProtocol implements ITriageProtocol {
  readonly protocolCode = 'WHO_MC_IITT';
  readonly protocolVersion = '1.0.0';
  readonly name = 'WHO Mass Casualty Initial Injury Triage Tool (Hospital Intake)';
  readonly careSetting = 'HOSPITAL' as const;
  readonly isApproved = false;
  readonly approvalStatus = 'PENDING_CLINICAL_APPROVAL' as const;

  validateInputs(inputs: any): {
    valid: boolean;
    errors?: string[];
    sanitized?: Record<string, unknown>;
  } {
    const errors: string[] = [];
    if (!inputs || typeof inputs !== 'object') {
      return { valid: false, errors: ['WHO MC-IITT observations must be a non-empty object'] };
    }

    const sanitized: Record<string, unknown> = {};

    if (inputs.severeHemorrhage !== undefined && typeof inputs.severeHemorrhage !== 'boolean') {
      errors.push('severeHemorrhage must be a boolean');
    } else {
      sanitized.severeHemorrhage = inputs.severeHemorrhage;
    }

    if (inputs.airwayCompromised !== undefined && typeof inputs.airwayCompromised !== 'boolean') {
      errors.push('airwayCompromised must be a boolean');
    } else {
      sanitized.airwayCompromised = inputs.airwayCompromised;
    }

    if (inputs.burnPercentage !== undefined && inputs.burnPercentage !== null) {
      if (typeof inputs.burnPercentage !== 'number' || inputs.burnPercentage < 0 || inputs.burnPercentage > 100) {
        errors.push('burnPercentage must be a number between 0 and 100');
      } else {
        sanitized.burnPercentage = inputs.burnPercentage;
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      sanitized,
    };
  }

  evaluate(_inputs: unknown): TriageEvaluationResult {
    throw new ClinicalApprovalPendingError(this.protocolCode, this.protocolVersion);
  }
}

export class TriageProtocolRegistry {
  private static protocols: Map<string, ITriageProtocol> = new Map();

  static {
    // Register initial baseline protocols in inactive/structural validation state
    this.register(new StartProtocol());
    this.register(new WhoMcIittProtocol());
  }

  private static getKey(code: string, version: string): string {
    return `${code.toUpperCase()}::${version}`;
  }

  static register(protocol: ITriageProtocol): void {
    const key = this.getKey(protocol.protocolCode, protocol.protocolVersion);
    this.protocols.set(key, protocol);
  }

  static get(code: string, version: string): ITriageProtocol | undefined {
    return this.protocols.get(this.getKey(code, version));
  }

  static listProtocols(): ProtocolMetadata[] {
    return Array.from(this.protocols.values()).map((p) => ({
      protocolCode: p.protocolCode,
      protocolVersion: p.protocolVersion,
      name: p.name,
      careSetting: p.careSetting,
      isApproved: p.isApproved,
      approvalStatus: p.approvalStatus,
      description: p.isApproved
        ? 'Active operational protocol'
        : 'Protocol registered for structural validation. Clinical evaluation algorithm inactive pending formal medical approval.',
    }));
  }
}
