import { UserRole, UserStatus, DevicePlatform } from '@prisma/client';

export interface DeviceInput {
  id?: string;
  platform: DevicePlatform;
  appVersion: string;
  pushToken?: string | null;
}

export interface SessionEstablishInput {
  idToken: string;
  device?: DeviceInput;
}

export interface AccessTokenPayload {
  sub: string;
  supabaseUid: string;
  phone: string;
  role: UserRole;
  sessionId: string;
  deviceId?: string | null;
  iat?: number;
  exp?: number;
}

export interface AuthSessionResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    displayName: string;
    phone: string;
    role: UserRole;
    status: UserStatus;
  };
  device?: {
    id: string;
    platform: DevicePlatform;
    appVersion: string;
  };
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface LogoutResult {
  message: string;
  revoked: boolean;
}

export interface LogoutAllResult {
  message: string;
  revokedCount: number;
}

export interface SupabaseVerifiedUser {
  uid: string;
  phone?: string;
}
