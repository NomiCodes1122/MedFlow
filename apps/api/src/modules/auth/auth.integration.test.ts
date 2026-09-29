import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { Router } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
import { createApp } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { FirebaseAuthService } from './firebase-auth.service.js';
import { TokenService } from './token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { requireAuthentication, requireRole, requireRoles } from './auth.middleware.js';
import { ApiResponse } from '../../common/http/ApiResponse.js';
import { ErrorCodes } from '../../common/errors/errorCodes.js';

// Mock Prisma for deterministic integration testing
vi.mock('../../database/prisma.js', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      device: {
        upsert: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      refreshToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    },
  };
});

describe('MedFlow Authentication & RBAC API Endpoints', () => {
  const mockParamedic = {
    id: '11111111-1111-1111-1111-111111111111',
    firebaseUid: 'firebase-paramedic-001',
    phone: '+15550100001',
    displayName: 'Sarah Connor (Lead Paramedic)',
    role: UserRole.PARAMEDIC,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDoctor = {
    id: '22222222-2222-2222-2222-222222222222',
    firebaseUid: 'firebase-doctor-001',
    phone: '+15550100002',
    displayName: 'Dr. Marcus Vance (ER Triage Lead)',
    role: UserRole.TRIAGE_DOCTOR,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSuperintendent = {
    id: '33333333-3333-3333-3333-333333333333',
    firebaseUid: 'firebase-super-001',
    phone: '+15550100003',
    displayName: 'Chief Elena Rostova (Hospital Superintendent)',
    role: UserRole.HOSPITAL_SUPERINTENDENT,
    status: UserStatus.ACTIVE,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSession = {
    id: 'session-uuid-001',
    userId: mockParamedic.id,
    deviceId: null,
    hashedToken: 'hash-value-001',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    createdAt: new Date(),
    user: mockParamedic,
    device: null,
  };

  // Build Express app with test routes verifying RBAC middleware
  const testRouter = Router();

  testRouter.get(
    '/test-rbac/paramedic-only',
    requireAuthentication,
    requireRole(UserRole.PARAMEDIC),
    (_req, res) => {
      ApiResponse.success(res, { access: 'PARAMEDIC_GRANTED' });
    }
  );

  testRouter.get(
    '/test-rbac/doctor-only',
    requireAuthentication,
    requireRole(UserRole.TRIAGE_DOCTOR),
    (_req, res) => {
      ApiResponse.success(res, { access: 'DOCTOR_GRANTED' });
    }
  );

  testRouter.get(
    '/test-rbac/command-only',
    requireAuthentication,
    requireRoles([UserRole.TRIAGE_DOCTOR, UserRole.HOSPITAL_SUPERINTENDENT]),
    (_req, res) => {
      ApiResponse.success(res, { access: 'COMMAND_GRANTED' });
    }
  );

  const testApp = createApp(testRouter);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/auth/session (Session Establishment)', () => {
    it('should reject requests with missing ID token', async () => {
      const response = await request(testApp)
        .post('/api/v1/auth/session')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should establish session and issue credentials for active provisioned user', async () => {
      FirebaseAuthService.setCustomVerifier(async () => ({
        uid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce(mockSession as any);

      const response = await request(testApp)
        .post('/api/v1/auth/session')
        .send({ idToken: 'valid-firebase-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.tokenType).toBe('Bearer');
      expect(response.body.data.expiresIn).toBe(900);
      expect(response.body.data.user.role).toBe(UserRole.PARAMEDIC);
    });

    it('should ignore client-provided role in body and derive role strictly from database', async () => {
      FirebaseAuthService.setCustomVerifier(async () => ({
        uid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.refreshToken.create).mockResolvedValueOnce(mockSession as any);

      // Verify the client cannot override the role by sending role in the request body
      const response = await request(testApp)
        .post('/api/v1/auth/session')
        .send({
          idToken: 'valid-firebase-token',
          role: 'HOSPITAL_SUPERINTENDENT', // Forged role attempt
        });

      expect(response.status).toBe(200);
      expect(response.body.data.user.role).toBe(UserRole.PARAMEDIC);
    });

    it('should return 403 AUTH_USER_NOT_FOUND if user is unprovisioned', async () => {
      FirebaseAuthService.setCustomVerifier(async () => ({
        uid: 'unknown-uid',
        phone: '+15559999999',
      }));

      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const response = await request(testApp)
        .post('/api/v1/auth/session')
        .send({ idToken: 'unknown-token' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_USER_NOT_FOUND);
    });

    it('should return 403 AUTH_USER_INACTIVE if user is inactive', async () => {
      FirebaseAuthService.setCustomVerifier(async () => ({
        uid: mockParamedic.firebaseUid,
      }));

      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        ...mockParamedic,
        status: UserStatus.INACTIVE,
      } as any);

      const response = await request(testApp)
        .post('/api/v1/auth/session')
        .send({ idToken: 'inactive-user-token' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_USER_INACTIVE);
    });
  });

  describe('POST /api/v1/auth/refresh (Token Rotation)', () => {
    it('should reject refresh when refreshToken is missing', async () => {
      const response = await request(testApp)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should rotate single-use token and issue fresh token pair', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(mockSession as any);
      vi.mocked(prisma.$transaction).mockResolvedValueOnce([
        { ...mockSession, revokedAt: new Date() },
        { ...mockSession, id: 'new-session-uuid-002' },
      ] as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(testApp)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-refresh-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.refreshToken).toBeDefined();
      expect(response.body.data.tokenType).toBe('Bearer');
    });

    it('should detect replay attacks and revoke token family', async () => {
      const revokedSession = {
        ...mockSession,
        revokedAt: new Date(Date.now() - 5000),
      };

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(revokedSession as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 2 } as any);

      const response = await request(testApp)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'replayed-token' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_REFRESH_TOKEN_REUSED);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should revoke session when refreshToken is provided', async () => {
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 1 } as any);

      const response = await request(testApp)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'token-to-revoke' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/auth/logout-all', () => {
    it('should reject unauthenticated request with 401 AUTH_REQUIRED', async () => {
      const response = await request(testApp).post('/api/v1/auth/logout-all');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_REQUIRED);
    });

    it('should revoke all user sessions when authenticated', async () => {
      const token = TokenService.signAccessToken({
        sub: mockParamedic.id,
        firebaseUid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
        role: mockParamedic.role,
        sessionId: mockSession.id,
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValueOnce({ count: 3 } as any);

      const response = await request(testApp)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.revokedCount).toBe(3);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return authenticated user profile', async () => {
      const token = TokenService.signAccessToken({
        sub: mockDoctor.id,
        firebaseUid: mockDoctor.firebaseUid,
        phone: mockDoctor.phone,
        role: mockDoctor.role,
        sessionId: 'session-doc-01',
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(mockDoctor as any) // in requireAuthentication
        .mockResolvedValueOnce(mockDoctor as any); // in AuthService.getMe

      const response = await request(testApp)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(mockDoctor.id);
      expect(response.body.data.displayName).toBe(mockDoctor.displayName);
      expect(response.body.data.role).toBe(UserRole.TRIAGE_DOCTOR);
    });
  });

  describe('RBAC Verification on Protected Routes', () => {
    it('should allow PARAMEDIC to access paramedic-only route', async () => {
      const paramedicToken = TokenService.signAccessToken({
        sub: mockParamedic.id,
        firebaseUid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
        role: UserRole.PARAMEDIC,
        sessionId: 'session-001',
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(testApp)
        .get('/test-rbac/paramedic-only')
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.access).toBe('PARAMEDIC_GRANTED');
    });

    it('should deny PARAMEDIC from accessing doctor-only route with 403 AUTH_ROLE_REQUIRED', async () => {
      const paramedicToken = TokenService.signAccessToken({
        sub: mockParamedic.id,
        firebaseUid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
        role: UserRole.PARAMEDIC,
        sessionId: 'session-001',
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(testApp)
        .get('/test-rbac/doctor-only')
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });

    it('should allow HOSPITAL_SUPERINTENDENT to access command-only route', async () => {
      const superToken = TokenService.signAccessToken({
        sub: mockSuperintendent.id,
        firebaseUid: mockSuperintendent.firebaseUid,
        phone: mockSuperintendent.phone,
        role: UserRole.HOSPITAL_SUPERINTENDENT,
        sessionId: 'session-super-01',
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockSuperintendent as any);

      const response = await request(testApp)
        .get('/test-rbac/command-only')
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.access).toBe('COMMAND_GRANTED');
    });

    it('should deny PARAMEDIC from command-only route with 403 AUTH_ROLE_REQUIRED', async () => {
      const paramedicToken = TokenService.signAccessToken({
        sub: mockParamedic.id,
        firebaseUid: mockParamedic.firebaseUid,
        phone: mockParamedic.phone,
        role: UserRole.PARAMEDIC,
        sessionId: 'session-001',
      });

      vi.spyOn(RefreshTokenService, 'isSessionActive').mockResolvedValueOnce(true);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(mockParamedic as any);

      const response = await request(testApp)
        .get('/test-rbac/command-only')
        .set('Authorization', `Bearer ${paramedicToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe(ErrorCodes.AUTH_ROLE_REQUIRED);
    });
  });
});
