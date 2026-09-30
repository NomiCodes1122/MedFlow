import { AlertType, AlertSeverity, AlertStatus } from '@prisma/client';

export interface CreateAlertInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  patientId?: string;
  incidentId?: string;
  assignedTo?: string;
  idempotencyKey?: string;
}

export interface AlertFilters {
  status?: AlertStatus;
  severity?: AlertSeverity;
  incidentId?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}
