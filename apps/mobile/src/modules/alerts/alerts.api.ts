import { SecureStoreService } from '../../core/api/secure-store.js';
import { OutboxRepository } from '../../core/database/repositories/outbox.repository.js';
import { NodeSqliteAdapter } from '../../core/database/sqlite.adapter.js';

export interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

export interface NotificationDelivery {
  id: string;
  status: string;
  notification: {
    id: string;
    title: string;
    body: string;
    priority: string;
    category: string;
    alertId?: string;
  };
  createdAt: string;
}

const getBaseUrl = () => 'http://localhost:3000';

export class AlertsApi {
  static async fetchAlerts(limit = 20, offset = 0): Promise<Alert[]> {
    const token = await SecureStoreService.getAccessToken();
    const res = await fetch(`${getBaseUrl()}/api/v1/alerts?limit=${limit}&offset=${offset}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const json = await res.json();
    return json.data;
  }

  static async fetchNotifications(limit = 20, offset = 0): Promise<NotificationDelivery[]> {
    const token = await SecureStoreService.getAccessToken();
    const res = await fetch(`${getBaseUrl()}/api/v1/notifications?limit=${limit}&offset=${offset}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const json = await res.json();
    return json.data;
  }

  static async queueAlertStatusUpdate(db: NodeSqliteAdapter, alertId: string, status: string): Promise<void> {
    const repo = new OutboxRepository(db);
    await repo.enqueue({
      operation_id: Date.now().toString(),
      client_id: 'mobile-client',
      entity_type: 'ALERT',
      entity_id: alertId,
      operation_type: 'UPDATE',
      payload: JSON.stringify({ status }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: Date.now(),
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }

  static async queueNotificationRead(db: NodeSqliteAdapter, deliveryId: string): Promise<void> {
    const repo = new OutboxRepository(db);
    await repo.enqueue({
      operation_id: Date.now().toString(),
      client_id: 'mobile-client',
      entity_type: 'NOTIFICATION',
      entity_id: deliveryId,
      operation_type: 'UPDATE',
      payload: JSON.stringify({ read: true }),
      base_version: null,
      sync_status: 'PENDING',
      client_timestamp: Date.now(),
      server_timestamp: null,
      retry_count: 0,
      max_retries: 5,
      last_error_message: null,
      last_error_code: null,
      next_retry_at: null,
      conflict_details: null,
      last_attempt_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }
}
