import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  SecureStoreService,
  FileSecureStoreAdapter,
  MemorySecureStoreAdapter,
} from './secure-store.js';

describe('Persistent Secure Token Storage', () => {
  let tempStorePath: string;

  beforeEach(() => {
    tempStorePath = path.join(os.tmpdir(), `medflow_test_secure_store_${Date.now()}.json`);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempStorePath)) {
        fs.unlinkSync(tempStorePath);
      }
    } catch {
      // Ignore cleanup error
    }
  });

  it('should persist tokens across process restarts using FileSecureStoreAdapter', async () => {
    // 1. First process lifecycle instance
    const adapter1 = new FileSecureStoreAdapter(tempStorePath);
    SecureStoreService.setAdapter(adapter1);

    await SecureStoreService.setAccessToken('access-token-instance-1');
    await SecureStoreService.setRefreshToken('refresh-token-instance-1');

    expect(await SecureStoreService.getAccessToken()).toBe('access-token-instance-1');
    expect(await SecureStoreService.getRefreshToken()).toBe('refresh-token-instance-1');

    // 2. Simulate complete process termination: create brand new adapter pointing to same persistent file
    const restartedAdapter = new FileSecureStoreAdapter(tempStorePath);
    SecureStoreService.setAdapter(restartedAdapter);

    // Verify tokens survived!
    expect(await SecureStoreService.getAccessToken()).toBe('access-token-instance-1');
    expect(await SecureStoreService.getRefreshToken()).toBe('refresh-token-instance-1');

    // 3. Clear tokens
    await SecureStoreService.clearTokens();
    expect(await SecureStoreService.getAccessToken()).toBeNull();
    expect(await SecureStoreService.getRefreshToken()).toBeNull();

    // Verify file updated
    const finalAdapter = new FileSecureStoreAdapter(tempStorePath);
    SecureStoreService.setAdapter(finalAdapter);
    expect(await SecureStoreService.getAccessToken()).toBeNull();
  });

  it('should support isolated fast execution with MemorySecureStoreAdapter', async () => {
    const memAdapter = new MemorySecureStoreAdapter();
    SecureStoreService.setAdapter(memAdapter);

    await SecureStoreService.setAccessToken('mem-token');
    expect(await SecureStoreService.getAccessToken()).toBe('mem-token');

    await SecureStoreService.clearTokens();
    expect(await SecureStoreService.getAccessToken()).toBeNull();
  });
});
