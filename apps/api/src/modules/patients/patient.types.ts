import { Gender, PatientStatus, TriageCategory, VitalSource } from '@prisma/client';

export interface CreatePatientInput {
  demoId?: string;
  incidentId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  estimatedAge?: number | null;
  gender?: Gender;
  status?: PatientStatus;
  chiefComplaint?: string | null;
  notes?: string | null;
  clientCreatedAt?: Date | string;
}

export interface UpdatePatientInput {
  version: number;
  incidentId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  estimatedAge?: number | null;
  gender?: Gender;
  status?: PatientStatus;
  chiefComplaint?: string | null;
  notes?: string | null;
}

export interface PatientListQuery {
  page?: number;
  limit?: number;
  incidentId?: string;
  status?: PatientStatus;
  triageCategory?: TriageCategory;
}

export interface CreateVitalSignInput {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  respiratoryRate?: number | null;
  oxygenSaturation?: number | null;
  temperature?: number | null;
  gcsScore?: number | null;
  source?: VitalSource;
  recordedAt?: Date | string;
}

export interface PatientResponse {
  id: string;
  demoId: string;
  incidentId: string | null;
  firstName: string | null;
  lastName: string | null;
  estimatedAge: number | null;
  gender: Gender;
  status: PatientStatus;
  currentTriageCategory: TriageCategory;
  currentTriageAssessmentId?: string | null;
  chiefComplaint: string | null;
  notes: string | null;
  version: number;
  clientCreatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatientVitalSignResponse {
  id: string;
  patientId: string;
  recordedBy: string;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  oxygenSaturation: number | null;
  temperature: number | null;
  gcsScore: number | null;
  source: VitalSource;
  recordedAt: string;
  createdAt: string;
}
