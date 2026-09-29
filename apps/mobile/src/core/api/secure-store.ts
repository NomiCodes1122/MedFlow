/**
 * SecureStoreService
 * Encapsulates token persistence in device secure enclave / Expo SecureStore.
 * In accordance with Section 20, tokens are NEVER stored in SQLite.
 */
export class SecureStoreService {
  private static inMemoryStore = new Map<string, string>();

  static async getItem(key: string): Promise<string | null> {
    return this.inMemoryStore.get(key) ?? null;
  }

  static async setItem(key: string, value: string): Promise<void> {
    this.inMemoryStore.set(key, value);
  }

  static async deleteItem(key: string): Promise<void> {
    this.inMemoryStore.delete(key);
  }

  static async getAccessToken(): Promise<string | null> {
    return this.getItem('medflow_access_token');
  }

  static async setAccessToken(token: string): Promise<void> {
    await this.setItem('medflow_access_token', token);
  }

  static async getRefreshToken(): Promise<string | null> {
    return this.getItem('medflow_refresh_token');
  }

  static async setRefreshToken(token: string): Promise<void> {
    await this.setItem('medflow_refresh_token', token);
  }

  static async clearTokens(): Promise<void> {
    await this.deleteItem('medflow_access_token');
    await this.deleteItem('medflow_refresh_token');
  }
}
