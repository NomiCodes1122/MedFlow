# MedFlow Container Architecture & Clean Architecture Framework

## 1. High-Level Architectural Pattern
MedFlow is structured around **Feature-First + Clean Architecture Principles**, decoupling domain business logic from framework code, network transport mechanisms, persistence technologies, and external service SDKs.

The system is designed as a **modular monolith** with strong module boundaries, offline-first mobile clients, and real-time communication—avoiding unnecessary distributed complexity (no Kubernetes, no microservices, no Kafka/RabbitMQ).

```mermaid
flowchart TD
    subgraph UI_Layer["1. Presentation / UI Layer (Client & API Gateways)"]
        ReactUI["React / React Native Views & Screens"]
        Controllers["Express Route Controllers & Socket.IO Event Handlers"]
        ZustandStores["Zustand Client UI Stores"]
    end

    subgraph App_Layer["2. Application / Use Case Layer"]
        UseCases["Use Case Interactors<br/>(e.g., CreatePatient, TriagePatient, SyncOutbox, ReserveInventory)"]
        DTOs["Request / Response DTOs & Mappings"]
        EventPublishers["Domain Event Dispatchers"]
    end

    subgraph Domain_Layer["3. Domain Logic Layer (Pure Business Core)"]
        Entities["Domain Entities & Aggregates<br/>(Patient, Incident, TriageAssessment, InventoryItem)"]
        ValueObjects["Value Objects<br/>(Vitals, Coordinates, Priority, TriageCategory)"]
        DomainServices["Domain Services & Business Rules<br/>(START Triage Calculator, Concurrency Evaluator)"]
        RepoInterfaces["Repository & Gateway Interfaces (Ports)"]
    end

    subgraph Infra_Layer["4. Infrastructure Layer (Adapters & External Drivers)"]
        PrismaRepo["Prisma ORM & Supabase PostgreSQL Repositories"]
        SQLiteRepo["SQLite Mobile Local Repositories"]
        RedisAdapter["Redis Cloud State & Lock Manager"]
        FirebaseAdapter["Firebase Admin (Auth/FCM/Storage) Gateways"]
        MapboxAdapter["Mapbox Geo & Routing Service"]
        SocketAdapter["Socket.IO Client/Server Transport"]
    end

    %% Inward Clean Architecture Dependency Flow
    UI_Layer --> App_Layer
    App_Layer --> Domain_Layer
    Infra_Layer --> Domain_Layer
    App_Layer --> Infra_Layer
```

### Dependency Inversion Rule
Dependencies strictly point inward:
- **Domain Layer** has zero external dependencies (no Express, no Prisma, no React, no Firebase). It contains pure business models and interface definitions ("ports").
- **Application Layer** orchestrates use cases, executes validation schemas, and calls repository ports.
- **Infrastructure Layer** implements repository interfaces ("adapters") for Supabase PostgreSQL, SQLite, Redis Cloud, Firebase, and Mapbox.
- **Presentation Layer** interacts only with Application Use Cases via defined DTOs.

---

## 2. Container-Level Architecture & Responsibilities

### 2.1 Mobile Application (`apps/mobile`)
- **Technology**: React Native, TypeScript, Expo, Expo Development Build, EAS Build.
- **Build Strategy**: Built and packaged in the cloud using **EAS Build**. Android Studio, Android SDKs, and JDK are **not** required local development environment dependencies.
- **Role**: Primary edge client for Paramedics in transit and Triage Doctors on clinical floors.
- **Core Containers & Modules**:
  1. *Presentation*: Touch-optimized emergency views, high-contrast visual components, START assessment wizard, interactive vector map screen, live outbox status bar.
  2. *State Management*: Zustand for client-only volatile UI state; TanStack Query for server-cache synchronization.
  3. *Local SQLite Persistence*: Local SQLite database storing local operational records (active incidents, draft patients, observations, triage decisions) and the offline `outbox` mutation table.
  4. *Outbox & Synchronization Engine*: Background worker queue that monitors network reachability (`@react-native-community/netinfo`), batches operations, applies exponential backoff, sends idempotency tokens, and updates UI sync badges.
  5. *Hardware Sensor Subsystems*: Expo Camera (compressed photo capture), Expo Audio (AAC/M4A voice memo recording), Expo Location (throttled GPS telemetry stream), Expo SecureStore (encrypted JWT / session storage).

### 2.2 Web Command Center (`apps/web`)
- **Technology**: React 18+, TypeScript, Vite, TailwindCSS (curated high-contrast tokens).
- **Role**: Operational oversight dashboard for Hospital Superintendents and Command Center staff.
- **Core Containers & Modules**:
  1. *Command Dashboard*: Multi-pane layout displaying real-time incident queues, ER influx, hospital bed capacities, and ambulance vectors.
  2. *Interactive Vector Map*: Mapbox GL JS map rendering live ambulance markers with heading arrows, incident cluster rings, and hospital geofences.
  3. *Resource Inventory Manager*: Tabular grid with optimistic concurrency control, real-time quantity increments/decrements, stock threshold badges, and conflict reconciliation modals.
  4. *Analytics Visualizer*: Canvas/SVG time-series charts rendering real-time ER load, paramedic response times, START triage category breakdowns, and consumable depletion rates.
  5. *Audit Log Viewer & Export*: Paginated, immutable audit trail search with filters by actor, action, timestamp, and one-click cryptographic export (CSV/JSON).

### 2.3 API Server & Realtime Gateway (`apps/api`)
- **Technology**: Node.js, Express, TypeScript, Socket.IO.
- **Role**: Primary application backend, business orchestrator, authorization gatekeeper, and real-time dispatcher.
- **Core Architectural Rule**: **Express remains the primary application backend.** Clients never bypass Express to connect directly to Supabase PostgreSQL or call Supabase Edge Functions.
- **Sub-Containers & Architectural Layers**:
  1. *HTTP Transport Gateway*: RESTful endpoints (`/api/v1/*`) with rate-limiting, CORS, Helmet headers, request correlation IDs (`X-Request-Id`), and centralized error mapping.
  2. *Authentication & RBAC Middleware*: Firebase ID Token verifier, local user profile resolver, role capability validator (`PARAMEDIC`, `TRIAGE_DOCTOR`, `SUPERINTENDENT`).
  3. *Domain Use Case Services*: Isolated business operations (`RegisterPatientUseCase`, `EvaluateStartTriageUseCase`, `UpdateInventoryWithVersionUseCase`, `ProcessOutboxBatchUseCase`).
  4. *Socket.IO Realtime Gateway*: Authenticated WebSocket rooms (`incident:{id}`, `hospital:inventory`, `telemetry:ambulances`, `triage:queue`) backed by the Redis Cloud adapter for horizontal pub/sub.
  5. *Outbox Ingestion Engine*: Idempotent transaction processor verifying operation IDs against historical execution logs before applying state mutations.
  6. *Audit Event Interceptor*: Automatic recording of auditable mutations into Supabase PostgreSQL in the same ACID transaction as the state change.

### 2.4 Supabase PostgreSQL (Hosted Database)
- **Role**: Primary Authoritative System of Record (SoR).
- **Architecture**: Supabase provides the managed, hosted PostgreSQL infrastructure. The Express API accesses Supabase PostgreSQL exclusively through **Prisma ORM**.
- **Storage Subsystems**:
  - Relational tables for Users, Incidents, Ambulances, Patients, Observations, Triage Assessments, Inventory Items, and Audit Logs.
  - Foreign key integrity, unique constraints on idempotency keys and device tokens.
  - Granular indexes on timestamps, incident references, triage categories, and audit entities.
  - Row version numbers (`version` integer) on mutable concurrently-edited entities.
  - Access is restricted to the Express API backend connection pool. Clients never communicate directly with Supabase.

### 2.5 Redis Cloud (Managed Ephemeral Store & Broker)
- **Role**: High-velocity volatile coordination engine (NEVER primary persistent source of truth).
- **Architecture**: Fully managed Redis Cloud instance accessed via TLS connection from Express.
- **Operational Functions**:
  1. *Socket.IO Redis Adapter*: Synchronizes WebSocket event delivery across horizontally scaled API nodes.
  2. *Live Telemetry Cache*: Stores latest GPS coordinates (`ambulances:geo:live`) with Redis Geospatial indexes (`GEOADD` / `GEORADIUS`) and TTL expiration (15 seconds) to avoid hammering PostgreSQL with sub-second GPS pings.
  3. *Rate Limiting*: Redis sliding window counters protecting authentication endpoints and outbox sync endpoints from abuse.
  4. *Distributed Concurrency Lock*: Redlock / distributed mutex for atomic critical operations (e.g., mass casualty inventory reservations).

### 2.6 Firebase Services
- **Firebase Phone Authentication**: Edge SMS verification and Firebase ID token issuance.
- **Firebase Storage**: Cloud object storage bucket with strict security rules enforcing authenticated upload of multimedia assets (`/incidents/{incidentId}/patients/{patientId}/{mediaId}.[jpg|m4a]`).
- **Firebase Cloud Messaging (FCM)**: Push notification routing using APNs and FCM transport, targeted by device registration token and role topics (`topic:doctors`, `topic:paramedics`).

### 2.7 Mapbox Services
- **Mapbox Vector Tiles API**: Rendering dynamic vector maps on web and mobile.
- **Mapbox Directions API**: Generating polyline geometries and real-time ETA estimates between ambulance coordinates and target hospital triage bays.

---

## 3. Monorepo Structure & npm Workspaces

The MedFlow repository is managed using an **npm workspaces monorepo** with shared validation, types, and configs:

```text
medflow/
├── apps/
│   ├── mobile/                    # React Native Expo Mobile App (EAS Build)
│   │   ├── src/
│   │   │   ├── features/          # Feature-first modules (auth, intake, triage, map, sync)
│   │   │   ├── shared/            # Common UI components, hooks, storage
│   │   │   └── App.tsx
│   ├── web/                       # React + Vite Web Command Dashboard
│   │   ├── src/
│   │   │   ├── features/          # Feature-first modules (command, inventory, analytics, audit)
│   │   │   ├── shared/            # Common layout, UI tokens, hooks
│   │   │   └── main.tsx
│   └── api/                       # Node.js + Express API & Socket.IO
│       ├── src/
│       │   ├── domain/            # Pure entities, domain services, interfaces
│       │   ├── application/       # Use cases, DTOs, event handlers
│       │   ├── infrastructure/    # Prisma repos, Redis Cloud, Firebase, Socket.IO
│       │   ├── presentation/      # Express routes, middlewares, controllers
│       │   └── server.ts
│
├── packages/
│   ├── types/                     # Shared TypeScript interfaces, enums, Socket events
│   ├── validation/                # Shared Zod validation schemas (vitals, START, intake)
│   ├── config/                    # Shared environment schemas and constants
│   └── eslint-config/             # Unified linting rules
│
├── docs/                          # Architectural and operational documentation
├── package.json                   # Root package definition with npm workspaces
└── tsconfig.base.json             # Root TypeScript strict settings
```

Root `package.json` workspace declaration:
```json
{
  "name": "medflow",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

---

## 4. Cross-Cutting Concerns & Configuration

### 4.1 Observability & Correlation IDs
Every incoming HTTP request or Socket.IO packet receives or propagates a unique `x-request-id` (UUIDv4). This ID is bound to the async execution context using Node.js `AsyncLocalStorage` and injected into:
- Structured JSON log outputs (Pino/Winston).
- Database query comment tags.
- Resulting Audit Log entries in Supabase PostgreSQL.
- Outbox synchronization acknowledgment payloads.

### 4.2 Error Handling & Normalization
No raw exceptions, SQL errors, or stack traces escape past the API boundary. The presentation layer maps application and domain exceptions into standard RFC 7807 Problem Details:
```json
{
  "type": "https://medflow.org/errors/concurrency-conflict",
  "title": "Conflict Detected",
  "status": 409,
  "detail": "Resource 'Oxygen Tank O2-40L' was updated by another user (client version 5, current server version 6).",
  "instance": "/api/v1/inventory/item-123",
  "code": "CONCURRENCY_CONFLICT",
  "currentVersion": 6,
  "requestId": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
}
```

### 4.3 Environment-Based Configuration
Configuration is strictly managed through environment variables loaded at runtime. Credentials and secrets are never committed into Git.

```text
# Database (Hosted Supabase PostgreSQL via connection pooler / direct)
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"

# Cache & PubSub (Managed Redis Cloud)
REDIS_URL="rediss://default:[password]@[endpoint].redislabs.com:[port]"

# Authentication & Push (Firebase Admin SDK)
FIREBASE_PROJECT_ID="medflow-prod"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@[project-id].iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Geospatial & Maps
MAPBOX_ACCESS_TOKEN="pk.eyJ1Ijoi..."

# Security
JWT_SECRET="[secure-random-256-bit-key]"
JWT_REFRESH_SECRET="[secure-random-256-bit-key]"

# Mobile Build (EAS)
EXPO_PUBLIC_API_URL="https://api.medflow.org"
EXPO_PUBLIC_MAPBOX_TOKEN="pk.eyJ1Ijoi..."
```

Environments are cleanly partitioned into `development`, `test`, and `production/demo` configurations.
