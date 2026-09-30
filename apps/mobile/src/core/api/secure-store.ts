import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ISecureStoreAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/**
 * In-memory adapter for isolated test execution.
 */
export class MemorySecureStoreAdapter implements ISecureStoreAdapter {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Persistent filesystem-backed secure storage adapter for local Node.js / testing / desktop environments.
 * Simulates OS secure enclave persistence across application process restarts.
 */
export class FileSecureStoreAdapter implements ISecureStoreAdapter {
  private filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath || path.resolve(process.cwd(), '.medflow_secure_store.json');
  }

  private readStore(): Record<string, string> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // Return empty store on corrupted file or read error
    }
    return {};
  }

  private writeStore(data: Record<string, string>): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Restricted file permissions (owner read/write only)
      });
    } catch {
      // Ignore write errors
    }
  }

  async getItem(key: string): Promise<string | null> {
    const store = this.readStore();
    return store[key] ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    const store = this.readStore();
    store[key] = value;
    this.writeStore(store);
  }

  async deleteItem(key: string): Promise<void> {
    const store = this.readStore();
    delete store[key];
    this.writeStore(store);
  }

  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Expo SecureStore adapter for native React Native iOS and Android runtime.
 * Backed by iOS Keychain and Android Keystore.
 */
export class ExpoSecureStoreAdapter implements ISecureStoreAdapter {
  private nativeStore: any;

  constructor(nativeModule?: any) {
    this.nativeStore = nativeModule;
  }

  async getItem(key: string): Promise<string | null> {
    if (this.nativeStore && typeof this.nativeStore.getItemAsync === 'function') {
      return await this.nativeStore.getItemAsync(key);
    }
    return null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.nativeStore && typeof this.nativeStore.setItemAsync === 'function') {
      await this.nativeStore.setItemAsync(key, value);
    }
  }

  async deleteItem(key: string): Promise<void> {
    if (this.nativeStore && typeof this.nativeStore.deleteItemAsync === 'function') {
      await this.nativeStore.deleteItemAsync(key);
    }
  }
}

/**
 * SecureStoreService
 * Encapsulates token persistence in device secure enclave / Expo SecureStore.
 * In accordance with Section 20, tokens are NEVER stored in SQLite.
 */
export class SecureStoreService {
  private static adapter: ISecureStoreAdapter = new MemorySecureStoreAdapter();

  static setAdapter(adapter: ISecureStoreAdapter): void {
    this.adapter = adapter;
  }

  static getAdapter(): ISecureStoreAdapter {
    return this.adapter;
  }

  static async getItem(key: string): Promise<string | null> {
    return await this.adapter.getItem(key);
  }

  static async setItem(key: string, value: string): Promise<void> {
    await this.adapter.setItem(key, value);
  }

  static async deleteItem(key: string): Promise<void> {
    await this.adapter.deleteItem(key);
  }

  static async getAccessToken(): Promise<string | null> {
    return await this.getItem('medflow_access_token');
  }

  static async setAccessToken(token: string): Promise<void> {
    await this.setItem('medflow_access_token', token);
  }

  static async getRefreshToken(): Promise<string | null> {
    return await this.getItem('medflow_refresh_token');
  }

  static async setRefreshToken(token: string): Promise<void> {
    await this.setItem('medflow_refresh_token', token);
  }

  static async clearTokens(): Promise<void> {
    await this.deleteItem('medflow_access_token');
    await this.deleteItem('medflow_refresh_token');
  }
}
