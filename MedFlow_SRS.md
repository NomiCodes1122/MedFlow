# MedFlow --- Software Requirements Specification (SRS)

**Project:** MedFlow: Emergency Telehealth & Disaster Response Command
System\
**Document Type:** Software Requirements Specification\
**Version:** 1.0\
**Status:** Implementation Baseline\
**Target:** High-quality academic/hackathon prototype with
production-oriented engineering practices\
**Primary Mobile Platform:** React Native + TypeScript + Expo
Development Build\
**Web Platform:** React + TypeScript + Vite\
**Backend:** Express + TypeScript\
**Database:** PostgreSQL\
**Real-time:** Socket.IO\
**Cache/Concurrency Support:** Redis

------------------------------------------------------------------------

# 1. Document Purpose

This document defines the functional requirements, non-functional
requirements, architecture, data model requirements, security
requirements, synchronization strategy, API expectations, testing
strategy, implementation phases, and demo requirements for MedFlow.

MedFlow is an emergency-response prototype connecting field paramedics,
triage doctors, and hospital management during crisis scenarios.

The original task specification requires ten integrated modules and
emphasizes technical complexity/integration, architectural/code quality,
offline resilience, responsive UX, and live demonstration/defense.

This SRS is intended to become the implementation contract for the
project. Development should follow this document unless a requirement is
explicitly revised and recorded.

------------------------------------------------------------------------

# 2. Source Requirements

The original assignment defines these ten modules:

1.  Secure Role-Based Authentication
2.  Local Cache & Conflict Resolution
3.  Interactive Vector Map & Routing
4.  Multimedia Emergency Intake Form
5.  Push Notification & Alert Priority Queue
6.  Dynamic Resource Inventory CRUD
7.  Triage Queue & Status Matrix
8.  Analytics & Resource Utilization Graphs
9.  Audit Trail & Export Engine
10. Adaptive UI & Accessibility

The source specification marks modules 3, 6, and 10 as **Both** mobile
and web. The remaining modules are primarily mobile.

The source specification also requires at least one API integration and
recommends React Native/TypeScript or Flutter, with Flutter preferred
for offline-heavy systems. This project deliberately selects React
Native + TypeScript + Expo according to the approved project decision.

------------------------------------------------------------------------

# 3. Product Scope

## 3.1 In Scope

MedFlow will provide:

-   Secure phone-based OTP authentication
-   Role-based authorization
-   Fictional/demo patient records
-   Emergency patient intake
-   Patient vitals capture
-   Photo capture/upload
-   Audio note capture/upload
-   Offline-first patient workflows
-   Local persistent storage
-   Offline operation queue
-   Automatic synchronization after reconnection
-   Conflict detection and resolution
-   Emergency triage workflow based on START principles
-   Triage queue and status matrix
-   Live incident/ambulance mapping
-   Route visualization
-   Dynamic hospital resource inventory
-   Concurrent inventory editing
-   Real-time updates through Socket.IO
-   Push notifications through Firebase Cloud Messaging
-   Priority-based emergency alerts
-   Analytics derived from application events
-   Immutable audit events
-   Audit export
-   Responsive web command-center capabilities
-   Accessibility-focused emergency UI
-   Error handling and graceful degradation
-   Automated testing
-   API documentation
-   Demo/defense documentation

## 3.2 Out of Scope

The prototype will not claim to be a clinically validated production
medical system.

The following are out of scope unless explicitly added later:

-   Real patient/PHI data
-   Real clinical diagnosis
-   Autonomous medical decision-making
-   Medical-device integration
-   Insurance processing
-   Billing
-   Real hospital EHR integration
-   Production emergency-dispatch integration
-   Legal/compliance certification
-   Guaranteed clinical safety certification

START will be implemented as a transparent demonstration triage
workflow, not as an independently validated medical decision system.

------------------------------------------------------------------------

# 4. Users and Roles

## 4.1 Paramedic

Primary responsibilities:

-   Receive/respond to incidents
-   Create patient records
-   Capture vitals
-   Capture photographs
-   Record audio notes
-   Perform or initiate triage workflow
-   View assigned patients
-   View relevant map information
-   Receive emergency alerts
-   Work offline
-   Synchronize data when connectivity returns

## 4.2 Triage Doctor

Primary responsibilities:

-   View incoming patients
-   Review patient information
-   Review triage status
-   Perform/confirm triage workflow
-   Prioritize patients
-   Update patient status
-   View relevant incidents/resources
-   Receive priority notifications

## 4.3 Hospital Superintendent

Primary responsibilities:

-   Monitor command-center information
-   Monitor incidents and ambulances
-   Manage hospital resources
-   Manage bed availability
-   Manage oxygen inventory
-   Manage medication inventory
-   Monitor analytics
-   Review audit records
-   Export audit information

------------------------------------------------------------------------

# 5. High-Level System Architecture

``` text
                         MEDFLOW
                            |
             +--------------+--------------+
             |                             |
       React Native                      Web
          Expo                         React + TS
             |                             |
             +---------- HTTPS ------------+
             |                             |
             +-------- Socket.IO ----------+
                            |
                    Express + TypeScript
                            |
        +-------------------+-------------------+
        |                   |                   |
    PostgreSQL            Redis             Firebase
        |                   |              Auth / FCM /
        |                   |               Storage
        +-------------------+-------------------+
                            |
                       External APIs
                            |
                         Mapbox
```

------------------------------------------------------------------------

# 6. Repository Architecture

The project will use a pnpm monorepo.

``` text
medflow/
├── apps/
│   ├── mobile/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── types/
│   ├── validation/
│   ├── config/
│   └── eslint-config/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── security/
│   └── demo/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

Shared types and validation must be centralized where practical to
reduce duplication between mobile, web, and API.

------------------------------------------------------------------------

# 7. Technology Stack

## 7.1 Mobile

-   React Native
-   TypeScript
-   Expo Development Build
-   Zustand
-   TanStack Query
-   SQLite
-   Expo SecureStore
-   Socket.IO Client
-   Expo Camera
-   Expo Audio
-   Expo Notifications
-   Expo Location
-   Mapbox-compatible native integration

Expo Go must not be treated as the final runtime when native
functionality requires a development build.

## 7.2 Web

-   React
-   TypeScript
-   Vite
-   TanStack Query
-   Zustand where local UI state is required
-   Socket.IO Client
-   Mapbox
-   Accessible responsive UI

## 7.3 Backend

-   Node.js
-   Express
-   TypeScript
-   Prisma
-   PostgreSQL
-   Redis
-   Socket.IO
-   Zod
-   Firebase Admin SDK where required

## 7.4 External Services

-   Firebase Phone Authentication for OTP
-   Firebase Cloud Messaging for push notifications
-   Firebase Storage for media objects
-   Mapbox for mapping/routing

------------------------------------------------------------------------

# 8. Engineering Principles

The implementation must follow:

1.  TypeScript strict mode.
2.  Feature-first organization.
3.  Clear separation of presentation, application, domain, and
    infrastructure concerns.
4.  No uncontrolled global mutable state.
5.  Centralized API/error handling.
6.  Server-side authorization.
7.  Input validation at trust boundaries.
8.  Parameterized/ORM-based database access.
9.  Database transactions for multi-step mutations.
10. Idempotent synchronization operations.
11. Optimistic concurrency for concurrently edited resources.
12. Append-only audit records.
13. Secure storage for sensitive client-side credentials.
14. No secrets committed to source control.
15. No reliance on console logging for production behavior.
16. Automated tests for critical workflows.
17. Graceful failure when backend/network services are unavailable.
18. Observability through structured logs and request IDs.
19. Accessible and touch-optimized emergency UI.
20. Documentation sufficient for live technical defense.

------------------------------------------------------------------------

# 9. Module Requirements

# 9.1 Module 1 --- Secure Role-Based Authentication

## Functional Requirements

-   User enters phone number.
-   User receives OTP through Firebase Phone Authentication.
-   User verifies OTP.
-   Backend establishes/loads the application user.
-   User role is obtained from trusted backend data.
-   User receives authenticated application credentials/session.
-   Access to protected API resources requires authentication.
-   Access to role-restricted operations requires authorization.

## Roles

``` text
PARAMEDIC
TRIAGE_DOCTOR
SUPERINTENDENT
```

## Security Requirements

-   Client must never be trusted to assign its own role.
-   Passwords are not used for the primary authentication flow.
-   Tokens must not be stored in plain AsyncStorage.
-   SecureStore should be used for sensitive client credentials where
    applicable.
-   Access tokens should be short-lived.
-   Refresh credentials should be rotated and revocable.
-   Protected Socket.IO connections must authenticate.
-   Backend authorization must be enforced independently of UI
    visibility.

------------------------------------------------------------------------

# 9.2 Module 2 --- Local Cache & Conflict Resolution

This module is central to MedFlow.

## Requirements

The mobile application must continue operating when the backend or
internet connection is unavailable.

The application must:

-   Read essential data from local persistence.
-   Create/update permitted records locally.
-   Queue mutations for synchronization.
-   Persist the queue across application restarts.
-   Retry failed operations.
-   Avoid duplicate server-side operations.
-   Detect conflicts.
-   Resolve conflicts according to entity-specific rules.
-   Mark synchronization status clearly.
-   Never lose locally captured patient information because of temporary
    connectivity loss.

## Local Architecture

``` text
UI
 |
Application/Repository
 |
SQLite
 |
Outbox
 |
Sync Engine
 |
Connectivity Manager
 |
API
 |
Server
```

## Outbox Fields

Each queued operation should contain concepts equivalent to:

-   operation ID
-   entity ID
-   entity type
-   operation type
-   payload
-   client/device ID
-   client timestamp
-   retry count
-   sync status
-   created timestamp
-   last attempt timestamp

## Idempotency

Every sync mutation must have an idempotency key/operation identifier.

If the same operation reaches the server more than once, it must not
create duplicate effects.

## Conflict Strategy

Not all entities should use the same strategy.

### Patient clinical observations

Prefer append-only observation/event records where practical. This
reduces destructive overwrites.

### Patient profile fields

Use version-based optimistic concurrency and explicit conflict handling.

### Inventory

Use optimistic concurrency and transactional server updates.

### Location

Use the newest valid location event according to server/device timestamp
rules and validity constraints.

The implementation must document the conflict rule for each mutable
entity.

------------------------------------------------------------------------

# 9.3 Module 3 --- Interactive Vector Map & Routing

Platform: Mobile + Web.

## Requirements

The map must support:

-   Ambulance locations
-   Incident locations
-   Incident hotspots
-   Hospital locations
-   Patient/incident geographic context where authorized
-   Route visualization
-   Route information
-   Live location updates
-   Map interaction
-   Responsive web map
-   Mobile touch interaction

## Technology

Mapbox will be used for mapping and routing.

## Live Location Flow

``` text
Mobile GPS
   |
Location validation
   |
Socket.IO
   |
Backend
   |
Redis/live state
   |
Socket.IO broadcast
   |
Authorized clients
```

Location updates must be throttled/debounced appropriately to avoid
unnecessary network and rendering load.

------------------------------------------------------------------------

# 9.4 Module 4 --- Multimedia Emergency Intake Form

## Requirements

The form must support:

-   Patient identification/demo identifier
-   Basic demographics
-   Incident information
-   Vital signs
-   Triage information
-   Notes
-   Camera capture
-   Audio recording

## Form Requirements

-   Multi-step workflow
-   Clear validation
-   Save-progress behavior
-   Offline save
-   Helpful validation errors
-   Loading states
-   Upload progress
-   Retry support
-   Failure recovery

## Photo Pipeline

``` text
Camera
 |
Validation
 |
Resize/compress
 |
Metadata handling
 |
Local persistence when offline
 |
Outbox
 |
Upload
 |
Firebase Storage
 |
Database metadata
```

The database should store media metadata/reference rather than large
binary media payloads.

## Audio

Primary format:

``` text
AAC/M4A
```

Audio must support offline capture and later upload.

------------------------------------------------------------------------

# 9.5 Module 5 --- Push Notification & Alert Priority Queue

Firebase Cloud Messaging will be used.

## Priority Levels

``` text
CRITICAL
MODERATE
LOW
```

## Examples

Critical:

-   Critical triage event
-   Critical hospital resource shortage
-   Emergency operational alert

Moderate:

-   Important patient update
-   Resource warning

Low:

-   Routine informational update

The backend determines event priority according to defined business
rules.

## Requirements

-   Push registration
-   Device token management
-   Token invalidation
-   Role-aware delivery
-   Priority-aware delivery
-   Notification history where appropriate
-   Deep linking into relevant screens
-   Graceful behavior when notifications are unavailable

------------------------------------------------------------------------

# 9.6 Module 6 --- Dynamic Resource Inventory CRUD

Platform: Mobile + Web.

Resources include:

-   Hospital beds
-   Oxygen tanks
-   Medication supplies

## CRUD

Authorized users can:

-   View resources
-   Create resource records where applicable
-   Update quantities/status
-   Track availability
-   Search/filter
-   View changes
-   Receive real-time updates

## Concurrent Editing

Inventory requires optimistic concurrency.

Example:

``` text
quantity = 100
version = 5
```

A mutation must include the expected version.

If the version has changed:

``` text
Client version: 5
Server version: 6
```

the mutation must be rejected as stale and handled through a conflict
flow.

## Transactions

Inventory-changing operations must use database transactions.

## Real-Time

After a successful committed change:

``` text
PostgreSQL transaction
      |
InventoryChanged event
      |
Socket.IO
      |
Authorized clients
```

------------------------------------------------------------------------

# 9.7 Module 7 --- Triage Queue & Status Matrix

The system will implement a transparent START-based demonstration
workflow.

## START

START means Simple Triage and Rapid Treatment.

The workflow is intended for rapid categorization in mass-casualty
scenarios.

The system must not claim that MedFlow itself is clinically validated.

## Categories

-   Immediate / Red
-   Delayed / Yellow
-   Minor / Green
-   Expectant / Black

## Requirements

-   Create triage assessment
-   Record relevant assessment values
-   Calculate/display the resulting category according to the
    implemented documented rules
-   Allow authorized users to review/update the assessment
-   Show patients in priority order
-   Show current patient status
-   Update queue in real time where connected
-   Preserve historical triage events

## Important Design Rule

Triage results must be explainable.

The UI should show the assessment inputs and resulting classification
rather than displaying an unexplained score.

------------------------------------------------------------------------

# 9.8 Module 8 --- Analytics & Resource Utilization Graphs

Analytics must be derived from real application-generated events.

## Required Metrics

-   ER load factors
-   Average response times
-   Staff shift distributions
-   Resource utilization
-   Patient/triage volumes
-   Incident activity

## Event-Based Measurement

Example:

``` text
incident.created
        |
ambulance.dispatched
        |
ambulance.arrived
        |
patient.triaged
        |
patient.admitted
```

These events can be used to derive response and operational metrics.

## Requirements

-   No arbitrary hard-coded production-looking metrics.
-   Demo seed data may be used to create a realistic starting
    environment.
-   Calculated metrics should be traceable to underlying records/events.
-   Analytics should degrade gracefully if insufficient data exists.

------------------------------------------------------------------------

# 9.9 Module 9 --- Audit Trail & Export Engine

## Requirements

Track significant actions, including:

-   Authentication events
-   Patient creation
-   Patient updates
-   Triage changes
-   Inventory changes
-   Incident changes
-   Resource changes
-   Export operations
-   Administrative actions

## Audit Record Concepts

``` text
id
actorId
actorRole
action
entityType
entityId
timestamp
requestId
deviceId
metadata
```

## Rules

-   Audit records are append-only.
-   Normal application users cannot edit audit events.
-   Normal application users cannot delete audit events.
-   Audit records must identify who performed the action.
-   Sensitive information should not be unnecessarily duplicated into
    audit metadata.
-   Export operations themselves must be audited.

## Export

The system should support an appropriate structured export format such
as CSV and/or JSON depending on the final demo requirement.

------------------------------------------------------------------------

# 9.10 Module 10 --- Adaptive UI & Accessibility

Platform: Mobile + Web.

## Mobile

-   Large touch targets
-   High contrast
-   Scalable typography
-   Clear status indicators
-   Accessible labels
-   Minimal interaction steps for emergency workflows
-   Clear loading states
-   Clear error states
-   Support screen-reader semantics where practical

## Web

-   Responsive layout
-   Keyboard navigation
-   Accessible interactive controls
-   Readable tables
-   Responsive command dashboard
-   High contrast
-   Scalable UI
-   No dependence on color alone for status

Emergency states should use both color and text/iconography.

------------------------------------------------------------------------

# 10. Database Requirements

PostgreSQL is the system of record.

Expected domain areas include:

``` text
users
roles / role assignments
devices
patients
patient_observations
patient_media
incidents
incident_assignments
ambulances
locations
triage_assessments
triage_events
inventory_items
inventory_transactions
hospital_resources
notifications
device_tokens
audit_events
analytics/events
sync/idempotency records
```

Exact table names and relationships must be finalized during the
database design phase.

## Database Rules

-   UUIDs should be used for externally exposed entity identifiers.
-   Foreign keys must enforce valid relationships.
-   Appropriate indexes must be designed from actual query patterns.
-   Timestamps should be stored consistently.
-   Unique constraints should prevent duplicates.
-   Transactions must protect multi-record business operations.
-   Soft deletion should only be used where there is a clear domain
    reason.
-   Audit records must not be casually deleted.

------------------------------------------------------------------------

# 11. API Architecture

REST will be the primary request/response API.

Example base path:

``` text
/api/v1
```

Potential resources:

``` text
POST   /auth/session
GET    /users/me

GET    /patients
POST   /patients
GET    /patients/:id
PATCH  /patients/:id

POST   /patients/:id/observations
POST   /patients/:id/media

GET    /triage
POST   /triage
PATCH  /triage/:id

GET    /incidents
POST   /incidents
GET    /incidents/:id

GET    /inventory
POST   /inventory
PATCH  /inventory/:id

GET    /analytics/...
GET    /audit
POST   /audit/export
```

The exact contracts will be produced before implementation.

## API Requirements

Every endpoint must define:

-   Authentication requirement
-   Required role(s)
-   Request schema
-   Response schema
-   Validation
-   Error cases
-   Status codes
-   Idempotency behavior where applicable
-   Rate-limit expectations where applicable

------------------------------------------------------------------------

# 12. Error Handling

The backend must use centralized error handling.

Conceptually:

``` text
ValidationError
AuthenticationError
AuthorizationError
NotFoundError
ConflictError
RateLimitError
ExternalServiceError
DatabaseError
InternalServerError
```

Client responses should use consistent machine-readable error codes and
human-readable messages.

The mobile UI must never expose stack traces or internal implementation
details.

------------------------------------------------------------------------

# 13. Socket.IO Requirements

Socket.IO is used for live operational events, not as a replacement for
the database.

## Example Events

``` text
patient.created
patient.updated

triage.created
triage.updated

incident.created
incident.updated

ambulance.location.updated

inventory.created
inventory.updated

notification.created

resource.alert

sync.completed
```

## Rules

-   Socket connections require authentication.
-   Authorization must be checked before subscribing to protected data.
-   Rooms should be used for appropriate scopes.
-   Clients must reconnect safely.
-   Events should be idempotent or contain enough identifiers/version
    information for safe handling.
-   Critical persisted state must always exist in PostgreSQL.
-   Socket.IO is a delivery mechanism, not the source of truth.

------------------------------------------------------------------------

# 14. Offline Synchronization Specification

## States

An operation may move through states such as:

``` text
PENDING
SYNCING
SYNCED
FAILED
CONFLICT
```

## Requirements

-   Persist operations locally.
-   Retry transient failures.
-   Use exponential backoff with limits.
-   Avoid infinite aggressive retries.
-   Persist retry state across restarts.
-   Use idempotency keys.
-   Reconcile server state after conflicts.
-   Do not mark an operation synced until the server confirms successful
    processing.
-   Provide user-visible sync status where appropriate.

## Network Scenarios

The system must handle:

1.  No network during patient creation.
2.  Network restored.
3.  Server unavailable despite network connectivity.
4.  App killed during sync.
5.  Duplicate request after timeout.
6.  Two devices editing the same record.
7.  Media upload interrupted.
8.  Authentication token expiration during sync.

------------------------------------------------------------------------

# 15. Security Requirements

## Authentication

-   Firebase Phone OTP
-   Backend identity verification
-   Session management
-   Token expiry
-   Refresh-token rotation/revocation where implemented

## Authorization

Use server-side RBAC.

Example:

``` text
PARAMEDIC
TRIAGE_DOCTOR
SUPERINTENDENT
```

Least privilege must be enforced.

## API Security

-   HTTPS in deployed environments
-   Secure HTTP headers
-   CORS restrictions
-   Rate limiting
-   Request validation
-   Body-size limits
-   File-size limits
-   File MIME/type validation
-   Authentication middleware
-   Authorization middleware
-   Safe error responses

## Database Security

-   No database credentials in source code.
-   Environment variables/secrets management.
-   Restricted database permissions.
-   Parameterized/ORM queries.
-   Transactional mutations.
-   No direct client database access.

## File Security

Uploaded media must be validated.

Do not trust client-supplied filenames or MIME types alone.

## Logging

Do not log:

-   OTP codes
-   access tokens
-   refresh tokens
-   secrets
-   unnecessary patient-sensitive information

------------------------------------------------------------------------

# 16. Performance Requirements

The system should prioritize:

-   Small API payloads
-   Pagination for lists
-   Database indexes
-   Efficient queries
-   Selective Socket.IO updates
-   Throttled GPS updates
-   Image compression
-   Audio compression
-   Local reads for offline data
-   Lazy loading where appropriate
-   Avoidance of unnecessary React renders
-   Proper list virtualization
-   Efficient map marker updates
-   Redis for appropriate ephemeral/high-frequency data

Performance must be measured rather than assumed.

------------------------------------------------------------------------

# 17. Reliability & Resilience

The application must not crash merely because:

-   Internet disappears
-   Backend disappears
-   WebSocket disconnects
-   Push notifications fail
-   Media upload fails
-   API request times out
-   Token expires
-   A sync conflict occurs

The UI should communicate system state clearly.

Example:

``` text
ONLINE
OFFLINE
SYNCING
SYNCED
SYNC ERROR
CONFLICT
```

------------------------------------------------------------------------

# 18. Testing Strategy

## Unit Tests

Test:

-   Validation
-   START rules
-   Conflict resolution
-   Inventory calculations
-   Permission logic
-   Analytics calculations
-   Utility functions

## Integration Tests

Test:

-   Authentication flow
-   Patient creation
-   Triage
-   Inventory transactions
-   Audit generation
-   Synchronization
-   API/database interactions

## WebSocket Tests

Test:

-   Authentication
-   Room access
-   Event emission
-   Event reception
-   Reconnection
-   Unauthorized subscriptions

## Mobile Tests

Test:

-   Offline persistence
-   Outbox
-   Sync retry
-   Conflict states
-   Form validation
-   Accessibility labels
-   Critical navigation

## Failure Tests

Explicitly test:

``` text
Internet OFF
Server OFF
Redis OFF
Database unavailable
Expired token
Invalid OTP
Duplicate operation
Concurrent inventory update
Failed media upload
App restart during sync
```

------------------------------------------------------------------------

# 19. Observability

Backend should use structured logging.

Every request should have a request/correlation ID.

Important operational information should include:

-   request ID
-   endpoint
-   status
-   duration
-   user/role identifier where appropriate
-   error category
-   external-service failure
-   sync operation ID

Sensitive data must not be logged.

------------------------------------------------------------------------

# 20. Configuration and Environment Management

Environments:

``` text
development
test
demo
```

Configuration must come from environment variables/secrets.

Examples:

``` text
DATABASE_URL
REDIS_URL
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
MAPBOX_TOKEN
JWT_SECRET
STORAGE_CONFIGURATION
```

Actual secrets must never be committed to Git.

Provide:

``` text
.env.example
```

with placeholders only.

------------------------------------------------------------------------

# 21. CI/CD and Code Quality

The repository should eventually include automated checks for:

-   TypeScript compilation
-   ESLint
-   Formatting
-   Unit tests
-   Integration tests
-   Build validation
-   Prisma validation/migrations
-   Dependency/security checks where practical

A pull request should not be considered complete if it introduces:

-   TypeScript errors
-   lint errors
-   failing tests
-   broken builds

------------------------------------------------------------------------

# 22. Development Phases

Development must proceed in controlled phases.

## Phase 0 --- Requirements Freeze

Deliverables:

-   Approved SRS
-   Technology stack
-   Roles
-   Scope
-   Assumptions
-   Non-goals
-   Demo requirements

No feature coding yet.

------------------------------------------------------------------------

## Phase 1 --- Architecture

Deliverables:

-   System architecture diagram
-   Module boundaries
-   Data-flow diagrams
-   Authentication architecture
-   Offline architecture
-   Real-time architecture
-   Media architecture
-   Security boundaries

------------------------------------------------------------------------

## Phase 2 --- Monorepo Foundation

Deliverables:

-   pnpm workspace
-   mobile application
-   web application
-   API application
-   shared packages
-   TypeScript strict configuration
-   ESLint
-   Prettier
-   environment configuration
-   base CI checks

------------------------------------------------------------------------

## Phase 3 --- Database Design

Deliverables:

-   ERD
-   Prisma schema
-   indexes
-   constraints
-   migrations
-   seed strategy
-   demo data strategy

No UI-dependent implementation should proceed until the core data model
is stable.

------------------------------------------------------------------------

## Phase 4 --- Backend Foundation

Deliverables:

-   Express application
-   middleware
-   validation
-   error handling
-   logging
-   authentication verification
-   RBAC
-   health endpoint
-   database connection
-   Redis connection
-   API versioning

------------------------------------------------------------------------

## Phase 5 --- Authentication

Deliverables:

-   Firebase OTP
-   backend identity verification
-   user provisioning
-   roles
-   session handling
-   secure mobile token storage
-   protected API
-   protected Socket.IO connection

------------------------------------------------------------------------

## Phase 6 --- Patient Domain

Deliverables:

-   Patient model
-   Patient APIs
-   Patient intake
-   vitals
-   observations
-   audit events
-   mobile patient screens

------------------------------------------------------------------------

## Phase 7 --- Offline-First Engine

Deliverables:

-   SQLite schema
-   repository layer
-   local writes
-   outbox
-   sync engine
-   connectivity handling
-   idempotency
-   retry policy
-   conflict states
-   synchronization UI

This phase must be tested heavily before building dependent features.

------------------------------------------------------------------------

## Phase 8 --- Multimedia

Deliverables:

-   camera
-   image compression
-   local media queue
-   Firebase Storage
-   audio recording
-   audio upload
-   upload progress/retry
-   media metadata

------------------------------------------------------------------------

## Phase 9 --- START Triage

Deliverables:

-   START workflow
-   assessment model
-   transparent rules
-   triage result
-   triage history
-   priority queue
-   status matrix

------------------------------------------------------------------------

## Phase 10 --- Real-Time Infrastructure

Deliverables:

-   Socket.IO server
-   authentication
-   rooms
-   event contracts
-   reconnect behavior
-   live patient updates
-   triage updates

------------------------------------------------------------------------

## Phase 11 --- Map & Routing

Deliverables:

-   Mapbox integration
-   incident markers
-   hospital markers
-   ambulance location
-   live updates
-   route visualization
-   location throttling
-   map permissions

------------------------------------------------------------------------

## Phase 12 --- Inventory

Deliverables:

-   beds
-   oxygen
-   medications
-   CRUD
-   transactions
-   optimistic concurrency
-   conflict UI
-   Socket.IO updates
-   audit events

------------------------------------------------------------------------

## Phase 13 --- Notifications

Deliverables:

-   FCM registration
-   device token management
-   priority categories
-   backend-triggered notifications
-   notification deep links
-   notification handling

------------------------------------------------------------------------

## Phase 14 --- Analytics

Deliverables:

-   event-derived metrics
-   ER load
-   response times
-   staff distribution
-   resource utilization
-   charts
-   empty/error states

------------------------------------------------------------------------

## Phase 15 --- Audit & Export

Deliverables:

-   audit event pipeline
-   immutable audit storage
-   filtering
-   pagination
-   export
-   export audit events

------------------------------------------------------------------------

## Phase 16 --- Web Command Center

Deliverables:

-   authentication
-   dashboard
-   live map
-   resource inventory
-   real-time updates
-   responsive layout
-   accessibility

Only the modules specified as Both need to be exposed on the web
initially:

-   Map & Routing
-   Resource Inventory
-   Adaptive UI/Accessibility

------------------------------------------------------------------------

## Phase 17 --- Accessibility & UX Hardening

Deliverables:

-   touch target review
-   typography
-   contrast
-   keyboard navigation
-   screen-reader semantics
-   loading states
-   error states
-   empty states
-   offline states
-   responsive testing

------------------------------------------------------------------------

## Phase 18 --- Security Hardening

Perform a dedicated review for:

-   authorization bypass
-   insecure storage
-   token leakage
-   IDOR
-   injection
-   file upload abuse
-   rate-limit bypass
-   WebSocket authorization
-   CORS
-   secrets
-   excessive data exposure
-   audit integrity

------------------------------------------------------------------------

## Phase 19 --- Performance Hardening

Measure:

-   API latency
-   database query performance
-   list rendering
-   map performance
-   Socket.IO traffic
-   synchronization performance
-   image upload behavior
-   application startup
-   memory usage

Optimize based on measurements.

------------------------------------------------------------------------

## Phase 20 --- End-to-End Integration

Run the complete workflow:

``` text
Incident
 ↓
Paramedic
 ↓
Patient creation
 ↓
Offline mode
 ↓
START triage
 ↓
Reconnect
 ↓
Synchronization
 ↓
Doctor receives update
 ↓
Ambulance/map update
 ↓
Hospital resource update
 ↓
Critical notification
 ↓
Analytics
 ↓
Audit
 ↓
Export
```

------------------------------------------------------------------------

## Phase 21 --- Failure/Chaos Testing

Simulate:

-   internet loss
-   server loss
-   WebSocket loss
-   Redis failure
-   database failure
-   expired authentication
-   duplicate requests
-   concurrent edits
-   interrupted media uploads
-   app restart
-   partial synchronization

The application must degrade gracefully.

------------------------------------------------------------------------

## Phase 22 --- Demo Preparation

Prepare:

-   Demo accounts
-   Demo patients
-   Demo incidents
-   Demo inventory
-   Demo hospital
-   Demo ambulances
-   predictable map scenario
-   notification scenario
-   offline scenario
-   conflict scenario
-   analytics data

The demo must be repeatable.

------------------------------------------------------------------------

## Phase 23 --- Technical Defense Preparation

The team must be able to explain:

-   Why React Native + Expo?
-   Why TypeScript?
-   Why Express?
-   Why PostgreSQL?
-   Why Redis?
-   Why Socket.IO?
-   Why SQLite?
-   Why Zustand/TanStack Query?
-   Why offline-first?
-   How conflict resolution works?
-   How concurrent inventory editing works?
-   How RBAC works?
-   How OTP authentication works?
-   How media security works?
-   How WebSockets work?
-   How analytics are generated?
-   How audit records are protected?
-   What happens when the server disappears?
-   What happens when two users edit the same record?
-   What happens when the app closes during synchronization?

------------------------------------------------------------------------

# 23. Critical Demo Scenario

The preferred final demonstration should connect the system instead of
showing disconnected screens.

## Scenario

1.  A paramedic logs in using OTP.
2.  A new emergency incident is opened.
3.  The paramedic creates a patient.
4.  The patient receives vitals.
5.  The paramedic performs the START assessment.
6.  The patient receives a triage category.
7.  The phone loses internet.
8.  Additional patient information is captured offline.
9.  A photograph/audio note is captured.
10. The data remains available locally.
11. Connectivity returns.
12. The sync engine uploads queued operations.
13. The triage doctor sees the patient update in real time.
14. The ambulance location appears on the map.
15. The hospital superintendent sees the incident on the web command
    center.
16. A hospital resource is consumed.
17. Inventory updates.
18. Another client simultaneously attempts a conflicting inventory
    update.
19. The system detects the stale version.
20. The conflict is handled without silently overwriting data.
21. A critical notification is sent.
22. Analytics update from recorded events.
23. The complete sequence appears in the audit trail.
24. Audit data is exported.

This scenario demonstrates integration across the ten required modules.

------------------------------------------------------------------------

# 24. Acceptance Criteria

The project is considered functionally complete when:

-   All ten required modules are implemented.
-   The three Both modules function on mobile and web.
-   Authentication works with OTP.
-   Unauthorized roles cannot perform restricted actions.
-   Patient intake works offline.
-   Offline data survives app restart.
-   Synchronization works after reconnection.
-   Duplicate sync operations do not duplicate data.
-   Conflicts are detected.
-   Inventory concurrent edits are protected.
-   Map displays relevant operational data.
-   Location updates work in real time.
-   Multimedia capture/upload works.
-   Push notifications work in supported demo environments.
-   Triage workflow produces transparent results.
-   Analytics use actual application data/events.
-   Audit records are immutable to normal users.
-   Export works.
-   UI is responsive and accessibility-focused.
-   Critical failure scenarios do not crash the application.
-   TypeScript/lint/test/build checks pass.
-   No secrets are committed.
-   Demo workflow can be repeated reliably.

------------------------------------------------------------------------

# 25. Definition of Done

A feature is not considered complete merely because its UI exists.

A feature is complete only when:

``` text
Requirement
   ↓
Domain model
   ↓
API
   ↓
Validation
   ↓
Authorization
   ↓
Database
   ↓
Error handling
   ↓
Audit
   ↓
Real-time behavior where required
   ↓
Offline behavior where required
   ↓
Tests
   ↓
UI
   ↓
Accessibility
   ↓
Documentation
```

------------------------------------------------------------------------

# 26. Documentation Deliverables

The project should contain:

``` text
README.md
SRS.md
ARCHITECTURE.md
DATABASE.md
API.md
SECURITY.md
OFFLINE_SYNC.md
SOCKET_EVENTS.md
DEMO_GUIDE.md
```

The README should include setup instructions without exposing secrets.

------------------------------------------------------------------------

# 27. Project Risks

## Risk: Offline conflicts

Mitigation:

-   entity-specific conflict policies
-   versioning
-   idempotency
-   append-only events where appropriate

## Risk: Real-time instability

Mitigation:

-   Socket.IO reconnect
-   persisted source of truth
-   event identifiers
-   resynchronization after reconnect

## Risk: Large media files

Mitigation:

-   compression
-   size limits
-   upload retry
-   object storage

## Risk: Concurrent inventory edits

Mitigation:

-   optimistic concurrency
-   database transactions
-   version checks

## Risk: Demo network failure

Mitigation:

-   offline-first mobile
-   local data
-   graceful degradation
-   predictable demo seed data

## Risk: Scope explosion

Mitigation:

-   strict SRS
-   phased implementation
-   avoid unnecessary features
-   prioritize required rubric modules

------------------------------------------------------------------------

# 28. Final Architecture Principle

MedFlow must be designed as one system, not ten unrelated assignments.

The central integration model is:

``` text
                    INCIDENT
                       |
                 PATIENT CREATED
                       |
                  TRIAGE EVENT
                  /          \
             NOTIFY         ANALYTICS
                |               |
             DOCTOR          METRICS
                |
            RESOURCE NEED
                |
            INVENTORY
                |
              MAP
                |
           OPERATIONS
                |
              AUDIT
```

The database remains the persistent source of truth.

Socket.IO provides real-time delivery.

Redis supports appropriate ephemeral/high-frequency state and
coordination.

SQLite provides mobile offline persistence.

The outbox provides reliable synchronization.

Firebase provides OTP/FCM/storage services.

Mapbox provides geographic visualization and routing.

The architecture must remain understandable enough for the team to
explain and defend during judging.

------------------------------------------------------------------------

# 29. Implementation Gate

Before Phase 2 implementation begins, the following artifacts must be
approved:

-   SRS
-   architecture diagram
-   module boundaries
-   ERD
-   database schema
-   API contract
-   Socket.IO event contract
-   offline synchronization specification
-   conflict-resolution matrix
-   authorization matrix
-   security checklist
-   development roadmap

**No feature implementation should begin before these artifacts are
finalized.**
