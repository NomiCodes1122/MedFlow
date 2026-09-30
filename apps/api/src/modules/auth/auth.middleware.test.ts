import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, UserStatus } from '@prisma/client';
import { requireAuthentication, requireRole, requireRoles } from './auth.middleware.js';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { ApiError } from '../../common/errors/ApiError.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';
import { prisma } from '../../database/prisma.js';

vi.mock('../../database/prisma.js', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
      },
      refreshToken: {
        findUnique: vi.fn(),
      },
    },
  };
});

describe('Authentication & RBAC Middleware', () => {
  const mockUser = {
    id: 'user-uuid-paramedic-001',
    supabaseUid: 'firebase-uid-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
  };

  const validPayload = {
    sub: mockUser.id,
    supabaseUid: mockUser.supabaseUid,
    phone: mockUser.phone,
    role: mockUser.role,
    sessionId: 'session-uuid-12345',
    deviceId: 'device-uuid-999',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireAuthentication', () => {
    it('should reject requests missing Authorization header', async () => {
      const req: any = { headers: {} };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });

    it('should reject malformed Authorization headers', async () => {
      const req: any = { headers: { authorization: 'Basic 12345' } };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe(ErrorCodes.AUTH_INVALID_TOKEN);
    });

    it('should reject expired access tokens', async () => {
      // Create a token expired 10 seconds ago
      vi.spyOn(TokenService, 'verifyAccessToken').mockImplementationOnce(() => {
        throw ApiError.authTokenExpired('Access token has expired');
      });

      const req: any = { headers: { authorization: 'Bearer expired.token.jwt' } };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe(ErrorCodes.AUTH_TOKEN_EXPIRED);
    });

    it('should reject when session in database is revoked', async () => {
      const token = TokenService.signAccessToken(validPayload);
      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(false);

      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe(ErrorCodes.AUTH_SESSION_REVOKED);
    });

    it('should reject when user is deactivated in database', async () => {
      const token = TokenService.signAccessToken(validPayload);
      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...mockUser,
        status: UserStatus.INACTIVE,
      } as any);

      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe(ErrorCodes.AUTH_USER_INACTIVE);
    });

    it('should authenticate successfully and attach req.auth and req.user', async () => {
      const token = TokenService.signAccessToken(validPayload);
      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockUser as any);

      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res: any = {};
      const next = vi.fn();

      await requireAuthentication(req, res, next);

      expect(next).toHaveBeenCalledWith(); // Called with no error
      expect(req.auth).toBeDefined();
      expect(req.auth.userId).toBe(mockUser.id);
      expect(req.auth.role).toBe(UserRole.PARAMEDIC);
      expect(req.user).toBe(req.auth);
    });
  });

  describe('RBAC Middleware: requireRole & requireRoles', () => {
    it('should allow PARAMEDIC to access paramedic-restricted handler', () => {
      const req: any = {
        auth: { ...validPayload, role: UserRole.PARAMEDIC },
      };
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRole(UserRole.PARAMEDIC);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should deny PARAMEDIC with 403 when TRIAGE_DOCTOR role is required', () => {
      const req: any = {
        auth: { ...validPayload, role: UserRole.PARAMEDIC },
      };
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRole(UserRole.TRIAGE_DOCTOR);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });

    it('should allow HOSPITAL_SUPERINTENDENT when superintendent role is required', () => {
      const req: any = {
        auth: { ...validPayload, role: UserRole.HOSPITAL_SUPERINTENDENT },
      };
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRole(UserRole.HOSPITAL_SUPERINTENDENT);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should permit access when role matches one of allowed roles in requireRoles', () => {
      const req: any = {
        auth: { ...validPayload, role: UserRole.TRIAGE_DOCTOR },
      };
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRoles([
        UserRole.TRIAGE_DOCTOR,
        UserRole.HOSPITAL_SUPERINTENDENT,
      ]);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should deny access when role is not in requireRoles allowed list', () => {
      const req: any = {
        auth: { ...validPayload, role: UserRole.PARAMEDIC },
      };
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRoles([
        UserRole.TRIAGE_DOCTOR,
        UserRole.HOSPITAL_SUPERINTENDENT,
      ]);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });

    it('should reject with 401 AUTH_REQUIRED if req.auth is missing', () => {
      const req: any = {};
      const res: any = {};
      const next = vi.fn();

      const middleware = requireRole(UserRole.PARAMEDIC);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = next.mock.calls[0][0];
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });
  });
});
