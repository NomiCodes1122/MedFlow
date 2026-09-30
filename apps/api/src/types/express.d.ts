import { UserRole } from '@prisma/client';

export interface AuthenticatedUserContext {
  userId: string;
  supabaseUid: string;
  phone: string;
  role: UserRole;
  sessionId: string;
  deviceId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation ID for tracing requests across logs and responses.
       */
      id: string;
      /**
       * Request start time for latency calculation.
       */
      startTime?: number;
      /**
       * Authenticated context established by authentication middleware.
       */
      auth?: AuthenticatedUserContext;
      /**
       * Standard Express user property alias pointing to auth context.
       */
      user?: AuthenticatedUserContext;
    }
  }
}

export {};
