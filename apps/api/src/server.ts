import http from 'http';
import { app } from './app.js';
import { config } from './config/index.js';
import { logger } from './common/logging/logger.js';
import { connectPrisma, disconnectPrisma } from './database/prisma.js';
import { connectRedis, disconnectRedis } from './cache/redis.js';
import { initFirebaseAdmin } from './integrations/firebase/admin.js';
import { initSocketServer, closeSocketServer } from './websocket/socket.js';

let isShuttingDown = false;

async function bootstrap() {
  logger.info({ environment: config.env, port: config.port }, 'Starting MedFlow Command API Server...');

  // 1. Initialize Firebase Admin SDK
  initFirebaseAdmin();

  // 2. Connect to Redis (Graceful: does not prevent API startup if offline in local dev)
  await connectRedis();

  // 3. Connect to PostgreSQL via Prisma
  try {
    await connectPrisma();
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      'PostgreSQL connection could not be established on bootstrap. Running in degraded state (live credentials pending).'
    );
  }

  // 4. Create HTTP Server
  const httpServer = http.createServer(app);

  // 5. Initialize Socket.IO Server
  initSocketServer(httpServer);

  // 6. Start Listening
  httpServer.listen(config.port, () => {
    logger.info(`🚀 MedFlow API & Socket.IO server running on port ${config.port} (${config.env})`);
    logger.info(`   - Health probe: http://localhost:${config.port}/health`);
    logger.info(`   - Readiness probe: http://localhost:${config.port}/ready`);
    logger.info(`   - API v1 prefix: http://localhost:${config.port}${config.apiPrefix}`);
  });

  // 7. Graceful Shutdown Handlers
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, `Received ${signal}. Initiating graceful shutdown...`);

    // Safety timeout: force exit if cleanup hangs
    const forceExitTimer = setTimeout(() => {
      logger.error('Forced shutdown: cleanup timed out after 10 seconds. Exiting.');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      // Step 1: Stop accepting new HTTP requests
      await new Promise<void>((resolve) => {
        httpServer.close((err) => {
          if (err) {
            logger.error({ err }, 'Error closing HTTP server');
          } else {
            logger.info('HTTP server stopped accepting new connections');
          }
          resolve();
        });
      });

      // Step 2: Close Socket.IO connections
      await closeSocketServer();

      // Step 3: Disconnect Redis
      await disconnectRedis();

      // Step 4: Disconnect Prisma
      await disconnectPrisma();

      logger.info('Graceful shutdown completed successfully. Clean exit.');
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during graceful shutdown');
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise Rejection caught at process level');
  });

  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Uncaught Exception caught at process level');
    gracefulShutdown('uncaughtException');
  });
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Fatal error during server bootstrap');
  process.exit(1);
});
