import React, { useState, useEffect } from 'react';
import { MobilePatientService } from '../modules/patients/patient.service.js';
import { useSyncStore } from '../core/sync/sync.store.js';
import { ConflictReport, ConflictResolutionStrategy } from '../core/sync/sync.types.js';

export interface ConflictResolutionModalProps {
  patientService: MobilePatientService;
  onClose?: () => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  patientService,
  onClose,
}) => {
  const [activeConflicts, setActiveConflicts] = useState<ConflictReport[]>(
    useSyncStore.getState().activeConflicts
  );
  const [resolvingOpId, setResolvingOpId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = useSyncStore.subscribe((state) => {
      setActiveConflicts(state.activeConflicts);
    });
    return () => unsubscribe();
  }, []);

  if (activeConflicts.length === 0) {
    return null;
  }

  const handleResolve = async (
    conflict: ConflictReport,
    strategy: ConflictResolutionStrategy,
    mergedFields?: Record<string, any>
  ) => {
    try {
      setResolvingOpId(conflict.operationId);
      setErrorMessage(null);
      await patientService.resolvePatientConflict(conflict.operationId, strategy, mergedFields);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve conflict');
    } finally {
      setResolvingOpId(null);
    }
  };

  return (
    <div
      id="conflict-resolution-modal"
      data-testid="conflict-resolution-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          color: '#F8FAFC',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflowY: 'auto',
          border: '1px solid #334155',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 id="conflict-modal-title" style={{ margin: 0, fontSize: '18px', color: '#F8FAFC' }}>
            ⚠️ Concurrency Conflicts Detected ({activeConflicts.length})
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close conflict modal"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94A3B8',
                fontSize: '20px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <p style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '20px' }}>
          Another clinician updated the server while this device was offline. Review the conflicting fields below and select a resolution strategy.
        </p>

        {errorMessage && (
          <div
            data-testid="conflict-error-message"
            style={{
              padding: '10px 14px',
              backgroundColor: '#7F1D1D',
              color: '#FCA5A5',
              borderRadius: '6px',
              marginBottom: '16px',
              fontSize: '13px',
            }}
          >
            {errorMessage}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activeConflicts.map((conflict: ConflictReport) => {
            const serverState = conflict.serverState || {};
            const localPayload = conflict.localPayload || {};
            const isResolving = resolvingOpId === conflict.operationId;

            return (
              <div
                key={conflict.operationId}
                data-testid={`conflict-card-${conflict.operationId}`}
                style={{
                  backgroundColor: '#1E293B',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  padding: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: '#38BDF8' }}>
                    Entity: {conflict.entityType} ({conflict.entityId.substring(0, 8)}...)
                  </span>
                  <span style={{ fontSize: '12px', color: '#F59E0B', fontWeight: 500 }}>
                    Server Version {conflict.serverVersion} vs Expected {conflict.expectedVersion}
                  </span>
                </div>

                {/* Side-by-Side Comparison */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginBottom: '16px',
                    fontSize: '12px',
                  }}
                >
                  {/* Local Mutation */}
                  <div
                    data-testid="local-state-preview"
                    style={{
                      backgroundColor: '#0F172A',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#38BDF8', marginBottom: '6px' }}>
                      📱 Local Device Changes:
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#E2E8F0', fontSize: '11px' }}>
                      {JSON.stringify(localPayload, null, 2)}
                    </pre>
                  </div>

                  {/* Current Server State */}
                  <div
                    data-testid="server-state-preview"
                    style={{
                      backgroundColor: '#0F172A',
                      padding: '12px',
                      borderRadius: '6px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#34D399', marginBottom: '6px' }}>
                      ☁️ Server State:
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#E2E8F0', fontSize: '11px' }}>
                      {JSON.stringify(serverState, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Strategy Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    data-testid="accept-server-button"
                    disabled={isResolving}
                    onClick={() => handleResolve(conflict, 'ACCEPT_SERVER')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#334155',
                      color: '#F8FAFC',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Accept Server State
                  </button>

                  <button
                    type="button"
                    data-testid="keep-local-button"
                    disabled={isResolving}
                    onClick={() => handleResolve(conflict, 'KEEP_LOCAL')}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#2563EB',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Keep Local Changes
                  </button>

                  <button
                    type="button"
                    data-testid="merge-changes-button"
                    disabled={isResolving}
                    onClick={() => {
                      // Merges local changes on top of server state
                      const merged = { ...serverState, ...localPayload };
                      delete merged.id;
                      delete merged.version;
                      handleResolve(conflict, 'MANUAL_MERGE', merged);
                    }}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#059669',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: isResolving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Merge & Keep Both
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
