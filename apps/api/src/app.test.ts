import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { Router } from 'express';
import { z } from 'zod';
import { app, createApp } from './app.js';
import { validate } from './common/validation/validate.js';
import { ApiError } from './common/errors/ApiError.js';
import { ErrorCodes } from './common/errors/errorCodes.js';

describe('MedFlow Backend Foundation & Infrastructure Tests', () => {
  // --------------------------------------------------------------------------
  // 1. Health & Liveness Probe
  // --------------------------------------------------------------------------
  describe('GET /health (Liveness Probe)', () => {
    it('should return HTTP 200 with status ok and service identity', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toMatchObject({
        status: 'ok',
        service: 'medflow-api',
      });
      expect(res.body.data).toHaveProperty('timestamp');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Readiness Probe
  // --------------------------------------------------------------------------
  describe('GET /ready (Readiness Probe)', () => {
    it('should return dependency health breakdown structure', async () => {
      const res = await request(app).get('/ready');

      // In local dev without live database running, returns 503; with running DB returns 200.
      expect([200, 503]).toContain(res.status);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('dependencies');
      expect(res.body.data.dependencies).toHaveProperty('database');
      expect(res.body.data.dependencies).toHaveProperty('redis');
      expect(res.body.data.dependencies).toHaveProperty('firebase');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Request ID Middleware
  // --------------------------------------------------------------------------
  describe('Request ID & Correlation Tracking', () => {
    it('should generate an X-Request-ID header when omitted by the client', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      const requestId = res.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId.length).toBeGreaterThanOrEqual(16);
    });

    it('should preserve and echo back a valid incoming X-Request-ID header', async () => {
      const customId = 'test-correlation-id-12345';
      const res = await request(app)
        .get('/health')
        .set('X-Request-ID', customId);

      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  // --------------------------------------------------------------------------
  // 4. 404 Catch-All Handler
  // --------------------------------------------------------------------------
  describe('404 Route Not Found Handling', () => {
    it('should return HTTP 404 with structured error envelope for undefined endpoints', async () => {
      const res = await request(app).get('/api/v1/non-existent-endpoint');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: ErrorCodes.NOT_FOUND,
        },
      });
      expect(res.body.error.message).toContain('Route not found');
      expect(res.body.error).toHaveProperty('requestId');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Request Validation Middleware (Zod) & Error Handling Test Setup
  // --------------------------------------------------------------------------
  const testRouter = Router();

  const testSchema = z.object({
    callSign: z.string().min(3),
    latitude: z.number().min(-90).max(90),
  });

  testRouter.post(
    '/test-validation',
    validate({ body: testSchema }),
    (req, res) => {
      res.status(200).json({ success: true, data: req.body });
    }
  );

  testRouter.get('/test-api-error', () => {
    throw ApiError.conflict('Patient triage conflict detected');
  });

  testRouter.get('/test-uncaught-error', () => {
    throw new Error('Database connection string password leaked!');
  });

  const testApp = createApp(testRouter);

  describe('Validation Middleware (Zod)', () => {
    it('should reject malformed payloads with HTTP 400 and structured validation errors', async () => {
      const res = await request(testApp)
        .post('/test-validation')
        .send({ callSign: 'A', latitude: 150 }); // callSign too short, latitude out of bounds

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid request data',
        },
      });
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBe(2);
    });

    it('should accept valid payloads and execute downstream handler', async () => {
      const res = await request(testApp)
        .post('/test-validation')
        .send({ callSign: 'AMB-01', latitude: 37.7749 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ callSign: 'AMB-01', latitude: 37.7749 });
    });
  });

  // --------------------------------------------------------------------------
  // 6. Centralized Error Handling & Exception Sanitization
  // --------------------------------------------------------------------------
  describe('Centralized Error Handling', () => {
    it('should serialize ApiError correctly with code, message, and status', async () => {
      const res = await request(testApp).get('/test-api-error');

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: ErrorCodes.CONFLICT,
          message: 'Patient triage conflict detected',
        },
      });
      expect(res.body.error).toHaveProperty('requestId');
    });

    it('should sanitize uncaught errors to a safe generic 500 message without leaking details', async () => {
      const res = await request(testApp).get('/test-uncaught-error');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        success: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: 'An unexpected internal server error occurred',
        },
      });
      // Ensure raw error message / stack trace was NOT sent to client
      expect(res.body.error.message).not.toContain('password');
      expect(res.body.error).not.toHaveProperty('stack');
      expect(res.body.error).toHaveProperty('requestId');
    });
  });

  // --------------------------------------------------------------------------
  // 7. API Versioning (/api/v1)
  // --------------------------------------------------------------------------
  describe('API Versioning (GET /api/v1)', () => {
    it('should return API v1 service metadata', async () => {
      const res = await request(app).get('/api/v1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        name: 'MedFlow Disaster Response Command System API',
        version: 'v1',
      });
    });
  });
});
