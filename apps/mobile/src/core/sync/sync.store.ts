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
    set((state) => ({
      activeConflicts: [conflict, ...state.activeConflicts],
      conflictCount: state.conflictCount + 1,
    })),
  clearConflicts: () => set({ activeConflicts: [], conflictCount: 0 }),
}));

export const useSyncStore = syncStore;
