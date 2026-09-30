import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SyncApiClient, SyncApiError } from '../../core/api/api.client.js';
import { SecureStoreService } from '../../core/api/secure-store.js';

export class AuthClient {
  private supabase: SupabaseClient;

  constructor(
    private apiClient: SyncApiClient,
    supabaseUrl: string,
    supabaseAnonKey: string
  ) {
    this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
  }

  /**
   * Requests an SMS OTP from Supabase Auth.
   */
  async requestOtp(phone: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOtp({ phone });
    if (error) {
      throw new Error(`Failed to request OTP: ${error.message}`);
    }
  }

  /**
   * Verifies the SMS OTP, obtains a Supabase JWT, and exchanges it for a MedFlow session.
   */
  async verifyOtpAndLogin(phone: string, token: string): Promise<void> {
    const { data, error } = await this.supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error || !data.session) {
      throw new Error(`OTP Verification failed: ${error?.message || 'No session returned'}`);
    }

    // Access base URL directly since they share the same backend
    const baseUrl = (this.apiClient as any).baseUrl;

    const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idToken: data.session.access_token }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new SyncApiError(
        response.status,
        err.error?.code || 'AUTH_FAILED',
        err.error?.message || 'MedFlow session establishment failed'
      );
    }

    const json = await response.json();
    if (json.success && json.data?.accessToken) {
      await SecureStoreService.setAccessToken(json.data.accessToken);
      if (json.data.refreshToken) {
        await SecureStoreService.setRefreshToken(json.data.refreshToken);
      }
    } else {
      throw new Error('Invalid authentication response from backend');
    }
  }

  async logout(): Promise<void> {
    await SecureStoreService.setAccessToken('');
    await SecureStoreService.setRefreshToken('');
  }
}
