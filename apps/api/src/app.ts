import express, { Express, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { requestIdMiddleware } from './common/http/requestId.js';
import { requestLogger } from './common/middleware/requestLogger.js';
import { notFoundHandler } from './common/middleware/notFound.js';
import { errorHandler } from './common/errors/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { apiV1Router } from './routes/index.js';

export function createApp(customRouter?: Router): Express {
  const app = express();

  // 1. Trust proxy for reverse proxies / load balancers
  app.set('trust proxy', 1);

  // 2. Request Correlation ID
  app.use(requestIdMiddleware);

  // 3. Structured Request Logger
  app.use(requestLogger);

  // 4. Security Headers (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 5. Configuration-driven CORS
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          return callback(null, true);
        }

        // In development, permit localhost ports dynamically
        if (config.isDevelopment && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID'],
    })
  );

  // 6. Body Parsers with conservative bounds
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 7. Health & Readiness Probes (Root level for orchestrators)
  app.use('/', healthRouter);

  // 8. API v1 Versioned Routes
  app.use(config.apiPrefix, apiV1Router);

  // Optional custom router for testing middleware & error pipelines
  if (customRouter) {
    app.use(customRouter);
  }

  // 9. 404 Catch-All Handler
  app.use(notFoundHandler);

  // 10. Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
