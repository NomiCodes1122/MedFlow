import { PrismaClient } from '@prisma/client';
import { logger } from '../common/logging/logger.js';
import { config } from '../config/index.js';

// Extend global namespace for development hot-reloading singleton pattern
declare global {
  // eslint-disable-next-line no-var
  var __medflow_prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: {
        url: config.database.url,
      },
    },
    log: config.isDevelopment
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });
}

export const prisma = globalThis.__medflow_prisma ?? createPrismaClient();

if (config.isDevelopment) {
  globalThis.__medflow_prisma = prisma;
}

// Attach warning/error listeners
prisma.$on('warn' as never, (e: { message: string }) => {
  logger.warn({ prismaWarning: e.message }, 'Prisma client warning');
});

prisma.$on('error' as never, (e: { message: string }) => {
  logger.error({ prismaError: e.message }, 'Prisma client error');
});

export async function connectPrisma(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connection established successfully via Prisma');
  } catch (error) {
    logger.error({ error }, 'Failed to connect to PostgreSQL via Prisma');
    throw error;
  }
}

export async function disconnectPrisma(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database connection disconnected successfully via Prisma');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Prisma client');
  }
}

export async function checkPrismaHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : error }, 'Prisma health check failed');
    return false;
  }
}
