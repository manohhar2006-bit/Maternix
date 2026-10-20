# Maternix Remediation Report

## 1. Executive Summary

A comprehensive security audit, vulnerability remediation, and AWS deployment readiness preparation was conducted on the **Maternix Maternal and Infant Health Management Platform**. 

Prior to remediation, the codebase suffered from critical security vulnerabilities that precluded any safe network or cloud deployment:
1. Hardcoded cloud database credentials (`SUPABASE_URL` and `SUPABASE_ANON_KEY`) in server code.
2. Hardcoded `http://localhost:3000` API endpoints across all frontend client scripts.
3. Plaintext password storage and plain string equality comparisons without password hashing.
4. Total absence of server-side authentication, session verification, or role-based access control.
5. Insecure client-side authorization relying entirely on editable browser `localStorage`.
6. Zero cross-patient access controls (any user could query any mother's vitals, medical records, appointments, and infant data).
7. Unauthenticated doctor endpoints allowing any anonymous client to view the complete patient roster and forge medical prescriptions.
8. Unsafe, silent in-memory mock-data fallbacks that masqueraded as successful database writes when database queries failed.
9. Missing health-check endpoints, security headers, rate limiting, and request ID tracking necessary for an Application Load Balancer and Auto Scaling.
10. Disabled Row Level Security (RLS) on all database tables.

All source code defects within the repository have been systematically repaired. A complete Node.js/Express security architecture was engineered featuring **bcrypt password hashing**, **JWT authentication via HttpOnly cookies and Bearer tokens**, **strict role and patient-ownership authorization middleware**, **rate limiting**, **Helmet HTTP security headers**, **graceful shutdown**, and **structured JSON logging**. All frontend pages were refactored to use same-origin relative API paths with session verification. An automated 24-test integration and regression suite was created and executed, achieving **100% pass rate (24/24 passed, 0 failed)**.

A production-ready database migration script (`backend/migrations/01_security_and_rls.sql`) and a comprehensive AWS architectural guide (`AWS_DEPLOYMENT_READINESS.md`) have been added.

---

## 2. Problems Found

| # | Problem | Location | Severity | Impact | Confirmed in Code |
|---|---|---|---|---|---|
| 1 | **Hardcoded Supabase Credentials** | `backend/server.js:20-22` | Critical | Exposed database URL and anonymous JWT token in version control. Allowed direct query access if RLS was disabled. | Yes |
| 2 | **Hardcoded `localhost:3000` API URLs** | `frontend/login.html`, `dashboard.html`, `doctor-dashboard.html`, `questionnaire.html` | High | External visitors on deployed environments fail to load data because browsers query their own local machines. | Yes |
| 3 | **Plaintext Password Storage & Matching** | `backend/server.js:57,91,118`, `frontend/login.html:594,605,789` | Critical | Passwords stored without hashing; plaintext string comparison in SQL queries and mock arrays; passwords stored in browser `localStorage`. | Yes |
| 4 | **Missing Server Authentication & Authorization** | `backend/server.js:46-240` | Critical | Endpoints did not issue or verify tokens or cookies. Anyone could execute endpoints without logging in. | Yes |
| 5 | **Missing Patient Data Isolation (IDOR)** | `backend/server.js:150-191` (`GET /api/dashboard/:motherId`) | Critical | Any mother could view full medical records, vitals, prescriptions, and infant data of any other mother by changing the URL parameter. | Yes |
| 6 | **Unprotected Doctor Endpoints** | `backend/server.js:194-240` (`/api/doctor/*`) | Critical | Unauthenticated clients could view the entire patient registry and forge medical prescriptions without doctor credentials. | Yes |
| 7 | **Disabled Row Level Security (RLS)** | `backend/schema.sql:255-264` | High | All 10 database tables had RLS explicitly disabled, allowing any client with the anon key to bypass backend logic. | Yes |
| 8 | **Unsafe Silent Mock-Data Fallbacks** | `backend/server.js:73,101,128,181,233` | High | Database failures were silently swallowed, returning in-memory mock records and claiming saves succeeded when data was lost. | Yes |
| 9 | **Wildcard CORS Middleware** | `backend/server.js:10` (`app.use(cors())`) | Medium | Permitted arbitrary third-party origins to make cross-origin requests. | Yes |
| 10 | **Missing Health Probes & Monitoring** | `backend/server.js` | Medium | ALB target groups could not evaluate instance health, preventing auto-healing and zero-downtime rolling updates. | Yes |
| 11 | **Unstructured Logging & Error Exposure** | `backend/server.js` | Low | Unstructured `console.warn` calls; potential leakage of internal error stacks in production responses. | Yes |
| 12 | **Vulnerable Outdated Transitive Packages** | `backend/package.json` | High | `proxy-addr` (critical IP spoofing), `ws` (high memory DoS), `qs`, `body-parser`. | Yes |

---

## 3. Changes Implemented

### 1. Backend Server Modernization & Hardening (`backend/server.js`)
- **Environment Configuration**: Integrated `dotenv` to load configuration from root `.env` or local files. Validates required environment variables (`JWT_SECRET`, `NODE_ENV`, `PORT`) at startup and exits with a clear fatal error if insecure defaults are used in production.
- **Removed Hardcoded Credentials**: Eliminated hardcoded `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Credentials are now injected via `process.env`.
- **Password Hashing (bcrypt)**: Implemented `bcryptjs` with 10 salt rounds for all new user registrations. Passwords in in-memory fallback datasets are also hashed.
- **Legacy Password Auto-Migration**: Built `verifyAndUpgradePassword()` to seamlessly detect legacy plaintext passwords upon login, verify them, upgrade them to a bcrypt hash, and persist the new hash without breaking existing user accounts.
- **JWT & Cookie Authentication**: Generated signed JSON Web Tokens (24h lifespan). Tokens are issued via secure, HttpOnly, SameSite=Lax cookies, and returned in JSON payloads for Bearer header support.
- **Role-Based Authorization & Ownership Guard**:
  - Middleware `authenticate`: Validates JWT from cookie or Bearer header; rejects unauthenticated requests with 401.
  - Middleware `requireRole('doctor')`: Restricts `/api/doctor/patients` and `/api/doctor/prescription` to verified doctors only; rejects non-doctors with 403.
  - Ownership Check: Verified that mothers can only query their own dashboard (`req.user.id === motherId`) and update their own questionnaire; rejects cross-patient queries with 403.
- **Sanitized API Responses**: Removed `password` properties from all user, doctor, and patient roster payloads.
- **Mock Fallback Isolation**: In production (`NODE_ENV === 'production'`), mock data fallbacks are completely disabled. Database errors return HTTP 503 Service Unavailable. Mock data is permitted only in non-production when `ENABLE_MOCK_FALLBACK=true` is explicitly set.
- **ALB Health Endpoints**:
  - `GET /health`: Lightweight liveness check returning HTTP 200 `{ status: 'healthy', uptime }`.
  - `GET /health/ready`: Readiness check testing database connectivity.
- **HTTP Security Headers & Protection**:
  - Added `helmet` with CSP disabled for CDN compatibility.
  - Added `express-rate-limit` (20 attempts / 15 minutes) on authentication routes.
  - Added request body size limits (`50kb`).
  - Added configurable CORS origins (`FRONTEND_ORIGIN`).
  - Added structured JSON logging with unique correlation UUIDs (`X-Request-Id`).
  - Implemented graceful shutdown handlers for `SIGTERM` and `SIGINT`.

### 2. Frontend API Configuration & Client Security
- **`frontend/login.html`**:
  - Replaced hardcoded `http://localhost:3000/api/...` with dynamic relative paths `${API_BASE}/api/...`.
  - Configured `credentials: 'include'` on all authentication fetch requests.
  - Removed plaintext passwords from `localStorage` (`maternixDB` and `currentUser`).
  - Stored `authToken` and sanitized user profile upon successful login.
- **`frontend/dashboard.html`**:
  - Replaced hardcoded URL with `${API_BASE}/api/dashboard/${motherId}`.
  - Added server-side session verification via `GET /api/auth/me` on initialization; redirects to login if unauthenticated.
  - Added `Authorization: Bearer <token>` and `credentials: 'include'` to data fetches.
  - Updated `logout()` to call `POST /api/auth/logout` to clear server cookies, clean up `localStorage`, and redirect.
- **`frontend/doctor-dashboard.html`**:
  - Replaced hardcoded URLs for patient retrieval and prescription submission.
  - Added session and role verification (`GET /api/auth/me`) on load; redirects non-doctors.
  - Attached authentication credentials and token headers to all doctor requests.
  - Updated `logout()` to invoke server-side logout.
- **`frontend/questionnaire.html`**:
  - Replaced hardcoded endpoint with `${API_BASE}/api/questionnaire`.
  - Added server session verification on initialization.
  - Attached authentication token to form submission.

### 3. Database Security & Migrations (`backend/migrations/01_security_and_rls.sql`)
- Created a production-grade SQL migration draft that:
  - Adds missing `password`, `created_at`, and `updated_at` columns to `mothers` and `doctors`.
  - Enables Row Level Security (RLS) on all 10 platform tables.
  - Configures full access policies for the trusted backend `service_role`.
  - Configures least-privilege policies denying direct anonymous access to sensitive tables while permitting public read access to the hospital directory.
  - Documents emergency rollback queries.

### 4. Configuration, Tooling & Dependency Updates
- Created `.gitignore` preventing accidental commits of `.env`, `node_modules`, logs, or OS files.
- Created `.env.example` with clear parameter documentation and safe placeholders.
- Created local `.env` for development testing.
- Fixed 4 outdated transitive vulnerabilities in `backend/` via `npm audit fix` (0 vulnerabilities remaining).
- Synchronized dependencies across root `package.json` and `backend/package.json`.
- Added `"test": "node test/suite.js"` to npm scripts.
- Created `test/suite.js` covering 24 automated integration and security test cases.
- Created `AWS_DEPLOYMENT_READINESS.md` detailing ALB, Auto Scaling, Launch Templates, CloudWatch, CloudTrail, IAM, and Systems Manager configurations.

---

## 4. Authentication and Database Security

### New Authentication Architecture
```
[Client Browser]
       │
       │ POST /api/auth/login-mother { username, pwd }
       ▼
[Express Backend]
       │
       ├─► 1. Rate Limiting Check (20 req / 15m)
       ├─► 2. Query user record from Supabase / Mock
       ├─► 3. Compare password with bcrypt (or migrate legacy plaintext)
       ├─► 4. Generate JWT signed with JWT_SECRET (24h expiry)
       │      Payload: { id, role: 'mother', username }
       ├─► 5. Set HttpOnly, Secure-in-prod, SameSite=Lax cookie: 'token'
       │
       ▼ Returns HTTP 200 { token, user: { id, firstName, email, ... } }
[Client Browser]
       │ Stored in memory & cookie; token in localStorage for Bearer fallback
```

### Authorization Controls Implemented
1. **Unauthenticated Request Blocking**: Requests lacking a valid JWT cookie or Bearer token receive `401 Unauthorized`.
2. **Mother-to-Mother Isolation (Anti-IDOR)**: On `GET /api/dashboard/:motherId` and `POST /api/questionnaire`, the backend verifies that `parseInt(req.user.id) === parseInt(motherId)`. If a mother attempts to supply another mother's ID, the request is rejected with `403 Forbidden`.
3. **Doctor-Only Enforcement**: Endpoints `/api/doctor/patients` and `/api/doctor/prescription` check `req.user.role === 'doctor'`. Mothers or unauthenticated callers receive `403 Forbidden`.

### Password Hashing Behavior
- Algorithm: **Bcrypt** with cost factor 10.
- Legacy Plaintext Migration: If an account has a plaintext password stored from previous iterations, the server verifies the plaintext match once upon successful login, hashes it with bcrypt, updates the database record, and issues an authenticated session.
- Responses never include password fields.

### Row Level Security (RLS) Status
- **Current Live DB State**: RLS remains disabled on the existing remote Supabase instance until an authorized database operator applies the migration.
- **Migration Ready**: `backend/migrations/01_security_and_rls.sql` has been drafted and validated.
- **Backend Access Model**: In production, the backend server must be configured with `SUPABASE_SERVICE_ROLE_KEY` to query tables as a trusted policy enforcement point.

---

## 5. Frontend and API Fixes

All frontend files have been refactored to use dynamic, same-origin relative URLs:

| File | Previous Code | Remediated Code |
|---|---|---|
| `frontend/login.html:695` | `fetch('http://localhost:3000/api/auth/login-mother', ...)` | `fetch(`${API_BASE}/api/auth/login-mother`, ...)` |
| `frontend/login.html:799` | `fetch('http://localhost:3000/api/auth/signup', ...)` | `fetch(`${API_BASE}/api/auth/signup`, ...)` |
| `frontend/login.html:851` | `fetch('http://localhost:3000/api/auth/login-doctor', ...)` | `fetch(`${API_BASE}/api/auth/login-doctor`, ...)` |
| `frontend/dashboard.html:1179` | `fetch(`http://localhost:3000/api/dashboard/${motherId}`)` | `fetch(`${API_BASE}/api/dashboard/${motherId}`, ...)` |
| `frontend/doctor-dashboard.html:686` | `fetch('http://localhost:3000/api/doctor/patients')` | `fetch(`${API_BASE}/api/doctor/patients`, ...)` |
| `frontend/doctor-dashboard.html:878` | `fetch('http://localhost:3000/api/doctor/prescription', ...)` | `fetch(`${API_BASE}/api/doctor/prescription`, ...)` |
| `frontend/questionnaire.html:738` | `fetch('http://localhost:3000/api/questionnaire', ...)` | `fetch(`${API_BASE}/api/questionnaire`, ...)` |

Every fetch call specifies `credentials: 'include'` and sends an `Authorization: Bearer <token>` header if available in `localStorage`.

---

## 6. Error Handling, Logging and Health Checks

1. **Health Checks**:
   - `GET /health`: Returns `{ status: 'healthy', uptime, timestamp }` with HTTP 200. Used by the ALB Target Group.
   - `GET /health/ready`: Probes the database layer. Returns HTTP 200 when connected, HTTP 503 when disconnected in production.
2. **Centralized Error Handling**: Express error middleware intercepts unhandled exceptions. In production (`NODE_ENV=production`), generic user-facing messages are returned (`"An unexpected error occurred"`), preventing stack trace leakage.
3. **Structured Logging**: Requests and system events are logged with timestamps, log levels, request paths, HTTP status codes, execution durations, and correlation UUIDs (`X-Request-Id`). Passwords, authentication tokens, and patient PII are strictly excluded from logs.

---

## 7. AWS Deployment Readiness

A complete AWS deployment specification is documented in `AWS_DEPLOYMENT_READINESS.md`:
- **EC2 Auto Scaling Group**: Minimum 2 instances across 2 Availability Zones in private subnets.
- **Application Load Balancer (ALB)**: Public-facing ALB with ACM TLS certificate terminating HTTPS on port 443; HTTP port 80 redirects to HTTPS.
- **Target Group**: Targets instances on port 3000; health check configured on `/health`.
- **Launch Template**: Automated user-data script installing Node.js 20, PM2, CloudWatch Agent, and pulling configuration from AWS Secrets Manager.
- **AWS Secrets Manager**: Recommended for storing `JWT_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
- **Amazon CloudWatch**: Collects PM2 stdout/stderr logs and infrastructure metrics. Alarms configured for target 5xx counts and high latency.
- **AWS Systems Manager (SSM)**: Enables secure console access without open port 22 (SSH).
- **AWS CloudTrail**: Multi-region trail auditing AWS API and administrative activity.

---

## 8. Tests and Verification

All 24 automated tests executed via `npm test` passed:

| Test Description | Category | Result | Evidence / Notes |
|---|---|---|---|
| `GET /health` liveness probe | Health Check | **PASS** | HTTP 200, `{ status: 'healthy' }` |
| `GET /health/ready` readiness probe | Health Check | **PASS** | HTTP 200, `{ status: 'ready' }` |
| Mother registration with valid data | Authentication | **PASS** | HTTP 201, token generated, password not in response |
| Mother registration rejects short password | Validation | **PASS** | HTTP 400, rejected password < 8 chars |
| Second mother registration | Setup | **PASS** | HTTP 201, separate identity created |
| Mother login with valid credentials | Authentication | **PASS** | HTTP 200, token generated, password sanitized |
| Mother login fails on incorrect password | Authentication | **PASS** | HTTP 401, generic error message returned |
| Doctor login with valid credentials | Authentication | **PASS** | HTTP 200, doctor token generated, password sanitized |
| Doctor login fails on incorrect password | Authentication | **PASS** | HTTP 401, generic error message returned |
| Bcrypt password hashing format and match | Password Security | **PASS** | Matches `$2b$` format; plaintext mismatch verified |
| Unauthenticated `GET /api/dashboard/:id` | Authorization | **PASS** | HTTP 401 Unauthorized |
| Unauthenticated `POST /api/questionnaire` | Authorization | **PASS** | HTTP 401 Unauthorized |
| Unauthenticated `GET /api/doctor/patients` | Authorization | **PASS** | HTTP 401 Unauthorized |
| Unauthenticated `POST /api/doctor/prescription` | Authorization | **PASS** | HTTP 401 Unauthorized |
| Cross-patient isolation: Mother 1 -> Mother 2 dashboard | Access Control (IDOR) | **PASS** | HTTP 403 Forbidden |
| Cross-patient isolation: Mother 1 -> Mother 2 questionnaire | Access Control (IDOR) | **PASS** | HTTP 403 Forbidden |
| Role enforcement: Mother cannot view doctor patient roster | Role Authorization | **PASS** | HTTP 403 Forbidden |
| Role enforcement: Mother cannot write prescriptions | Role Authorization | **PASS** | HTTP 403 Forbidden |
| Doctor authorized retrieval of patient roster | Doctor Feature | **PASS** | HTTP 200, patient array returned, no passwords |
| Doctor authorized prescription write | Doctor Feature | **PASS** | HTTP 200, prescription persisted |
| Authorized mother dashboard retrieval | Mother Feature | **PASS** | HTTP 200, vitals and appointments returned |
| Authorized mother questionnaire update | Mother Feature | **PASS** | HTTP 200, profile updated |
| Session profile check `GET /api/auth/me` | Session Management | **PASS** | HTTP 200, user identity returned |
| Session invalidation `POST /api/auth/logout` | Session Management | **PASS** | HTTP 200, cookie cleared |
| Live Supabase RLS Policy Verification | Database Security | **REQUIRES MANUAL VERIFICATION** | SQL migration drafted; requires operator execution on live database |
| AWS Multi-AZ ALB & Auto Scaling Deployment | Cloud Infrastructure | **REQUIRES MANUAL VERIFICATION** | Architecture designed; requires AWS resource provisioning |

---

## 9. Remaining Blockers

Before a public, Internet-facing production launch can occur, the following external items must be addressed by authorized operations personnel:

1. **Database Key Revocation & Rotation**:
   The legacy Supabase anon key (`SUPABASE_ANON_KEY`) was previously committed in version control history. Although removed from `backend/server.js`, it must be formally revoked in the Supabase management console, and a new key pair generated.
2. **Execution of Database SQL Migration**:
   The SQL migration `backend/migrations/01_security_and_rls.sql` must be reviewed and executed in the Supabase SQL editor to enable Row Level Security (RLS) across all tables and add missing columns.
3. **Database Service Role Key Injection**:
   Once RLS is enabled, the backend server must be provided with `SUPABASE_SERVICE_ROLE_KEY` in its production `.env` (or via AWS Secrets Manager) so it can perform authorized queries.
4. **AWS Infrastructure Provisioning**:
   AWS resources (VPC, ALB, Auto Scaling Group, ACM certificate, Secrets Manager, CloudWatch Alarms) must be provisioned following the specifications in `AWS_DEPLOYMENT_READINESS.md`.

---

## 10. Manual Steps Required

### Step 1: Apply SQL Migration in Supabase
1. Log in to the Supabase Console.
2. Navigate to **SQL Editor** -> **New Query**.
3. Open `backend/migrations/01_security_and_rls.sql`.
4. Paste the entire SQL content into the query editor and click **Run**.
5. Verify that all 10 tables show `rowsecurity = true` by running:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```

### Step 2: Rotate Supabase Keys
1. In the Supabase Dashboard, go to **Project Settings** -> **API**.
2. Click **Generate new secret** to rotate the anon key and service role key.
3. Update the production secrets in AWS Secrets Manager (or production `.env`).

### Step 3: Configure Production Environment Variables
Set the following variables in AWS Secrets Manager or the server `.env`:
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=<generate_a_cryptographically_secure_random_64_char_string>
JWT_EXPIRES_IN=24h
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your_newly_rotated_service_role_key>
FRONTEND_ORIGIN=https://maternix.yourdomain.com
ENABLE_MOCK_FALLBACK=false
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=20
```

### Step 4: Verify Deployment Health
1. Start the server: `npm start`
2. Test the ALB health check: `curl -I https://maternix.yourdomain.com/health` (should return HTTP 200 OK).
3. Test readiness probe: `curl -s https://maternix.yourdomain.com/health/ready` (should return `{"status":"ready","database":"connected"}`).

---

## 11. Final Readiness Assessment

| Target Environment | Readiness Status | Assessment Summary |
|---|---|---|
| **Local Development** | **READY** | All features (mother registration, doctor login, dashboard, questionnaire, infant care, vitals, prescriptions) function completely with relative paths and test mock fallbacks. |
| **College / Demonstration Deployment** | **READY** | All workflows are functional, stable, and protected by JWT auth, bcrypt password hashing, and clean UI session handling. |
| **Public Internet-Facing Deployment** | **READY WITH CHANGES** | Application source code is ready. Requires executing the RLS SQL migration on the database, rotating the exposed Supabase key, and provisioning HTTPS on the domain. |
| **Real Healthcare Production** | **NOT READY** | Requires completion of manual database migrations, secret rotation, multi-AZ database backups, formal HIPAA/data-protection compliance review, BAA with cloud providers, and pen-testing. |
| **AWS Auto Scaling Readiness** | **READY** | Backend is 100% stateless with JWT session verification, `/health` ALB probes, graceful `SIGTERM` shutdown, and no reliance on instance-local files or memory. |

---
*Report generated and validated for Maternix Platform.*
