import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { TokenService } from '../auth/token.service.js';
import { UserRole, AlertStatus, AlertType, AlertSeverity } from '@prisma/client';

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    alert: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb(prisma)),
  },
}));

describe('Alerts Integration & Lifecycle', () => {
  const adminToken = TokenService.signAccessToken({
    sub: 'admin-id',
    supabaseUid: 'firebase-admin',
    phone: '+1234567890',
    role: UserRole.HOSPITAL_SUPERINTENDENT,
    status: 'ACTIVE',
    sessionId: 'session-123',
  } as any);

  const paramedicToken = TokenService.signAccessToken({
    sub: 'paramedic-id',
    supabaseUid: 'firebase-paramedic',
    phone: '+1987654321',
    role: UserRole.PARAMEDIC,
    status: 'ACTIVE',
    sessionId: 'session-456',
  } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'admin-id', role: 'HOSPITAL_SUPERINTENDENT', status: 'ACTIVE', deletedAt: null } as any);
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 10000) } as any);
  });

  it('should create an alert and queue notifications', async () => {
    vi.mocked(prisma.alert.create).mockResolvedValue({
      id: 'alert-1',
      type: AlertType.MANUAL_ALERT,
      severity: AlertSeverity.HIGH,
      status: AlertStatus.OPEN,
      title: 'Test Alert',
      description: 'Test description',
    } as any);

    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'admin-id' }] as any);

    const res = await request(app)
      .post('/api/v1/alerts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: 'MANUAL_ALERT',
        severity: 'HIGH',
        title: 'Test Alert',
        description: 'Test description',
      });

    expect(res.status).toBe(201);
    expect(prisma.alert.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ALERT_CREATED' }) })
    );
    expect(prisma.notification.create).toHaveBeenCalled();
  });

  it('should reject invalid lifecycle transition (RESOLVED -> OPEN)', async () => {
    vi.mocked(prisma.alert.findUnique).mockResolvedValue({
      id: 'alert-1',
      status: AlertStatus.RESOLVED,
    } as any);

    const res = await request(app)
      .patch('/api/v1/alerts/alert-1/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: AlertStatus.OPEN });

    expect(res.status).toBe(409);
    expect(res.status).toBe(409);
  });
});
