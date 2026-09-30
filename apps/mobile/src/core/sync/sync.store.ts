import { createStore } from 'zustand/vanilla';
import { ConflictReport, SyncEngineState } from './sync.types.js';

export interface SyncStoreState {
  isOnline: boolean;
  syncState: SyncEngineState;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: Date | null;
  activeConflicts: ConflictReport[];

  // Actions
  setOnline: (isOnline: boolean) => void;
  setSyncState: (state: SyncEngineState) => void;
  setCounts: (pending: number, conflicts: number) => void;
  setLastSyncedAt: (date: Date) => void;
  addConflict: (conflict: ConflictReport) => void;
  removeConflict: (operationId: string) => void;
  clearConflicts: () => void;
}

export const syncStore = createStore<SyncStoreState>((set) => ({
  isOnline: true,
  syncState: 'IDLE',
  pendingCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
  activeConflicts: [],

  setOnline: (isOnline) => set({ isOnline }),
  setSyncState: (syncState) => set({ syncState }),
  setCounts: (pendingCount, conflictCount) => set({ pendingCount, conflictCount }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  addConflict: (conflict) =>
    set((state) => {
      // Avoid duplicate conflict reports for same operationId
      const existingFiltered = state.activeConflicts.filter((c) => c.operationId !== conflict.operationId);
      return {
        activeConflicts: [conflict, ...existingFiltered],
        conflictCount: existingFiltered.length + 1,
      };
    }),
  removeConflict: (operationId) =>
    set((state) => {
      const filtered = state.activeConflicts.filter((c) => c.operationId !== operationId);
      return {
        activeConflicts: filtered,
        conflictCount: filtered.length,
      };
    }),
  clearConflicts: () => set({ activeConflicts: [], conflictCount: 0 }),
}));

export const useSyncStore = syncStore;
