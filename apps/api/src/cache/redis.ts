import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../common/logging/logger.js';

let redisInstance: Redis | null = null;
let isConnecting = false;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy(times) {
        if (times > 3) {
          // Stop retrying excessively in dev when Redis is not running
          return null;
        }
        return Math.min(times * 500, 2000);
      },
    });

    redisInstance.on('connect', () => {
      logger.info('Connected to Redis successfully');
    });

    redisInstance.on('ready', () => {
      logger.info('Redis client is ready for operations');
    });

    redisInstance.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis connection warning / error');
    });

    redisInstance.on('close', () => {
      logger.info('Redis connection closed');
    });
  }

  return redisInstance;
}

export const redis = getRedisClient();

export async function connectRedis(): Promise<boolean> {
  if (isConnecting) return false;
  isConnecting = true;

  try {
    const client = getRedisClient();
    if (client.status === 'ready' || client.status === 'connecting') {
      return true;
    }
    await client.connect();
    return true;
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      'Redis connection could not be established on startup (will run without cache)'
    );
    return false;
  } finally {
    isConnecting = false;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!redisInstance) return;

  try {
    if (redisInstance.status === 'ready' || redisInstance.status === 'connecting') {
      await redisInstance.quit();
    } else {
      redisInstance.disconnect();
    }
    logger.info('Redis disconnected gracefully');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Redis');
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (client.status !== 'ready') {
      return false;
    }
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
