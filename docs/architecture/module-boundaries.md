# MedFlow Module Boundaries & Capability Matrix

This document provides the definitive boundary definition for all 10 core modules in MedFlow. In accordance with the source specification and SRS, only **Module 3 (Map & Routing)**, **Module 6 (Resource Inventory)**, and **Module 10 (Adaptive UI & Accessibility)** are required on **Both** Mobile and Web. The remaining modules are owned primarily by the Mobile client and the central Express API server.

---

## 1. High-Level Module Matrix

| # | Module Name | Target Platform | Primary Owner | External Integrations | Realtime Events | Offline Capable |
| :- | :--- | :--- | :--- | :--- | :--- | :-: |
| **1** | Secure Role-Based Authentication | Mobile & Web | Mobile / Express API | Firebase Phone Auth | `auth.session.revoked` | Partial (cached token) |
| **2** | Local Cache & Conflict Resolution | Mobile | Mobile | SQLite, NetInfo | `sync.batch.completed`, `sync.conflict` | Core Engine |
| **3** | Interactive Vector Map & Routing | **Both (Mobile + Web)** | Mobile & Web | Mapbox Vector/Directions | `ambulance.location.updated` | Partial (cached tiles) |
| **4** | Multimedia Emergency Intake Form | Mobile | Mobile | Firebase Storage, Expo Camera/Audio | `patient.intake.created` | Full (outbox + blob queue) |
| **5** | Push Notification & Priority Queue | Mobile | Mobile / Express API | Firebase Cloud Messaging (FCM) | `notification.dispatched` | Receiving requires network |
| **6** | Dynamic Resource Inventory CRUD | **Both (Mobile + Web)** | Web & Mobile | None (Internal ACID DB via Prisma) | `inventory.updated`, `inventory.conflict` | Full (optimistic local read/write) |
| **7** | Triage Queue & Status Matrix | Mobile | Mobile / Express API | None (START Algorithm) | `triage.evaluated`, `triage.reclassified` | Full (local evaluation & outbox) |
| **8** | Analytics & Utilization Graphs | Web | Web / Express API | None (Internal Event Aggregator) | `analytics.metric.updated` | N/A (Web online command) |
| **9** | Audit Trail & Export Engine | Web | Web / Express API | Node Stream / CSV Stringifier | `audit.event.recorded` | Append-only server guarantee |
| **10** | Adaptive UI & Accessibility | **Both (Mobile + Web)** | Mobile & Web | React Native A11y, ARIA | None | Full (client rendering system) |

---

## 2. Detailed Module Specifications

### Module 1: Secure Role-Based Authentication
* **Primary Responsibility**: Identity verification via SMS OTP, user provisioning, secure token issuance, and strict server-side capability authorization.
* **Owner Application**: Mobile (Paramedic, Doctor) and Web (Superintendent).
* **Backend Responsibilities (Express API)**:
  - Verify Firebase ID tokens using Firebase Admin SDK.
  - Query Supabase PostgreSQL via Prisma for the associated `User` record and assigned `Role` (`PARAMEDIC`, `TRIAGE_DOCTOR`, `SUPERINTENDENT`).
  - Issue cryptographically signed short-lived access JWTs (15 min) and rotational refresh tokens (7 days).
  - Enforce role-based access control (RBAC) middleware across all HTTP routes and Socket.IO handshake connections.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `User`: `id` (UUID), `phone` (E.164 unique), `name`, `role`, `isActive`, `createdAt`, `updatedAt`.
  - `RefreshToken`: `id`, `userId`, `hashedToken`, `expiresAt`, `revokedAt`.
* **Mobile Responsibilities**:
  - Phone input screen with country code validation.
  - OTP verification screen communicating with Firebase Auth SDK.
  - Exchange Firebase token with MedFlow `/api/v1/auth/session`.
  - Store tokens strictly in `Expo SecureStore` (never plaintext AsyncStorage).
  - Packaged via EAS Build.
* **Web Responsibilities**:
  - Superintendent OTP login portal.
  - Store tokens in memory with HttpOnly, Secure, SameSite refresh cookie.
* **External Integrations**: Firebase Phone Authentication.
* **Dependencies**: None.
* **Domain Entities**: `User`, `Role`, `SessionToken`.
* **Realtime Events**: `auth.session.revoked`.
* **Offline Requirements**: Authenticated session state persists offline in SecureStore; cached user identity allows offline app boot.
* **Security Considerations**: Never trust client-supplied roles; enforce least privilege on all endpoints; rate limit OTP attempts to prevent SMS pumping attacks.

---

### Module 2: Local Cache & Conflict Resolution
* **Primary Responsibility**: Guarantee continuous field operation without internet; queue mutations in an append-only Outbox; detect and resolve data conflicts upon reconnection.
* **Owner Application**: Mobile (Paramedics & Doctors).
* **Backend Responsibilities (Express API)**:
  - Expose transactional batch synchronization endpoint: `POST /api/v1/sync/batch`.
  - Verify idempotency keys (`operationId`) against `SyncHistory` table in Supabase PostgreSQL to prevent duplicate side effects.
  - Execute entity-specific conflict resolvers and return fine-grained status per operation (`SUCCESS`, `DUPLICATE_IGNORED`, `CONFLICT`).
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `SyncHistory`: `operationId` (UUID PK), `deviceId`, `entityType`, `entityId`, `status`, `appliedAt`, `responsePayload`.
* **Mobile Responsibilities**:
  - SQLite schema mirroring operational tables (`patients`, `observations`, `triage_assessments`, `outbox`).
  - Outbox table tracking `operationId`, `entityType`, `entityId`, `action`, `payload`, `status` (`PENDING`, `SYNCING`, `FAILED`, `CONFLICT`), `retryCount`, `createdAt`.
  - NetInfo network listener triggering background worker queue.
  - Exponential backoff with jitter (initial 1s, max 30s, max 5 attempts before user prompt).
  - User-facing sync status banner (`OFFLINE`, `SYNCING (3 items)`, `SYNCED`, `CONFLICT REQUIRED`).
* **Web Responsibilities**: N/A (Web is an always-online command dashboard).
* **External Integrations**: `@react-native-community/netinfo`.
* **Dependencies**: Module 1 (Auth), Module 4 (Intake), Module 7 (Triage).
* **Domain Entities**: `OutboxOperation`, `SyncStatus`, `ConflictResolution`.
* **Realtime Events**: `sync.batch.completed`, `sync.conflict.detected`.
* **Offline Requirements**: Core foundational module for all offline-first operations.
* **Security Considerations**: Outbox payloads must be encrypted at rest in SQLite using SQLCipher or secure file-system permissions.

---

### Module 3: Interactive Vector Map & Routing (Both Mobile + Web)
* **Primary Responsibility**: Real-time geographic visualization of disaster incidents, active ambulance positions, hospital emergency bays, and route ETA navigation.
* **Owner Application**: **Both (Mobile + Web)**.
* **Backend Responsibilities (Express API)**:
  - Ingest throttled GPS telemetry via Socket.IO (`ambulance.location.updated`).
  - Cache live locations in Redis Cloud (`GEOADD ambulances:geo:live`) with 15s TTL.
  - Persist sampled location history to Supabase PostgreSQL `LocationHistory` every 30 seconds for audit and tracking.
  - Proxy Mapbox Directions API requests if token masking is required.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `LocationHistory`: `id`, `ambulanceId`, `latitude`, `longitude`, `speed`, `heading`, `recordedAt`.
* **Mobile Responsibilities**:
  - Expo Location background watcher tracking paramedic vehicle position (throttled to 5000ms intervals or 25-meter displacement).
  - Mapbox React Native vector map rendering incident pin, destination hospital, and turn-by-turn polyline.
* **Web Responsibilities**:
  - Mapbox GL JS responsive vector map across full command center dashboard.
  - High-frequency marker animation with smooth bearing rotation and incident heatmaps.
* **External Integrations**: Mapbox Vector Tile Service, Mapbox Directions API.
* **Dependencies**: Module 1 (Auth), Module 5 (Alerts).
* **Domain Entities**: `GeoCoordinate`, `AmbulanceLocation`, `NavigationRoute`.
* **Realtime Events**: `ambulance.location.updated`, `incident.location.changed`.
* **Offline Requirements**: Mapbox vector tiles cached for immediate offline vicinity; GPS coordinates buffered locally if offline.
* **Security Considerations**: Paramedic locations only visible to authorized hospital dispatchers and team members.

---

### Module 4: Multimedia Emergency Intake Form
* **Primary Responsibility**: Rapid, structured collection of patient demographics, vital signs, physical injury photographs, and voice memos under emergency conditions.
* **Owner Application**: Mobile.
* **Backend Responsibilities (Express API)**:
  - Ingest patient intake payload via REST (`POST /api/v1/patients`) or batch sync.
  - Validate vital sign ranges using shared Zod schema.
  - Ingest media metadata (`POST /api/v1/patients/:id/media`) and link signed Firebase Storage URLs.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `Patient`: `id`, `incidentId`, `demoId`, `name`, `gender`, `estimatedAge`, `status`, `version`, `createdAt`.
  - `Observation`: `id`, `patientId`, `systolicBP`, `diastolicBP`, `heartRate`, `respiratoryRate`, `spO2`, `gcsScore`, `recordedAt`, `recordedBy`.
  - `PatientMedia`: `id`, `patientId`, `mediaType` (`PHOTO`, `AUDIO`), `storageUrl`, `fileSizeBytes`, `mimeType`, `capturedAt`.
* **Mobile Responsibilities**:
  - Multi-step, swipeable emergency intake form with large touch targets.
  - Camera integration: capture injury photo, compress client-side to maximum 1600px width (JPEG, 75% quality), store in local filesystem cache.
  - Audio recording: record paramedic voice memo in AAC/M4A format (maximum 60 seconds duration, ~500KB).
  - Queue media binaries into dedicated local upload queue linked to the patient's local UUID.
* **Web Responsibilities**: Read-only display of patient cards, photo lightbox, and audio playback in patient drawer.
* **External Integrations**: Firebase Storage (bucket uploads), Expo Camera, Expo Audio.
* **Dependencies**: Module 1 (Auth), Module 2 (Sync).
* **Domain Entities**: `Patient`, `Observation`, `VitalSigns`, `PatientMedia`.
* **Realtime Events**: `patient.intake.created`, `patient.vitals.updated`.
* **Offline Requirements**: Completely operational offline; writes to local SQLite and queues media files for deferred background upload.
* **Security Considerations**: Never store binary blobs in PostgreSQL; validate file magic bytes on Express server before finalizing media records.

---

### Module 5: Push Notification & Alert Priority Queue
* **Primary Responsibility**: Guaranteed delivery of priority-categorized operational alerts to mobile responders and triage doctors across all app states (foreground, background, terminated).
* **Owner Application**: Mobile (Clients) & Express API (Dispatcher).
* **Backend Responsibilities (Express API)**:
  - Manage user device registration tokens (`POST /api/v1/notifications/devices`).
  - Prioritize alerts according to business rules:
    - `CRITICAL`: Immediate triage reclassification (`RED`), critical ICU bed depletion, new mass-casualty incident.
    - `MODERATE`: Patient vitals deterioration, incoming ambulance arrival within 5 minutes.
    - `LOW`: Routine shift notification, non-critical inventory restock.
  - Dispatch via Firebase Cloud Messaging (FCM) with Android high-priority channel flags and iOS APNs urgent priority.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `DeviceToken`: `id`, `userId`, `token`, `platform` (`IOS`, `ANDROID`), `lastActiveAt`.
  - `NotificationLog`: `id`, `userId`, `priority`, `title`, `body`, `deepLinkUri`, `status`, `sentAt`.
* **Mobile Responsibilities**:
  - Register FCM push token using Expo Notifications on app launch.
  - Handle foreground notifications with custom in-app banner.
  - Handle notification tap with deep linking into target Incident or Patient screen (`medflow://incident/:id`).
* **Web Responsibilities**: In-browser audio chime and toast notification for Superintendent dashboard.
* **External Integrations**: Firebase Cloud Messaging (FCM).
* **Dependencies**: Module 1 (Auth).
* **Domain Entities**: `PushNotification`, `AlertPriority`, `DeviceToken`.
* **Realtime Events**: `notification.dispatched`.
* **Offline Requirements**: Notifications are queued on FCM edge servers and delivered when the device reconnects.
* **Security Considerations**: Do not include sensitive patient names or PII in plaintext push notification payloads.

---

### Module 6: Dynamic Resource Inventory CRUD (Both Mobile + Web)
* **Primary Responsibility**: Real-time management and concurrent editing of critical hospital life-support resources (ICU/ER Beds, Oxygen Cylinders, Emergency Medications).
* **Owner Application**: **Both (Mobile + Web)**.
* **Backend Responsibilities (Express API)**:
  - Expose CRUD endpoints: `GET /api/v1/inventory`, `PATCH /api/v1/inventory/:id`.
  - Enforce Optimistic Concurrency Control (OCC) via the `version` column.
  - Wrap inventory decrements and audit logs in an ACID transaction executed against Supabase PostgreSQL via Prisma.
  - Broadcast real-time stock updates across Redis Cloud to all connected subscribers via Socket.IO.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `InventoryItem`: `id`, `name`, `category` (`BED`, `OXYGEN`, `MEDICATION`), `quantityTotal`, `quantityAvailable`, `unit`, `lowThreshold`, `version`, `updatedAt`.
  - `InventoryTransaction`: `id`, `itemId`, `quantityChange`, `previousQuantity`, `newQuantity`, `reason`, `userId`, `createdAt`.
* **Mobile Responsibilities**:
  - Mobile Paramedic/Doctor view: request or allocate emergency items from ambulance or triage bay.
  - Handle OCC 409 conflict gracefully with prompt to reload latest server quantity.
* **Web Responsibilities**:
  - Live data table for Superintendent with quick-increment buttons, low-stock visual alerts, and modal for concurrent conflict resolution.
* **External Integrations**: None.
* **Dependencies**: Module 1 (Auth), Module 9 (Audit).
* **Domain Entities**: `InventoryItem`, `InventoryCategory`, `InventoryTransaction`.
* **Realtime Events**: `inventory.updated`, `inventory.conflict.detected`, `inventory.critical_shortage`.
* **Offline Requirements**: Paramedics can record local resource consumption; sync engine applies change via transactional outbox upon reconnection.
* **Security Considerations**: Enforce strict RBAC: only Doctors and Superintendents can modify quantities; all changes trigger immutable audit log entries.

---

### Module 7: Triage Queue & Status Matrix
* **Primary Responsibility**: Provide an explainable, deterministic Simple Triage and Rapid Treatment (START) assessment workflow and real-time prioritized triage queue.
* **Owner Application**: Mobile.
* **Backend Responsibilities (Express API)**:
  - Expose triage API: `POST /api/v1/triage`, `PATCH /api/v1/triage/:id`.
  - Re-verify client START calculations on the server to prevent compromised triage logic.
  - Maintain triage queue ordering based on severity (`RED` > `YELLOW` > `GREEN` > `BLACK`) and waiting time.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `TriageAssessment`: `id`, `patientId`, `assessedBy`, `canWalk` (boolean), `hasRespirations` (boolean), `respiratoryRate` (int), `radialPulse` (boolean), `capillaryRefillSec` (float), `followsCommands` (boolean), `calculatedCategory` (`RED`, `YELLOW`, `GREEN`, `BLACK`), `overriddenCategory`, `overrideReason`, `createdAt`.
* **Mobile Responsibilities**:
  - START algorithm wizard: 4 rapid questions (Walking? Breathing? Perfusion/Pulse? Mental Status?).
  - Explainable result card explaining *why* the category was assigned.
  - Triage Matrix view for Doctors: grouped columns by category with drag-and-drop or quick-action status updates.
* **Web Responsibilities**: Read-only Triage Queue widget on command dashboard showing influx counts per category.
* **External Integrations**: None.
* **Dependencies**: Module 1 (Auth), Module 4 (Intake), Module 2 (Sync).
* **Domain Entities**: `TriageAssessment`, `STARTCategory`, `TriageDecisionTree`.
* **Realtime Events**: `triage.evaluated`, `triage.category.changed`.
* **Offline Requirements**: Full local execution of START logic; evaluation stored in local SQLite and synced via outbox.
* **Security Considerations**: Doctor manual overrides require entering an `overrideReason` and are logged to the immutable audit trail.

---

### Module 8: Analytics & Resource Utilization Graphs
* **Primary Responsibility**: Aggregate real application domain events to calculate and visualize operational metrics (ER load, response times, triage distribution, consumable depletion).
* **Owner Application**: Web.
* **Backend Responsibilities (Express API)**:
  - Ingest domain lifecycle events (`incident.created`, `ambulance.dispatched`, `ambulance.arrived`, `patient.triaged`, `patient.admitted`).
  - Compute operational KPIs from Supabase PostgreSQL records:
    - *ER Load Factor*: Active admitted patients vs. staffed ER bed capacity.
    - *Average Response Time*: Delta between `incident.created` and `ambulance.arrived`.
    - *Triage Category Distribution*: Percentage split across RED / YELLOW / GREEN / BLACK.
    - *Resource Run-Out Time*: Projected depletion rate based on consumption velocity.
  - Expose cached aggregations via `GET /api/v1/analytics/dashboard` (backed by 60s Redis Cloud cache).
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `DomainEvent`: `id`, `eventType`, `aggregateId`, `aggregateType`, `payload` (JSONB), `occurredAt`.
* **Mobile Responsibilities**: N/A (Web-only command capability).
* **Web Responsibilities**:
  - Dashboard analytics view rendering responsive time-series charts, bar charts, and gauge meters.
  - Filter by incident time window (1 hour, 6 hours, 24 hours).
* **External Integrations**: None.
* **Dependencies**: Module 1 (Auth), Module 6 (Inventory), Module 7 (Triage).
* **Domain Entities**: `OperationalMetric`, `EventLog`, `KPIAggregation`.
* **Realtime Events**: `analytics.metric.updated`.
* **Offline Requirements**: N/A (Online command center module).
* **Security Considerations**: Aggregated metrics strip all patient identifying attributes; accessible only to `SUPERINTENDENT`.

---

### Module 9: Audit Trail & Export Engine
* **Primary Responsibility**: Capture an immutable, append-only chronological log of all clinical, administrative, and inventory actions, and provide structured CSV/JSON data export.
* **Owner Application**: Web.
* **Backend Responsibilities (Express API)**:
  - Audit Interceptor middleware: automatically captures actor, role, action, target entity, request ID, device ID, and payload diff.
  - Write audit record within the same Supabase PostgreSQL ACID transaction as the triggering domain mutation.
  - Stream large export queries directly from Supabase PostgreSQL to client response using Node.js streams to prevent memory exhaustion.
* **Database Responsibilities (Supabase PostgreSQL via Prisma)**:
  - `AuditLog`: `id` (UUID), `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `timestamp`, `requestId`, `deviceId`, `metadata` (JSONB).
  - PostgreSQL trigger or restricted database user role preventing `UPDATE` or `DELETE` on `AuditLog` table.
* **Mobile Responsibilities**: Record local client-side audit entries in SQLite outbox for upload.
* **Web Responsibilities**:
  - Searchable, filterable audit log viewer with pagination and JSON metadata inspector.
  - Export trigger button supporting CSV and JSON download with date range filtering.
* **External Integrations**: None.
* **Dependencies**: Module 1 (Auth).
* **Domain Entities**: `AuditRecord`, `ExportRequest`.
* **Realtime Events**: `audit.event.recorded`.
* **Offline Requirements**: N/A for Web viewer; mobile local actions generate audit logs upon synchronization.
* **Security Considerations**: Audit logs form an application-level immutable audit log; normal application users cannot alter or truncate logs; export actions generate audit logs themselves.

---

### Module 10: Adaptive UI & Accessibility (Both Mobile + Web)
* **Primary Responsibility**: Ensure high-stress emergency usability through high-contrast visual tokens, minimum 48x48dp touch targets, screen-reader semantics, and resilient empty/error/loading states.
* **Owner Application**: **Both (Mobile + Web)**.
* **Backend Responsibilities**:
  - Provide localized, friendly error codes and descriptive error titles in all API responses.
* **Database Responsibilities**: None.
* **Mobile Responsibilities**:
  - Minimum 48x48dp interactive touch bounding boxes for gloved or shaking paramedic hands.
  - Dual status encoding: emergency indicators use color PLUS bold iconography and distinct text labels (e.g., Red + ⚠️ + "IMMEDIATE").
  - Dynamic font scaling compatible with iOS Dynamic Type and Android font scaling.
  - Screen reader attributes (`accessibilityLabel`, `accessibilityRole`, `accessibilityHint`).
  - Built using EAS Cloud.
* **Web Responsibilities**:
  - Full keyboard navigation (tabbing, escape modal handling, enter/space trigger).
  - WCAG 2.1 AA compliant color contrast ratios (> 4.5:1 for standard text, > 3:1 for large graphical elements).
  - Responsive breakpoints adapting from ultra-wide command monitors down to emergency field tablets.
* **External Integrations**: None.
* **Dependencies**: Cross-cutting design system used by all UI modules.
* **Domain Entities**: `UIThemeTokens`, `AccessibilitySettings`.
* **Realtime Events**: None.
* **Offline Requirements**: Full local execution (embedded style system).
* **Security Considerations**: Ensure no sensitive patient health data is leaked into accessibility debug tree or unmasked screen captures.
