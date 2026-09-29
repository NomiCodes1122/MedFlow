# MedFlow Real-Time Architecture & Socket.IO Specification

## 1. Realtime Principles & Architectural Boundaries
Socket.IO serves exclusively as a **low-latency notification and telemetry transport**. It is **never the primary source of truth** for persisted business data. 

**Supabase PostgreSQL** remains the authoritative system of record. Every state-altering operation originates as an HTTP REST or Outbox batch mutation that commits to Supabase PostgreSQL first via Prisma. Once the ACID transaction commits, the Express API server publishes the change to **Redis Cloud**, which fans out the event across the Socket.IO cluster to connected mobile and web clients.

```mermaid
flowchart TD
    subgraph ClientLayer["Connected Clients"]
        MobileParamedic["Paramedic Mobile<br/>(Socket.IO Client)"]
        MobileDoctor["Doctor Mobile<br/>(Socket.IO Client)"]
        WebDashboard["Superintendent Web<br/>(Socket.IO Client)"]
    end

    subgraph APICluster["API & Socket.IO Gateway (Express)"]
        Node1["API Server Node 1<br/>(Express + Socket.IO)"]
        Node2["API Server Node 2<br/>(Express + Socket.IO)"]
    end

    subgraph PubSubLayer["Distributed Coordination Layer"]
        RedisPubSub[("Redis Cloud Pub/Sub<br/>(Socket.IO Redis Adapter)")]
    end

    subgraph StorageLayer["Authoritative Persistence"]
        PG[("Supabase PostgreSQL<br/>(System of Record via Prisma)")]
    end

    %% Client Connections with Auth Handshake
    MobileParamedic -->|"WSS (Auth Handshake Token)"| Node1
    MobileDoctor -->|"WSS (Auth Handshake Token)"| Node1
    WebDashboard -->|"WSS (Auth Handshake Token)"| Node2

    %% State Commit to SoR
    Node1 -->|"1. Commit ACID Mutation"| PG
    Node1 -->|"2. Publish Event"| RedisPubSub

    %% Redis Cloud Adapter Fan-Out
    RedisPubSub -->|"3. Multi-Instance Sync"| Node1
    RedisPubSub -->|"3. Multi-Instance Sync"| Node2

    %% Client Invalidation
    Node1 -->>|"4. Emit Room Event"| MobileDoctor
    Node2 -->>|"4. Emit Room Event"| WebDashboard

    %% Invalidation Hook
    MobileDoctor -.->|"5. TanStack Invalidate & Re-fetch"| Node1
```

---

## 2. Connection Lifecycle & Authentication Handshake

### 2.1 Handshake Authentication
Every WebSocket connection must authenticate during the initial Socket.IO connection handshake. Unauthenticated connection attempts are rejected before reaching any socket room.

```typescript
// Server-Side Connection Middleware (apps/api)
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers['authorization']?.split(' ')[1];
    if (!token) {
      return next(new Error('AUTHENTICATION_REQUIRED'));
    }
    const decodedUser = verifyJwt(token); // Validates signature, expiry, and revoked status
    socket.data.user = decodedUser;       // Attaches { userId, role, assignedIncidentId }
    next();
  } catch (err) {
    next(new Error('INVALID_OR_EXPIRED_TOKEN'));
  }
});
```

### 2.2 Reconnection & Token Refresh
- If the access token expires while connected, the server emits an `auth.session.expired` event.
- The mobile/web client uses its refresh token in `Expo SecureStore` or HttpOnly cookie to obtain a fresh access token via REST, updates `socket.auth.token`, and calls `socket.connect()`.
- Client uses automatic exponential reconnection: initial delay 1000ms, max delay 10000ms, with randomized randomization factor 0.5.

---

## 3. Namespace & Room Hierarchy

MedFlow operates on a single primary namespace (`/`) partitioned into capability-gated, fine-grained rooms:

| Room Identifier | Subscription Access Rule | Purpose & Events |
| :--- | :--- | :--- |
| `incident:{incidentId}` | Paramedics assigned to incident, Doctors, Superintendents | Real-time intake updates, triage alerts, and on-scene incident changes. |
| `triage:queue` | `TRIAGE_DOCTOR`, `SUPERINTENDENT` | Instantaneous triage classification events, patient priority queue shifts, hospital bed assignments. |
| `hospital:inventory` | `SUPERINTENDENT`, `TRIAGE_DOCTOR` | Live stock quantity adjustments, optimistic concurrency conflict broadcasts, critical shortage warnings. |
| `telemetry:ambulances` | `SUPERINTENDENT`, assigned Paramedics | High-frequency GPS updates for live vector map tracking. |
| `user:{userId}` | Private room bound to individual user | Direct operational alerts, session revocation, sync failure notifications. |

### Room Join Authorization:
When a client emits `join:room`, the Express backend executes an authorization guard:
```typescript
socket.on('join:room', async ({ room }, callback) => {
  const user = socket.data.user;
  const isAuthorized = await authorizeRoomAccess(user, room);
  if (!isAuthorized) {
    return callback({ status: 'ERROR', code: 'FORBIDDEN_ROOM_ACCESS' });
  }
  socket.join(room);
  callback({ status: 'SUCCESS' });
});
```

---

## 4. Standardized Event Payload Envelope

Every real-time event conforms to a strict JSON envelope to ensure predictable client parsing, ordering verification, and debugging traceability:

```typescript
export interface RealtimeEnvelope<T> {
  eventId: string;          // UUIDv4 unique event identifier
  eventType: string;        // Domain event name (e.g., 'triage.evaluated')
  aggregateType: string;    // 'PATIENT' | 'INVENTORY' | 'AMBULANCE' | 'INCIDENT'
  aggregateId: string;      // Entity UUID
  version: number;          // Monotonically increasing aggregate version
  timestamp: number;        // UTC epoch milliseconds of database commit
  requestId: string;        // Trace correlation ID
  payload: T;               // Strongly-typed event data
}
```

### Example Realtime Event Payload (`triage.evaluated`):
```json
{
  "eventId": "e91b5c20-7213-4c91-9e22-83561a09d312",
  "eventType": "triage.evaluated",
  "aggregateType": "PATIENT",
  "aggregateId": "pat-501",
  "version": 2,
  "timestamp": 1727550120500,
  "requestId": "req-9871-332",
  "payload": {
    "patientId": "pat-501",
    "previousCategory": "YELLOW",
    "newCategory": "RED",
    "trigger": "Respiratory rate elevated to 36/min",
    "evaluatedBy": "user-paramedic-04",
    "demoId": "MED-2026-092"
  }
}
```

---

## 5. Event Taxonomy & Message Registry

| Domain | Event Name | Target Room | Producer | Consumer Action |
| :--- | :--- | :--- | :--- | :--- |
| **Patient** | `patient.created` | `incident:{id}` | Sync / Intake API | Doctor inserts new patient row in triage list. |
| **Patient** | `patient.vitals.updated` | `incident:{id}` | Intake API | Doctor UI appends live trend point to vitals chart. |
| **Triage** | `triage.evaluated` | `triage:queue` | Triage Engine | Moves patient card to RED/YELLOW/GREEN/BLACK matrix column. |
| **Inventory**| `inventory.updated` | `hospital:inventory` | Inventory API | Updates stock number on Web & Mobile; triggers flash animation. |
| **Inventory**| `inventory.conflict` | `hospital:inventory` | Inventory API | Alerts user attempting an edit that a conflict was caught. |
| **Telemetry**| `ambulance.location.updated` | `telemetry:ambulances` | Telemetry Worker | Smoothly animates Mapbox vehicle marker along street network. |
| **Incident** | `incident.status.changed` | `incident:{id}` | Command API | Updates incident badge on command dashboard and field app. |

---

## 6. Client Cache Invalidation Strategy (TanStack Query Integration)

MedFlow clients use Socket.IO primarily as an **invalidation trigger** rather than blindly patching client memory:

```typescript
// Client-side Event Handler Hook (apps/mobile or apps/web)
socket.on('triage.evaluated', (event: RealtimeEnvelope<TriageEventPayload>) => {
  // 1. Play immediate local haptic/audio cue for high-severity RED events
  if (event.payload.newCategory === 'RED') {
    EmergencyAlertSound.playCriticalChime();
  }

  // 2. Invalidate specific TanStack Query keys to trigger authoritative background re-fetch
  queryClient.invalidateQueries({
    queryKey: ['triage', 'queue'],
    exact: false
  });

  // 3. Update single patient query cache optimistically if data is self-contained
  queryClient.setQueryData(['patient', event.aggregateId], (oldData: any) => {
    if (!oldData || oldData.version >= event.version) return oldData; // Ignore stale out-of-order events
    return { ...oldData, triageCategory: event.payload.newCategory, version: event.version };
  });
});
```

### Stale Event Handling Rules:
1. Every entity state update includes the entity `version`.
2. Clients compare `event.version` against current local cache version. If `event.version <= cached.version`, the packet is discarded as a stale or duplicate event.
3. If a packet gap is detected ($V_{\text{event}} > V_{\text{cached}} + 1$), the client invalidates the entire query cache and triggers an immediate authoritative GET over REST from the Express API.
