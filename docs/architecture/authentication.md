# MedFlow Architecture: Authentication, Session Management & RBAC

**Document Type:** Architectural Specification  
**Phase:** Phase 5 — Authentication, Session Management & Role-Based Access Control  
**Module:** Core Identity & Access Control Architecture  
**Status:** Approved Implementation Baseline  

---

## 1. Architectural Overview & Boundaries

Phase 5 establishes the security and session gateway for MedFlow. It sits directly behind the HTTP reverse proxy / load balancer and governs access to all versioned API routes (`/api/v1/*`) and future real-time WebSocket channels.

```mermaid
flowchart TD
    Client["Client (React Native Mobile / React Web)"]
    
    subgraph Identity_Provider["External Identity Provider"]
        Firebase["Firebase Phone Authentication (SMS OTP)"]
    end
    
    subgraph MedFlow_API["Express Backend Architecture (apps/api)"]
        RateLimit["auth.rate-limiter.ts (Redis Sliding Window / Memory Fallback)"]
        Router["auth.routes.ts (/api/v1/auth/*)"]
        Controller["auth.controller.ts (DTO Translation)"]
        AuthSvc["auth.service.ts (Core Auth Logic)"]
        TokenSvc["token.service.ts (JWT & Hashing)"]
        RefreshSvc["refresh-token.service.ts (Session Lifecycle)"]
        FBVerif["firebase-auth.service.ts (Admin SDK ID Token Verifier)"]
        AuthMW["auth.middleware.ts (requireAuthentication, requireRole)"]
    end
    
    subgraph Data_Layer["Persistent Storage (Phase 3 Schema)"]
        PG_Users[("users table")]
        PG_Devices[("devices table")]
        PG_Tokens[("refresh_tokens table")]
    end
    
    Client -->|"1. Phone OTP"| Firebase
    Firebase -->|"2. Firebase ID Token"| Client
    Client -->|"3. POST /auth/session"| RateLimit
    RateLimit --> Router --> Controller --> AuthSvc
    
    AuthSvc --> FBVerif
    AuthSvc --> TokenSvc
    AuthSvc --> RefreshSvc
    
    AuthSvc -->|"Lookup Role / Status"| PG_Users
    AuthSvc -->|"Upsert Device"| PG_Devices
    RefreshSvc -->|"Insert Hashed Token"| PG_Tokens
    
    AuthMW -.->|"Guards Protected Endpoints"| TokenSvc
    AuthMW -.->|"Validates Active Session"| PG_Tokens
    AuthMW -.->|"Enforces Role Authority"| PG_Users
```

---

## 2. Token Lifecycle & Session State Machine

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated
    
    Unauthenticated --> FirebaseVerified: SMS OTP Verification
    FirebaseVerified --> ActiveSession: POST /auth/session (Valid Pre-Provisioned User)
    FirebaseVerified --> Forbidden: Unprovisioned or Inactive User
    
    state ActiveSession {
        [*] --> ValidTokens
        ValidTokens --> ValidTokens: Normal Authenticated Requests (15m JWT)
        ValidTokens --> Rotated: POST /auth/refresh (Within 7d)
        Rotated --> ValidTokens: New Token Pair Issued (Previous Token Revoked)
    }
    
    ActiveSession --> Expired: Past 7 Days without Refresh
    ActiveSession --> Revoked: POST /auth/logout or /auth/logout-all
    ActiveSession --> Compromised: Revoked Token Presented (Replay Attack)
    
    Compromised --> Revoked: Family Revocation (All user sessions revoked)
    Expired --> Unauthenticated
    Revoked --> Unauthenticated
```

---

## 3. Database Model & Relationship Preservation

Phase 5 strictly utilizes the approved Phase 3 Prisma schema without modification:

1. **`users` Table:**
   - Authoritative source for `role` (`PARAMEDIC`, `TRIAGE_DOCTOR`, `HOSPITAL_SUPERINTENDENT`).
   - Validates account status via `status` (`ACTIVE`, `INACTIVE`, `SUSPENDED`) and `deletedAt`.
   - Links to external provider via unique `firebaseUid`.
2. **`devices` Table:**
   - Tracks client installation platform (`IOS`, `ANDROID`, `WEB`), application version (`appVersion`), and push notification tokens (`pushToken`).
   - Updates `lastActiveAt` upon session establishment and token rotation.
3. **`refresh_tokens` Table:**
   - Stores only `hashedToken` (`VarChar(128)` unique SHA-256 hash).
   - Foreign key `device_id` references `devices.id` with `onDelete: SetNull`.
   - Foreign key `user_id` references `users.id` with `onDelete: Cascade`.
   - Manages expiration (`expiresAt`) and revocation (`revokedAt`).

---

## 4. RBAC Authorization Pipeline

Protected endpoints utilize composable Express middleware functions:

```typescript
// Example: Paramedic Field Intake Endpoint
apiV1Router.post(
  '/patients',
  requireAuthentication,
  requireRole(UserRole.PARAMEDIC),
  patientController.createIntake
);

// Example: Triage Evaluation Endpoint
apiV1Router.post(
  '/triage',
  requireAuthentication,
  requireRoles([UserRole.PARAMEDIC, UserRole.TRIAGE_DOCTOR]),
  triageController.evaluate
);

// Example: Hospital Command Center Incident Management
apiV1Router.post(
  '/incidents',
  requireAuthentication,
  requireRole(UserRole.HOSPITAL_SUPERINTENDENT),
  incidentController.createIncident
);
```

### Execution Order:
1. `requireAuthentication`:
   - Validates format: `Authorization: Bearer <token>`.
   - Cryptographically verifies JWT signature and expiration using `TokenService`.
   - Verifies the underlying database session has not been revoked (`RefreshTokenService.isSessionActive`).
   - Fetches the user from PostgreSQL to verify active status and obtain their authoritative role.
   - Populates `req.auth` and `req.user`.
2. `requireRole(role)` / `requireRoles(roles)`:
   - Evaluates `req.auth.role`.
   - If unauthorized, immediately halts execution with HTTP 403 `AUTH_ROLE_REQUIRED`.

---

## 5. Architectural Compliance Matrix

| Rule | Requirement | Phase 5 Status | Implementation Evidence |
| :--- | :--- | :--- | :--- |
| **No Passwords** | Primary auth via phone OTP | COMPLETE | `FirebaseAuthService.verifyIdToken` |
| **Short-Lived Access** | 15-minute access JWT | COMPLETE | `TokenService.signAccessToken` (expiresIn: 900s) |
| **Hashed Persistence** | Refresh tokens never plaintext | COMPLETE | `TokenService.hashRefreshToken` (SHA-256) |
| **Replay Defense** | Reuse of revoked token triggers family revocation | COMPLETE | `RefreshTokenService.rotateRefreshToken` |
| **Zero Client Trust** | Role derived strictly from DB | COMPLETE | `AuthService.establishSession`, `requireAuthentication` |
| **Rate Limiting** | Auth endpoints abuse protection | COMPLETE | `createAuthRateLimiter` (Redis + In-memory fallback) |
| **Logging Redaction** | Blacklist auth headers & tokens | COMPLETE | `common/logging/logger.ts` redact rules |
| **Schema Integrity** | 18 tables preserved | COMPLETE | 0 changes to `prisma/schema.prisma` |
| **No Domain Logic** | No patient, triage, inventory domain code | COMPLETE | Isolated to `src/modules/auth/*` |
