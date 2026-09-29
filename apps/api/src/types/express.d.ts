import 'express';

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlation ID for tracing requests across logs and responses.
       */
      id: string;
      /**
       * Request start time for latency calculation.
       */
      startTime?: number;
    }
  }
}

export {};
