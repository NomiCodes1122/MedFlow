import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../app.js';
import { prisma } from '../../database/prisma.js';
import { TokenService } from '../auth/token.service.js';
import { UserRole, DeliveryStatus } from '@prisma/client';

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    notificationDelivery: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((args) => Array.isArray(args) ? Promise.all(args) : args(prisma)),
  },
}));

describe('Notifications Integration & Delivery', () => {
  const userToken = TokenService.signAccessToken({
    sub: 'user-1',
    supabaseUid: 'firebase-user',
    phone: '+1234567890',
    role: UserRole.PARAMEDIC,
    status: 'ACTIVE',
    sessionId: 'session-789',
  } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', role: 'PARAMEDIC', status: 'ACTIVE', deletedAt: null } as any);
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({ revokedAt: null, expiresAt: new Date(Date.now() + 10000) } as any);
    vi.mocked(prisma.notificationDelivery.count).mockResolvedValue(1);
    vi.mocked(prisma.notificationDelivery.findMany).mockResolvedValue([
      { id: 'del-1', status: DeliveryStatus.QUEUED, notification: { title: 'Test' } }
    ] as any);
  });

  it('should list notifications for the authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.notificationDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientUserId: 'user-1' } })
    );
  });

  it('should mark a notification as read safely', async () => {
    vi.mocked(prisma.notificationDelivery.updateMany).mockResolvedValue({ count: 1 });

    const res = await request(app)
      .post('/api/v1/notifications/del-1/read')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.notificationDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'del-1', recipientUserId: 'user-1' })
      })
    );
  });
});
