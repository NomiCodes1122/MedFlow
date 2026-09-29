import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Executes a callback within an atomic Prisma ACID database transaction.
 * Allows domain services in future phases to coordinate multiple mutations.
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    return fn(tx);
  }, options);
}
