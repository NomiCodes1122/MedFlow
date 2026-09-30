import { useState, useEffect } from 'react';
import { useSyncStore } from '../core/sync/sync.store.js';
import { SyncEngine } from '../core/sync/sync.engine.js';
import { ConflictReport, SyncEngineState } from '../core/sync/sync.types.js';

export interface SyncUIState {
  isOnline: boolean;
  syncState: SyncEngineState;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: Date | null;
  formattedLastSync: string;
  activeConflicts: ConflictReport[];
  isSyncDisabled: boolean;
  statusBadgeColor: string;
  statusText: string;
  triggerSync: () => Promise<void>;
}

export function formatTimeAgo(date: Date | null): string {
  if (!date) return 'Never synced';
  const now = Date.now();
  const diffSeconds = Math.floor((now - date.getTime()) / 1000);

  if (diffSeconds < 10) return 'Just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function useSyncUIState(syncEngine?: SyncEngine): SyncUIState {
  const [storeState, setStoreState] = useState(useSyncStore.getState());
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = useSyncStore.subscribe((state) => {
      setStoreState(state);
    });
    return () => unsubscribe();
  }, []);

  const isSyncDisabled = !storeState.isOnline || storeState.syncState === 'SYNCING' || isManualSyncing;

  let statusBadgeColor = '#10B981'; // Green
  let statusText = 'Online';

  if (!storeState.isOnline) {
    statusBadgeColor = '#F59E0B'; // Amber
    statusText = 'Offline';
  } else if (storeState.syncState === 'SYNCING' || isManualSyncing) {
    statusBadgeColor = '#3B82F6'; // Blue
    statusText = 'Syncing...';
  } else if (storeState.syncState === 'ERROR') {
    statusBadgeColor = '#EF4444'; // Red
    statusText = 'Sync Error';
  }

  const triggerSync = async () => {
    if (isSyncDisabled || !syncEngine) return;
    try {
      setIsManualSyncing(true);
      await syncEngine.syncNow();
    } finally {
      setIsManualSyncing(false);
    }
  };

  return {
    isOnline: storeState.isOnline,
    syncState: storeState.syncState,
    pendingCount: storeState.pendingCount,
    conflictCount: storeState.conflictCount,
    lastSyncedAt: storeState.lastSyncedAt,
    formattedLastSync: formatTimeAgo(storeState.lastSyncedAt),
    activeConflicts: storeState.activeConflicts,
    isSyncDisabled,
    statusBadgeColor,
    statusText,
    triggerSync,
  };
}
