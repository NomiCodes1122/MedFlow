import React from 'react';
import { SyncEngine } from '../core/sync/sync.engine.js';
import { useSyncUIState } from './useSyncUIState.js';

export interface SyncStatusBarProps {
  syncEngine?: SyncEngine;
  onOpenConflicts?: () => void;
  className?: string;
}

export const SyncStatusBar: React.FC<SyncStatusBarProps> = ({
  syncEngine,
  onOpenConflicts,
}) => {
  const {
    isOnline,
    pendingCount,
    conflictCount,
    formattedLastSync,
    isSyncDisabled,
    statusBadgeColor,
    statusText,
    triggerSync,
  } = useSyncUIState(syncEngine);

  return (
    <header
      id="medflow-sync-status-bar"
      data-testid="sync-status-bar"
      role="region"
      aria-label="Synchronization Status"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: '#0F172A',
        color: '#F8FAFC',
        borderBottom: '1px solid #1E293B',
        fontSize: '13px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Left: Connectivity & Engine State */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span
          data-testid="connectivity-indicator"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: statusBadgeColor,
            boxShadow: `0 0 6px ${statusBadgeColor}`,
            display: 'inline-block',
          }}
          aria-hidden="true"
        />
        <span
          data-testid="sync-status-text"
          style={{ fontWeight: 600, letterSpacing: '0.02em' }}
        >
          {statusText}
        </span>

        {/* Pending Operations Badge */}
        <span
          data-testid="pending-count-badge"
          style={{
            marginLeft: '8px',
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: pendingCount > 0 ? '#1E293B' : '#141E33',
            color: pendingCount > 0 ? '#38BDF8' : '#64748B',
            fontWeight: 500,
            fontSize: '11px',
            border: '1px solid #334155',
          }}
        >
          {pendingCount} {pendingCount === 1 ? 'mutation pending' : 'mutations pending'}
        </span>

        {/* Conflicts Alert Pill */}
        {conflictCount > 0 && (
          <button
            type="button"
            data-testid="conflict-alert-badge"
            onClick={onOpenConflicts}
            style={{
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: '#7F1D1D',
              color: '#FCA5A5',
              fontWeight: 600,
              fontSize: '11px',
              border: '1px solid #B91C1C',
              animation: 'pulse 2s infinite',
            }}
          >
            ⚠️ {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
          </button>
        )}
      </div>

      {/* Right: Last Sync & Manual Sync Trigger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span
          data-testid="last-synced-text"
          style={{ color: '#94A3B8', fontSize: '12px' }}
        >
          {formattedLastSync}
        </span>

        <button
          type="button"
          id="sync-now-button"
          data-testid="sync-now-button"
          onClick={triggerSync}
          disabled={isSyncDisabled}
          aria-label="Trigger manual synchronization"
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isSyncDisabled ? '#334155' : '#2563EB',
            color: isSyncDisabled ? '#94A3B8' : '#FFFFFF',
            fontWeight: 600,
            fontSize: '12px',
            cursor: isSyncDisabled ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {!isOnline ? 'Offline' : isSyncDisabled ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>
    </header>
  );
};
