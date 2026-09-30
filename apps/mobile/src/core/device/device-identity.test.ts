import { describe, it, expect, beforeEach } from 'vitest';
import { DeviceIdentityService } from './device-identity.service.js';
import { SecureStoreService } from '../api/secure-store.js';
import { NodeSqliteAdapter } from '../database/sqlite.adapter.js';
import { runMigrations } from '../database/migrations/index.js';

describe('Persistent Unique Device Identification', () => {
  let db: NodeSqliteAdapter;

  beforeEach(async () => {
    DeviceIdentityService.clearCache();
    await SecureStoreService.clearTokens();
    await SecureStoreService.deleteItem('medflow_device_id');

    db = new NodeSqliteAdapter(':memory:');
    await runMigrations(db);
  });

  it('should provision a valid UUIDv4 on first run and persist it across cache clearing', async () => {
    const deviceId1 = await DeviceIdentityService.getDeviceId(db);
    expect(deviceId1).toBeDefined();
    // Validate UUID format
    expect(deviceId1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // Verify stored in SecureStore
    const storedInSecure = await SecureStoreService.getItem('medflow_device_id');
    expect(storedInSecure).toBe(deviceId1);

    // Verify stored in SQLite sync_metadata
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_metadata WHERE key = ?',
      ['medflow_device_id']
    );
    expect(row?.value).toBe(deviceId1);

    // Simulate process memory reset (cache cleared)
    DeviceIdentityService.clearCache();

    // Second call should return the exact same UUID!
    const deviceId2 = await DeviceIdentityService.getDeviceId(db);
    expect(deviceId2).toBe(deviceId1);
  });

  it('should recover device ID from SQLite if SecureStore was cleared', async () => {
    const originalId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await db.runAsync(
      'INSERT INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)',
      ['medflow_device_id', originalId, Date.now()]
    );

    DeviceIdentityService.clearCache();
    await SecureStoreService.deleteItem('medflow_device_id');

    const recoveredId = await DeviceIdentityService.getDeviceId(db);
    expect(recoveredId).toBe(originalId);
    expect(await SecureStoreService.getItem('medflow_device_id')).toBe(originalId);
  });
});
