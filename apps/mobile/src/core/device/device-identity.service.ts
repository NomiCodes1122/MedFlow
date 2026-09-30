import { randomUUID } from 'node:crypto';
import { SecureStoreService } from '../api/secure-store.js';
import { ISqliteDatabase } from '../database/database.interface.js';

export class DeviceIdentityService {
  private static cachedDeviceId: string | null = null;
  private static readonly DEVICE_ID_KEY = 'medflow_device_id';

  /**
   * Retrieves or provisions an immutable, persistent device installation identifier (UUIDv4).
   * Persists to both SecureStore and SQLite sync_metadata to guarantee retention across app restarts.
   */
  static async getDeviceId(db?: ISqliteDatabase): Promise<string> {
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    // 1. Check SecureStore
    const secureId = await SecureStoreService.getItem(this.DEVICE_ID_KEY);
    if (secureId) {
      this.cachedDeviceId = secureId;
      return secureId;
    }

    // 2. Fallback to SQLite sync_metadata
    if (db) {
      try {
        const row = await db.getFirstAsync<{ value: string }>(
          'SELECT value FROM sync_metadata WHERE key = ?',
          [this.DEVICE_ID_KEY]
        );
        if (row?.value) {
          this.cachedDeviceId = row.value;
          await SecureStoreService.setItem(this.DEVICE_ID_KEY, row.value);
          return row.value;
        }
      } catch {
        // Table may not yet be initialized
      }
    }

    // 3. Provision new unique device ID
    const newId = randomUUID();
    this.cachedDeviceId = newId;

    await SecureStoreService.setItem(this.DEVICE_ID_KEY, newId);

    if (db) {
      try {
        await db.runAsync(
          'INSERT OR REPLACE INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)',
          [this.DEVICE_ID_KEY, newId, Date.now()]
        );
      } catch {
        // Ignore if DB not ready
      }
    }

    return newId;
  }

  /**
   * Overrides cached device ID (primarily for tests or controlled provisioning).
   */
  static setDeviceId(id: string): void {
    this.cachedDeviceId = id;
  }

  /**
   * Clears in-memory cache to verify persistence layer loading.
   */
  static clearCache(): void {
    this.cachedDeviceId = null;
  }
}
