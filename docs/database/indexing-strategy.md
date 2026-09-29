# MedFlow Database Indexing Strategy & Query Performance

This document justifies every database index in MedFlow based on specific, high-frequency operational query patterns across the mobile field clients, emergency room triage queues, and the web command center dashboard.

---

## 1. Master Index Strategy Matrix

| Table | Index Name | Columns | Type | Target Query / Access Pattern | Architectural Justification |
| :--- | :--- | :--- | :---: | :--- | :--- |
| `users` | `idx_users_firebase_uid` | `(firebase_uid)` | Unique B-Tree | `SELECT * FROM users WHERE firebase_uid = $1` | Immediate lookup during Firebase OTP session exchange (`POST /auth/session`). |
| `users` | `idx_users_phone` | `(phone)` | Unique B-Tree | `SELECT * FROM users WHERE phone = $1` | Enforces uniqueness of responder phone numbers across the system. |
| `users` | `idx_users_role_status` | `(role, status)` | B-Tree | `SELECT * FROM users WHERE role = $1 AND status = 'ACTIVE'` | Duty roster queries and role-targeted push notification routing. |
| `refresh_tokens` | `idx_refresh_tokens_hashed` | `(hashed_token)` | Unique B-Tree | `SELECT * FROM refresh_tokens WHERE hashed_token = $1` | Constant-time token rotation and compromise detection check. |
| `refresh_tokens` | `idx_refresh_tokens_user_id` | `(user_id)` | B-Tree | `SELECT * FROM refresh_tokens WHERE user_id = $1` | User session invalidation and active token enumeration. |
| `refresh_tokens` | `idx_refresh_tokens_device_id` | `(device_id)` | B-Tree | `SELECT * FROM refresh_tokens WHERE device_id = $1` | Device unregistration session cleanup and hardware session tracking. |
| `devices` | `idx_devices_user_active` | `(user_id, last_active_at DESC)`| B-Tree | `SELECT push_token FROM devices WHERE user_id = $1` | Retrieves active FCM tokens for fan-out alert dispatch. |
| `incidents` | `idx_incidents_status_priority`| `(status, priority DESC, reported_at DESC)` | B-Tree | `SELECT * FROM incidents WHERE status IN ('ACTIVE', 'TRIAGE_ACTIVE')` | Powers the Web Command Center live active incident roster. |
| `incidents` | `idx_incidents_geo` | `(latitude, longitude)` | B-Tree / GIST | `SELECT * FROM incidents WHERE ... distance < radius` | Mapbox geospatial bounding box queries for nearby incidents. |
| `incident_assignments`| `idx_inc_assign_lookup` | `(incident_id, user_id)` | B-Tree | `SELECT * FROM incident_assignments WHERE user_id = $1` | Mobile app startup check: "Which active incident is this paramedic assigned to?" |
| `ambulances` | `idx_ambulances_status` | `(status)` | B-Tree | `SELECT * FROM ambulances WHERE status = 'AVAILABLE'` | Dispatch screen listing available vehicle fleet units. |
| `location_history`| `idx_loc_history_amb_time` | `(ambulance_id, recorded_at DESC)` | B-Tree | `SELECT * FROM location_history WHERE ambulance_id = $1 ORDER BY recorded_at DESC LIMIT 50` | Breadcrumb path reconstruction for map playback. |
| `patients` | `idx_patients_incident_status`| `(incident_id, status)` | B-Tree | `SELECT * FROM patients WHERE incident_id = $1 AND deleted_at IS NULL` | Renders casualty list for a specific disaster site. |
| `patients` | `idx_patients_triage_queue` | `(current_triage_category, created_at ASC)` | B-Tree | `SELECT * FROM patients WHERE status = 'ARRIVED_ER' ORDER BY priority, created_at` | **Critical Triage Queue index**: Powers Doctor's priority queue (`RED` first, oldest wait time). |
| `patient_vitals` | `idx_vitals_patient_time` | `(patient_id, recorded_at DESC)`| B-Tree | `SELECT * FROM patient_vitals WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1` | Fetches the latest clinical vital sign telemetry point in < 2ms. |
| `patient_media` | `idx_media_patient_type` | `(patient_id, media_type)` | B-Tree | `SELECT * FROM patient_media WHERE patient_id = $1` | Populates injury photo gallery and voice memo playlist in patient drawer. |
| `triage_assessments`| `uq_triage_current_patient` | `(patient_id)` WHERE `is_current = true` | **Partial Unique B-Tree** | `SELECT * FROM triage_assessments WHERE patient_id = $1 AND is_current = true` | **Enforces single active assessment per patient** and accelerates active triage lookup. |
| `inventory_items`| `idx_inventory_category` | `(category, name)` | B-Tree | `SELECT * FROM inventory_items ORDER BY category, name` | Powers the Superintendent's Resource Inventory table on web and mobile. |
| `inventory_transactions`| `idx_inv_tx_item_time` | `(item_id, created_at DESC)`| B-Tree | `SELECT * FROM inventory_transactions WHERE item_id = $1 ORDER BY created_at DESC` | Stock audit ledger showing chronological consumption and restock logs. |
| `notifications` | `idx_notif_category_created` | `(category, created_at DESC)` | B-Tree | `SELECT * FROM notifications WHERE category = $1 ORDER BY created_at DESC` | Filters system notification broadcasts by operational category. |
| `notification_deliveries`| `idx_notif_delivery_user_unread`| `(recipient_user_id, status)` WHERE `status != 'READ'` | Partial B-Tree | `SELECT count(*) FROM notification_deliveries WHERE recipient_user_id = $1 AND status != 'READ'` | Renders unread notification badge counter on mobile app header. |
| `notification_deliveries`| `idx_notif_delivery_notif_id`| `(notification_id)` | B-Tree | `SELECT * FROM notification_deliveries WHERE notification_id = $1` | Inspects delivery fan-out status across all targeted recipients. |
| `audit_logs` | `idx_audit_timestamp` | `(timestamp DESC)` | B-Tree | `SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50` | Fast pagination for Superintendent audit trail viewer. |
| `audit_logs` | `idx_audit_entity` | `(entity_type, entity_id)` | B-Tree | `SELECT * FROM audit_logs WHERE entity_type = 'PATIENT' AND entity_id = $1` | Reconstructs the complete historical timeline for a single patient or resource. |
| `audit_logs` | `idx_audit_metadata_gin` | `(metadata)` | GIN | `SELECT * FROM audit_logs WHERE metadata @> '{"field": "vitals"}'` | Search across structured mutation diffs. |
| `domain_events` | `idx_domain_events_type_time`| `(event_type, occurred_at)` | B-Tree | `SELECT * FROM domain_events WHERE event_type IN (...) AND occurred_at >= $1` | Powers the Analytics service to calculate ER Load and Response Time deltas. |
| `sync_history` | `idx_sync_device_time` | `(device_id, applied_at DESC)` | B-Tree | `SELECT * FROM sync_history WHERE device_id = $1` | Device synchronization status inspection and diagnostic telemetry. |

---

## 2. Advanced Partial Indexing Rules
To prevent bloated B-Trees on high-frequency tables, MedFlow implements PostgreSQL **Partial Indexes**:

### 1. Active Triage Assessment Partial Unique Index
```sql
CREATE UNIQUE INDEX uq_triage_assessments_current_patient 
ON triage_assessments (patient_id) 
WHERE is_current = true;
```
* **Why**: Enforces database-level consistency ensuring a patient can NEVER have more than one current triage assessment, while keeping the lookup index extremely compact in RAM.

### 2. Unread Notification Deliveries Partial Index
```sql
CREATE INDEX idx_notification_deliveries_unread 
ON notification_deliveries (recipient_user_id, status) 
WHERE status != 'READ';
```
* **Why**: Users read or dismiss notifications quickly. Indexing millions of historic read notifications slows down badge counts. This partial index indexes only unresolved delivery alerts.
