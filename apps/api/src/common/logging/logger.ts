import pino from 'pino';
import { config } from '../../config/index.js';

const isDev = config.isDevelopment;

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.otp',
      'req.body.refreshToken',
      'password',
      'token',
      'secret',
      'privateKey',
      'DATABASE_URL',
      'DIRECT_URL',
      'REDIS_URL',
      'FIREBASE_PRIVATE_KEY',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export type Logger = typeof logger;
