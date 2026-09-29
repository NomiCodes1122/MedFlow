import { SYNC_CONSTANTS } from './sync.constants.js';
import { ErrorCategory } from './sync.types.js';

export class SyncRetryPolicy {
  /**
   * Classifies an HTTP or network error into an actionable sync error category.
   */
  static classifyError(httpStatus?: number, errorCode?: string): ErrorCategory {
    if (httpStatus === 401 || errorCode === 'AUTH_EXPIRED' || errorCode === 'AUTH_REQUIRED') {
      return 'AUTHENTICATION';
    }
    if (httpStatus === 403 || errorCode === 'AUTH_ROLE_REQUIRED' || errorCode === 'FORBIDDEN') {
      return 'AUTHORIZATION';
    }
    if (httpStatus === 409 || errorCode === 'CONFLICT') {
      return 'CONFLICT';
    }
    if (httpStatus === 400 || errorCode === 'VALIDATION_ERROR') {
      return 'VALIDATION';
    }
    if (
      !httpStatus ||
      httpStatus >= 500 ||
      httpStatus === 408 ||
      httpStatus === 429 ||
      errorCode === 'NETWORK_ERROR' ||
      errorCode === 'TIMEOUT'
    ) {
      return 'RETRYABLE';
    }
    return 'NON_RETRYABLE';
  }

  /**
   * Calculates exponential backoff with jitter:
   * T_wait = min(T_max, T_base * 2^retryCount) + jitter
   */
  static calculateBackoff(retryCount: number): number {
    const exponentialDelay = SYNC_CONSTANTS.BASE_DELAY_MS * Math.pow(2, retryCount);
    const cappedDelay = Math.min(SYNC_CONSTANTS.MAX_DELAY_MS, exponentialDelay);
    const jitter = Math.floor(Math.random() * SYNC_CONSTANTS.JITTER_MAX_MS);
    return cappedDelay + jitter;
  }
}
