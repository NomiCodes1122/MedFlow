import { env, EnvConfig } from './env.js';

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  apiPrefix: env.API_PREFIX,
  corsOrigins: env.CORS_ORIGINS,
  logLevel: env.LOG_LEVEL,
  database: {
    url: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    // Safely unescape newlines from env strings
    privateKey: env.FIREBASE_PRIVATE_KEY
      ? env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : '',
    isConfigured: Boolean(
      env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY
    ),
  },
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
  },
} as const;

export type AppConfig = typeof config;
export { env, type EnvConfig };
