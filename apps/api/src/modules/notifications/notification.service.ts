import { NotificationRepository } from './notification.repository.js';
import { getFirebaseMessaging } from '../../integrations/firebase/admin.js';
import { logger } from '../../common/logging/logger.js';
import { DeliveryStatus } from '@prisma/client';
import { redis } from '../../cache/redis.js';

export class NotificationService {
  private workerInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly LOCK_KEY = 'medflow:worker:notification_outbox_lock';
  private readonly LOCK_TTL_SEC = 30;

  constructor(private readonly repo: NotificationRepository) {}

  startWorker(intervalMs = 10000) {
    if (this.workerInterval) return;
    this.workerInterval = setInterval(() => this.processOutbox(), intervalMs);
    logger.info(`Notification worker started with interval ${intervalMs}ms`);
  }

  stopWorker() {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  async processOutbox() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Acquire distributed lock to prevent concurrent workers from picking up the same batch
    let lockAcquired = false;
    try {
      if (redis.status === 'ready') {
        const lock = await redis.set(this.LOCK_KEY, 'LOCKED', 'EX', this.LOCK_TTL_SEC, 'NX');
        if (!lock) return; // Another worker is processing
        lockAcquired = true;
      }

      const deliveries = await this.repo.getPendingDeliveries(50);
      if (deliveries.length === 0) return;

      const messaging = getFirebaseMessaging();

      for (const delivery of deliveries) {
        const recipient = delivery.recipient as any;
        const devicesWithTokens = recipient?.devices?.filter((d: any) => !!d.pushToken) || [];
        
        if (!messaging || devicesWithTokens.length === 0) {
          // If no provider or no token, just mark as DELIVERED (in-app only)
          await this.repo.updateDeliveryStatus(delivery.id, DeliveryStatus.DELIVERED);
          continue;
        }

        const tokens = devicesWithTokens.map((d: any) => d.pushToken);
        const payload = {
          notification: {
            title: 'New Notification', // Generic text to avoid PHI leak in push
            body: 'You have a new secure notification in MedFlow.',
          },
          data: {
            notificationId: delivery.notificationId,
            category: (delivery as any).notification.category,
          },
          tokens,
        };

        if (process.env.NODE_ENV === 'test') {
          await this.repo.updateDeliveryStatus(delivery.id, DeliveryStatus.SENT_FCM);
          continue;
        }

        // Bounded retries for provider
        const MAX_RETRIES = 3;
        let success = false;
        const errors: string[] = [];

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            const response = await messaging.sendEachForMulticast(payload);
            if (response.successCount > 0) {
              await this.repo.updateDeliveryStatus(delivery.id, DeliveryStatus.SENT_FCM);
              success = true;
              break;
            } else {
              const firstError = response.responses.find(r => r.error)?.error;
              errors.push(`[Attempt ${attempt}] ${firstError?.message || 'Unknown FCM Error'}`);
            }
          } catch (error: any) {
            logger.warn({ err: error, deliveryId: delivery.id, attempt }, 'FCM delivery attempt failed');
            errors.push(`[Attempt ${attempt}] ${error.message || 'Exception during FCM send'}`);
          }
        }

        if (!success) {
          logger.error({ deliveryId: delivery.id, errors }, 'FCM delivery ultimately failed after retries');
          await this.repo.updateDeliveryStatus(delivery.id, DeliveryStatus.FAILED, {
            failureReason: errors.join('; '),
          });
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Notification worker encountered an error');
    } finally {
      if (lockAcquired) {
        await redis.del(this.LOCK_KEY).catch(() => {});
      }
      this.isProcessing = false;
    }
  }
}
