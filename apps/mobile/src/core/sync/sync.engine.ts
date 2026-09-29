import { OutboxRepository } from '../database/repositories/outbox.repository.js';
import { PatientLocalRepository } from '../database/repositories/patient.repository.js';
import { VitalsLocalRepository } from '../database/repositories/vitals.repository.js';
import { SyncApiClient } from '../api/api.client.js';
import { SyncWorker, SyncCycleResult } from './sync.worker.js';
import { ConnectivityManager } from './sync.connectivity.js';
import { useSyncStore } from './sync.store.js';

export class SyncEngine {
  private worker: SyncWorker;
  private activePromise: Promise<SyncCycleResult> | null = null;
  private cleanupConnectivity?: () => void;

  constructor(
    private outboxRepo: OutboxRepository,
    private patientRepo: PatientLocalRepository,
    private vitalsRepo: VitalsLocalRepository,
    private apiClient: SyncApiClient
  ) {
    this.worker = new SyncWorker(
      this.outboxRepo,
      this.patientRepo,
      this.vitalsRepo,
      this.apiClient
    );
  }

  /**
   * Initializes the synchronization engine:
   * 1. Recovers any operations stuck in SYNCING state from a previous app crash/restart.
   * 2. Synchronizes pending counts with the Zustand store.
   * 3. Sets up connectivity event triggers.
   */
  async initialize(): Promise<void> {
    // 1. Crash/restart recovery: Reset abandoned SYNCING operations back to PENDING
    await this.outboxRepo.recoverStuckSyncing();

    // 2. Refresh UI store counts
    await this.refreshCounts();

    // 3. Listen for network restoration
    this.cleanupConnectivity = ConnectivityManager.addListener((isOnline) => {
      useSyncStore.getState().setOnline(isOnline);
      if (isOnline) {
        this.syncNow().catch(() => {});
      }
    });

    useSyncStore.getState().setOnline(ConnectivityManager.isOnline());
  }

  /**
   * Executes a full synchronization run.
   * If a sync operation is already in flight, callers share the active promise,
   * completely preventing concurrent worker executions.
   */
  async syncNow(): Promise<SyncCycleResult> {
    if (!ConnectivityManager.isOnline()) {
      useSyncStore.getState().setSyncState('PAUSED');
      return { processedCount: 0, appliedCount: 0, conflictCount: 0, failedCount: 0 };
    }

    if (this.activePromise) {
      return this.activePromise;
    }

    this.activePromise = this.runSyncLoop();
    try {
      return await this.activePromise;
    } finally {
      this.activePromise = null;
    }
  }

  private async runSyncLoop(): Promise<SyncCycleResult> {
    useSyncStore.getState().setSyncState('SYNCING');

    const totalSummary: SyncCycleResult = {
      processedCount: 0,
      appliedCount: 0,
      conflictCount: 0,
      failedCount: 0,
    };

    try {
      // Drain outbox in batches until empty or no more eligible records
      let hasMore = true;
      while (hasMore) {
        const result = await this.worker.processBatch();
        totalSummary.processedCount += result.processedCount;
        totalSummary.appliedCount += result.appliedCount;
        totalSummary.conflictCount += result.conflictCount;
        totalSummary.failedCount += result.failedCount;

        if (result.processedCount === 0) {
          hasMore = false;
        }
      }

      useSyncStore.getState().setLastSyncedAt(new Date());
      useSyncStore.getState().setSyncState('IDLE');
      return totalSummary;
    } catch (error) {
      useSyncStore.getState().setSyncState('ERROR');
      throw error;
    } finally {
      await this.refreshCounts();
    }
  }

  async refreshCounts(): Promise<void> {
    const pending = await this.outboxRepo.getPendingCount();
    const conflicts = await this.outboxRepo.getConflictCount();
    useSyncStore.getState().setCounts(pending, conflicts);
  }

  destroy(): void {
    if (this.cleanupConnectivity) {
      this.cleanupConnectivity();
    }
  }
}
