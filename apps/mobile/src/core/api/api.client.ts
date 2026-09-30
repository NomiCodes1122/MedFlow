import { SecureStoreService } from './secure-store.js';
import { SyncBatchResponse } from '../sync/sync.types.js';

export interface ApiClientConfig {
  baseUrl: string;
}

export class SyncApiClient {
  private baseUrl: string;

  constructor(config?: Partial<ApiClientConfig>) {
    this.baseUrl = config?.baseUrl || 'http://localhost:4000';
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Submits a batch of offline mutations to the backend.
   * Transparently handles access token expiration by executing token refresh flow.
   */
  async submitBatch(batch: any): Promise<SyncBatchResponse> {
    const accessToken = await SecureStoreService.getAccessToken();

    const response = await fetch(`${this.baseUrl}/api/v1/sync/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });

    if (response.status === 401) {
      // Access token expired - attempt session refresh
      const refreshed = await this.refreshSession();
      if (refreshed) {
        // Retry mutation batch with new token, preserving exact mutation IDs
        const newAccessToken = await SecureStoreService.getAccessToken();
        const retryResponse = await fetch(`${this.baseUrl}/api/v1/sync/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(newAccessToken ? { Authorization: `Bearer ${newAccessToken}` } : {}),
          },
          body: JSON.stringify(batch),
        });

        if (!retryResponse.ok) {
          const errorBody = await retryResponse.json().catch(() => ({}));
          throw new SyncApiError(
            retryResponse.status,
            errorBody.error?.code || 'HTTP_ERROR',
            errorBody.error?.message || 'Sync request failed after token refresh'
          );
        }

        const data = await retryResponse.json();
        return data.data as SyncBatchResponse;
      } else {
        throw new SyncApiError(401, 'AUTH_EXPIRED', 'Session expired. User must re-authenticate.');
      }
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new SyncApiError(
        response.status,
        errorBody.error?.code || 'HTTP_ERROR',
        errorBody.error?.message || 'Sync request failed'
      );
    }

    const json = await response.json();
    return json.data as SyncBatchResponse;
  }

  /**
   * Refreshes the access token using the stored refresh token.
   */
  private async refreshSession(): Promise<boolean> {
    try {
      const refreshToken = await SecureStoreService.getRefreshToken();
      if (!refreshToken) return false;

      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        return false;
      }

      const json = await response.json();
      if (json.success && json.data?.accessToken) {
        await SecureStoreService.setAccessToken(json.data.accessToken);
        if (json.data.refreshToken) {
          await SecureStoreService.setRefreshToken(json.data.refreshToken);
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export class SyncApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'SyncApiError';
  }
}
