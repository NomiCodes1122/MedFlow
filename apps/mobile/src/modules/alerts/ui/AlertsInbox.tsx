import React, { useEffect, useState } from 'react';
import { AlertsApi, Alert, NotificationDelivery } from '../alerts.api.js';
import { NodeSqliteAdapter } from '../../../core/database/sqlite.adapter.js';

interface AlertsInboxProps {
  db: NodeSqliteAdapter;
  isOnline: boolean;
}

export const AlertsInbox: React.FC<AlertsInboxProps> = ({ db, isOnline }) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<NotificationDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [isOnline]);

  const loadData = async () => {
    try {
      setLoading(true);
      // In online mode, we fetch from server
      if (isOnline) {
        const [fetchedAlerts, fetchedNotifs] = await Promise.all([
          AlertsApi.fetchAlerts(20),
          AlertsApi.fetchNotifications(20)
        ]);
        setAlerts(fetchedAlerts);
        setNotifications(fetchedNotifs);
      }
      // If offline, we would ideally load from a local SQLite repository.
      // But for this phase, we simply show cached state or what was fetched.
    } catch (e) {
      console.error('Failed to load inbox data', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    // Queue offline action through sync outbox
    await AlertsApi.queueAlertStatusUpdate(db, alertId, 'ACKNOWLEDGED');
    // Optimistic update
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'ACKNOWLEDGED' } : a));
  };

  const handleResolveAlert = async (alertId: string) => {
    // Queue offline action through sync outbox
    await AlertsApi.queueAlertStatusUpdate(db, alertId, 'RESOLVED');
    // Optimistic update
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'RESOLVED' } : a));
  };

  const handleMarkRead = async (notificationId: string) => {
    await AlertsApi.queueNotificationRead(db, notificationId);
    setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, status: 'READ' } : n));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="alerts-inbox">
      <h2>Notifications Inbox</h2>
      <div className="notifications-list">
        {notifications.map(n => (
          <div key={n.id} className={`notification ${n.status === 'READ' ? 'read' : 'unread'}`}>
            <h4>{n.notification.title} - {n.notification.priority}</h4>
            <p>{n.notification.body}</p>
            <span>{new Date(n.createdAt).toLocaleString()}</span>
            {n.status !== 'READ' && (
              <button onClick={() => handleMarkRead(n.id)}>Mark Read</button>
            )}
          </div>
        ))}
        {notifications.length === 0 && <p>No notifications.</p>}
      </div>

      <h2>System Alerts</h2>
      <div className="alerts-list">
        {alerts.map(a => (
          <div key={a.id} className={`alert ${a.severity.toLowerCase()} ${a.status.toLowerCase()}`}>
            <h4>[{a.severity}] {a.title}</h4>
            <p>{a.description}</p>
            <p>Status: {a.status}</p>
            <span>{new Date(a.createdAt).toLocaleString()}</span>
            <div className="actions">
              {a.status === 'OPEN' && (
                <button onClick={() => handleAcknowledgeAlert(a.id)}>Acknowledge</button>
              )}
              {(a.status === 'OPEN' || a.status === 'ACKNOWLEDGED') && (
                <button onClick={() => handleResolveAlert(a.id)}>Resolve</button>
              )}
            </div>
          </div>
        ))}
        {alerts.length === 0 && <p>No open alerts.</p>}
      </div>
    </div>
  );
};
