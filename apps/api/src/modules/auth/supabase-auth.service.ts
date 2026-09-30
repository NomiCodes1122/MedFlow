import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../../common/errors/ApiError.js';
import { logger } from '../../common/logging/logger.js';
import { SupabaseVerifiedUser } from './auth.types.js';
import { env } from '../../config/index.js';

export type SupabaseIdTokenVerifier = (idToken: string) => Promise<SupabaseVerifiedUser>;

let customVerifier: SupabaseIdTokenVerifier | null = null;

// Initialize a supabase client just for JWT verification
// We only need URL and Anon Key. We will use `getUser(token)`.
let supabaseClient: any = null;

export class SupabaseAuthService {
  /**
   * For automated testing: override the verifier with a mock implementation.
   */
  static setCustomVerifier(verifier: SupabaseIdTokenVerifier | null): void {
    customVerifier = verifier;
  }

  /**
   * Cryptographically verifies a Supabase access token.
   * Derives verified Supabase UID and phone number.
   * Rejects expired, invalid, or forged tokens.
   */
  static async verifyIdToken(idToken: string): Promise<SupabaseVerifiedUser> {
    if (!idToken || typeof idToken !== 'string' || idToken.trim().length === 0) {
      throw ApiError.authInvalidToken('Supabase JWT token is required');
    }

    if (customVerifier) {
      return customVerifier(idToken);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      logger.error('Supabase Auth requested but SUPABASE_URL or SUPABASE_ANON_KEY is not configured');
      throw ApiError.serviceUnavailable(
        'Authentication provider is temporarily unavailable. Live Supabase configuration pending.'
      );
    }

    if (!supabaseClient) {
      supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        }
      });
    }

    try {
      const { data, error } = await supabaseClient.auth.getUser(idToken);

      if (error || !data.user) {
        if (error?.message?.includes('expired')) {
          throw ApiError.authTokenExpired('Supabase JWT token has expired');
        }
        throw ApiError.authInvalidToken('Invalid Supabase JWT token format or signature');
      }

      return {
        uid: data.user.id,
        phone: data.user.phone,
      };
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      logger.warn({ errorMessage: error?.message }, 'Supabase token verification failed');
      throw ApiError.authInvalidToken('Failed to verify authentication token');
    }
  }
}
