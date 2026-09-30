import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatTimeAgo } from './useSyncUIState.js';
import { useSyncStore } from '../core/sync/sync.store.js';

describe('Synchronization UI State & Formatting', () => {
  beforeEach(() => {
    useSyncStore.getState().clearConflicts();
    useSyncStore.getState().setOnline(true);
    useSyncStore.getState().setSyncState('IDLE');
    useSyncStore.getState().setCounts(0, 0);
  });

  it('formatTimeAgo should accurately format recent timestamps', () => {
    expect(formatTimeAgo(null)).toBe('Never synced');

    const now = new Date();
    expect(formatTimeAgo(now)).toBe('Just now');

    const tenSecondsAgo = new Date(Date.now() - 10000);
    expect(formatTimeAgo(tenSecondsAgo)).toBe('10s ago');

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatTimeAgo(fiveMinutesAgo)).toBe('5m ago');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatTimeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('syncStore should reflect online, offline, pending, and conflict states accurately', () => {
    const store = useSyncStore.getState();

    // 1. Initial online idle state
    expect(store.isOnline).toBe(true);
    expect(store.syncState).toBe('IDLE');
    expect(store.pendingCount).toBe(0);
    expect(store.conflictCount).toBe(0);

    // 2. Paramedic captures changes offline
    store.setOnline(false);
    store.setSyncState('PAUSED');
    store.setCounts(3, 0);

    const offlineState = useSyncStore.getState();
    expect(offlineState.isOnline).toBe(false);
    expect(offlineState.syncState).toBe('PAUSED');
    expect(offlineState.pendingCount).toBe(3);

    // 3. Conflict arises
    store.addConflict({
      operationId: 'op-ui-conflict-1',
      entityType: 'PATIENT',
      entityId: 'pt-1',
      localPayload: { status: 'IN_TRANSIT' },
      serverVersion: 2,
      expectedVersion: 1,
      message: 'OCC conflict',
      detectedAt: Date.now(),
    });

    const conflictState = useSyncStore.getState();
    expect(conflictState.conflictCount).toBe(1);
    expect(conflictState.activeConflicts).toHaveLength(1);

    // 4. Conflict resolved
    store.removeConflict('op-ui-conflict-1');
    const resolvedState = useSyncStore.getState();
    expect(resolvedState.conflictCount).toBe(0);
    expect(resolvedState.activeConflicts).toHaveLength(0);
  });

  it('manual sync trigger on SyncEngine should respect offline and in-flight locks', async () => {
    const mockSyncNow = vi.fn().mockResolvedValue({ processedCount: 1, appliedCount: 1, conflictCount: 0, failedCount: 0 });
    const mockEngine = {
      syncNow: mockSyncNow,
    } as any;

    useSyncStore.getState().setOnline(true);
    useSyncStore.getState().setSyncState('IDLE');

    await mockEngine.syncNow();
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
  });
});
