import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from root or apps/api .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config(); // fallback to default location

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173,http://localhost:19006')
    .transform((val) => val.split(',').map((origin) => origin.trim()).filter(Boolean)),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .default('postgresql://postgres:postgres@localhost:5432/medflow_dev?schema=public&pgbouncer=true'),
  DIRECT_URL: z
    .string()
    .optional()
    .default('postgresql://postgres:postgres@localhost:5432/medflow_dev?schema=public'),

  // Redis
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .default('redis://localhost:6379'),

  // Firebase Admin (Optional in dev, required in prod when auth/notifications active)
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),

  // Secrets for future auth phases
  JWT_ACCESS_SECRET: z.string().optional().default(''),
  JWT_REFRESH_SECRET: z.string().optional().default(''),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const errorDetails = error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    console.error(`❌ FATAL: Environment validation failed:\n${errorDetails}`);
  } else {
    console.error('❌ FATAL: Failed to parse environment variables:', error);
  }
  process.exit(1);
}

export const env = parsedEnv;
