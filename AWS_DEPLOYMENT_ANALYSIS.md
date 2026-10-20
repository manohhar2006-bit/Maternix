# AWS Deployment Analysis

## Executive Summary

This document provides a comprehensive technical analysis of the **Maternix Maternal Health Platform** codebase for the purpose of planning a production deployment on Amazon Web Services (AWS). 

Maternix is a full-stack web application designed for maternal and infant health tracking, appointment management, vital signs monitoring, and doctor patient administration. The platform currently consists of a static HTML5/JavaScript frontend decoupled from an Express.js (Node.js) REST API backend. The database layer uses cloud-hosted Supabase PostgreSQL, supported by in-memory JavaScript fallback objects.

**Key Technical Assessment Findings:**
1. **Frontend Architecture**: Pure static HTML5, CSS3, and Vanilla JavaScript with CDN dependencies (Font Awesome, Google Fonts, Chart.js). It relies on client-side rendering (CSR) and client LocalStorage for state caching.
2. **Backend Architecture**: A lightweight, stateless Node.js / Express.js REST API (`backend/server.js`) exposing endpoints for mother/doctor authentication, questionnaire onboarding, vitals dashboard, patient listing, and prescription management.
3. **Database Layer**: Cloud-hosted PostgreSQL via Supabase (`@supabase/supabase-js`), defined in `backend/schema.sql` (10 relational tables).
4. **Primary Blockers & Pre-Deployment Changes**:
   - Hardcoded `http://localhost:3000` API endpoints in all 5 frontend HTML files.
   - Hardcoded `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `backend/server.js`.
   - Disabled Row Level Security (RLS) in `backend/schema.sql`.
   - Plaintext password storage and transmission (lack of password hashing like bcrypt or token-based authentication like JWT).
   - Missing Docker containerization and environment variable configuration files (`.env`).

Based on this analysis, the recommended AWS architecture is **Option A (Serverless Frontend + App Runner/EC2 Backend + Managed PostgreSQL)** for immediate low-cost deployment, with an upgrade path to **Option B (ECS Fargate + ALB + RDS PostgreSQL in VPC)** for production compliance and scalability.

---

## 1. PROJECT OVERVIEW

- **Project Name**: Maternix (Maternix Maternal Health Platform / `lambi-backend`)
- **Project Purpose**: Provides an integrated digital healthcare platform for expectant mothers, postnatal mothers, and healthcare providers (doctors/specialists) to track pregnancy progress, manage infant growth and vaccinations, record vital signs, schedule appointments, and manage medical prescriptions.
- **Main Problem Solved**: Solves fragmented maternal healthcare management by connecting pregnant and postnatal women with doctors, providing automated pregnancy countdowns, infant growth tracking, vital signs monitoring (blood pressure, sugar level, weight), and streamlined doctor-patient consultations.
- **Main Users / Target Users**:
  - Expectant mothers (pregnancy tracking, due date countdown, vitals logging).
  - Postnatal mothers (infant growth tracking, milestone and vaccination tracking).
  - Doctors / Gynecologists / Pediatricians (patient roster lookup, vitals review, prescription generation).
- **Major Features**:
  - Dual Authentication Portal (Mother Registration/Login & Doctor Login).
  - Pregnancy Week Counter & Due Date Live Countdown.
  - Postnatal Infant Management (Adding baby details, height/weight tracking, age calculation).
  - Maternal Vitals Monitor (Blood Pressure, Blood Sugar, Weight logging and charts via Chart.js).
  - Doctor Management Dashboard (Searchable patient roster, modal view of patient history, prescription writing).
  - Onboarding Questionnaire (Medical background, blood group, chronic conditions, allergies).
  - LocalStorage & Backend Synchronization Fallback.
- **Important Workflows**:
  1. *Mother Onboarding Workflow*: User registers at `login.html` -> completes medical questionnaire at `questionnaire.html` -> redirected to personalized `dashboard.html`.
  2. *Infant Care & Vitals Tracking*: Postnatal mother logs into `dashboard.html` -> enters baby birth date and weight -> views growth metrics and vaccination schedules.
  3. *Doctor Consultation Workflow*: Doctor logs into `login.html` with ID `DOC001` -> accesses `doctor-dashboard.html` -> searches patient list -> opens patient detail modal -> submits diagnosis and prescription -> backend records entry in database.
- **Application Type**: **Full-stack web application** (Static HTML/JS Frontend + Node.js Express REST API Backend + Cloud PostgreSQL Database).

### Architecture Summary
The application follows a decoupled two-tier architecture:
1. **Frontend Tier**: Client-side web pages (`login.html`, `dashboard.html`, `doctor-dashboard.html`, `questionnaire.html`, `new1.html`) containing inline CSS/JS that interact with the backend via `fetch` HTTP requests.
2. **Backend Tier**: Express.js REST API (`backend/server.js`) listening on port 3000. It queries a Supabase PostgreSQL database using `@supabase/supabase-js` or falls back to local in-memory JavaScript objects if Supabase is unreachable.

---

## 2. COMPLETE PROJECT STRUCTURE

Below is the complete tree-style structure of the project directory (excluding `node_modules` and generated temporary files):

```
maternix-project/
├── .DS_Store                     # macOS system metadata file
├── package-lock.json             # Root NPM lock file
├── package.json                  # Root NPM package configuration
├── README (1).md                 # Project documentation & feature summary
├── backend/
│   ├── package-lock.json         # Backend NPM lock file
│   ├── package.json              # Backend NPM package configuration (lambi-backend)
│   ├── schema.sql                # PostgreSQL database schema & seed SQL script
│   └── server.js                 # Express.js REST API server & database client
└── frontend/
    ├── dashboard.html            # Patient/mother dashboard UI
    ├── doctor-dashboard.html     # Doctor patient management UI
    ├── login.html                # Authentication portal (Sign In / Register / Doctor Login)
    ├── new1.html                 # Additional feature page / landing interface
    └── questionnaire.html        # New user health onboarding questionnaire
```

---

## 3. FRONTEND ANALYSIS

- **Framework / Library**: Vanilla HTML5, CSS3, Vanilla JavaScript (ES6+ with `async/await` and `fetch`). Third-party libraries loaded via CDN:
  - Font Awesome 6.4.0 (`cdnjs.cloudflare.com`)
  - Google Fonts: Playfair Display & DM Sans (`fonts.googleapis.com`)
  - Chart.js (`cdn.jsdelivr.net`)
- **Build Tool**: None (Static HTML/CSS/JS served directly without bundling).
- **Programming Language**: HTML5, CSS3, Client-side JavaScript.
- **Package Manager**: None dedicated for frontend.
- **Important Frontend Dependencies**:
  - `Font Awesome` (CDN)
  - `Google Fonts` (CDN)
  - `Chart.js` (CDN)
- **Frontend Entry Point**: `login.html` (served at `/` route by backend Express server).
- **Build Command**: `Not Found / Cannot Determine` (No build step exists).
- **Development Command**: `Not Found / Cannot Determine` (Served statically via backend).
- **Production Command**: Static file server (e.g., Nginx, S3 + CloudFront, or Express static middleware).
- **Output / Build Directory**: `frontend/` directory directly.
- **Frontend Port**: Currently served on port `3000` via Express `express.static(path.join(__dirname, '../frontend'))`. Standard web ports (80/443) when decoupled.
- **Environment Variables Required by Frontend**: None currently configured. (API URL `http://localhost:3000` is hardcoded in frontend JavaScript files).
- **API URLs / Configuration**: Hardcoded string `http://localhost:3000` across JavaScript scripts in `login.html`, `dashboard.html`, `doctor-dashboard.html`, and `questionnaire.html`.
- **Can Frontend be Hosted Separately from Backend?**: **YES**. The frontend consists entirely of static HTML/CSS/JS files and can be hosted on AWS S3 with CloudFront CDN or AWS Amplify.
- **Requires Server-Side Rendering (SSR)?**: **NO**.
- **Requires WebSockets or Persistent Connections?**: **NO**. All communications use standard HTTP REST `fetch` calls.

---

## 4. BACKEND ANALYSIS

- **Backend Language**: Node.js (JavaScript).
- **Framework**: Express.js (`v5.2.1`).
- **Backend Entry Point**: `backend/server.js` (defined as `"main": "backend/server.js"` in root `package.json` and `"main": "server.js"` in `backend/package.json`).
- **Main Application File**: `backend/server.js`.
- **Package Manager**: `npm`.
- **Important Dependencies**:
  - `express`: `^5.2.1` (Web server framework)
  - `cors`: `^2.8.6` (Cross-Origin Resource Sharing middleware)
  - `@supabase/supabase-js`: `^2.103.0` (Database client)
- **Start Command**: `node server.js` (from `backend/`) or `npm start` (from root).
- **Development Command**: `node server.js` or `npm start`.
- **Production Command**: `node server.js` or `npm start`.
- **Backend Port**: `3000` (hardcoded `const port = 3000;` in `backend/server.js`).
- **Host Binding**: Default Express binding (`0.0.0.0` or `localhost`).
- **API Routes / Endpoints**:
  - `GET /` -> Serves `frontend/login.html`
  - `POST /api/auth/signup` -> Registers new mother in Supabase `mothers` table
  - `POST /api/auth/login-mother` -> Authenticates mother credentials against Supabase or mock array
  - `POST /api/auth/login-doctor` -> Authenticates doctor credentials against Supabase or mock array
  - `POST /api/questionnaire` -> Updates mother medical details in Supabase
  - `GET /api/dashboard/:motherId` -> Fetches vitals, appointments, support contacts, hospitals, medical records, and infant data for a mother
  - `POST /api/doctor/prescription` -> Inserts diagnosis and prescription into `medical_records` table
  - `GET /api/doctor/patients` -> Fetches all mothers, vitals, appointments, and infant records for doctor view
- **Authentication Mechanism**: Basic custom payload verification (username/password sent via JSON POST). Passwords are verified against plain text in database/mock array. **No JWT, session cookies, or OAuth are used.**
- **Session Handling**: Client-side handling via browser `localStorage` (`currentUser`, `currentDoctor`, `userRole`). Stateless on backend.
- **CORS Configuration**: `app.use(cors())` - Enables wildcard CORS for all origins.
- **File Upload Handling**: `Not Found / Cannot Determine` (No file upload endpoint or multipart middleware configured).
- **Background Jobs**: `Not Found / Cannot Determine` (None present).
- **Scheduled Jobs**: `Not Found / Cannot Determine` (None present).
- **WebSockets / Socket.IO / Real-Time**: `Not Found / Cannot Determine` (No WebSocket server initialized in `server.js`).
- **External Services Used**: Supabase Cloud PostgreSQL (`https://ddfcpokerbzgaknxdges.supabase.co`).
- **Environment Variables Required**: None configured in code (`SUPABASE_URL` and `SUPABASE_ANON_KEY` are hardcoded in `server.js`). Production requires `PORT`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`.

---

## 5. DATABASE ANALYSIS

- **Database Used**: **YES**.
- **Database Type**: PostgreSQL (cloud-hosted via Supabase), backed up by in-memory JavaScript fallback arrays (`mockMothers`, `mockDoctors`, `mockHealthMonitors`, `mockAppointments`).
- **Database Driver / Client**: `@supabase/supabase-js` (`^2.103.0`).
- **ORM / Query Library**: Supabase JavaScript Client API (`supabase.from('tableName').select(...)`).
- **Database Connection Configuration**: Hardcoded in `backend/server.js`:
  - `SUPABASE_URL`: `https://ddfcpokerbzgaknxdges.supabase.co`
  - `SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **Database File Location**: Cloud-hosted Supabase instance. Local SQL schema script is located at `backend/schema.sql`.
- **Tables / Collections (10 Tables)**:
  1. `mothers` (mother_id, age, blood_group, pregnancy_stage, medical_history, first_name, last_name, email, username, password, status, due_date, current_week)
  2. `hospitals` (hospital_id, name, location, contact_no)
  3. `doctors` (doctor_id, user_id, specialization, experience, contact_no, hospitalref_id, name, email, password)
  4. `infants` (infant_id, mother_id, name, date_of_birth, gender, weight)
  5. `support_contacts` (support_id, mother_id, contact_name, contact_number, relation)
  6. `appointments` (appointment_id, mother_id, doctor_id, appointment_date, status)
  7. `health_monitors` (monitor_id, mother_id, infant_id, blood_pressure, sugar_level, weight, record_date)
  8. `medical_records` (record_id, mother_id, infant_id, diagnosis, prescription, record_date)
  9. `payments` (payment_id, appointment_id, amount, payment_method, payment_status, payment_date)
  10. `vaccinations` (vaccination_id, infant_id, vaccine_name, vaccination_date, next_due_date)
- **Important Schema Information**: Relational schema with Foreign Keys referencing `mothers(mother_id)`, `doctors(doctor_id)`, `infants(infant_id)`, and `appointments(appointment_id)`. **Row Level Security (RLS) is explicitly disabled on all tables in `schema.sql`.**
- **Migrations**: Single schema script `backend/schema.sql`.
- **Seed Scripts**: `backend/schema.sql` contains full seed `INSERT` and `UPDATE` statements for all 10 tables.
- **Database Data Persistence**: Persisted in Supabase PostgreSQL cloud. (Fallback mock array data is in-memory and resets on server restart).
- **Multiple Application Instances Safe?**: **YES**, when connected to Supabase or AWS RDS PostgreSQL. NO, if relying on in-memory mock fallback.
- **Does Database Currently Run Locally?**: NO. It connects to external Supabase cloud.
- **Managed Cloud Database Required?**: RECOMMENDED (either retain Supabase or migrate to AWS RDS for PostgreSQL / Aurora).

> [!WARNING]
> Database Anon Key is currently exposed in plain text inside `backend/server.js`. It must be moved to environment variables and rotated.

---

## 6. FILE STORAGE / UPLOADS

- **Storage Type Analysis**:
  - PDFs: `Not Found / Cannot Determine`
  - Images: Base64 data URI embedded logo in `frontend/new1.html`. No user image upload functionality.
  - Videos: `Not Found / Cannot Determine`
  - Documents: `Not Found / Cannot Determine`
  - User Uploads: `Not Found / Cannot Determine`
  - Generated Files: `Not Found / Cannot Determine`
  - Reports: `Not Found / Cannot Determine`
  - Model Files: `Not Found / Cannot Determine`
  - Logs: Standard stdout/stderr console logging.
  - Static Assets: HTML files in `frontend/` folder.
- **Current File Storage Location**: Local disk (`frontend/` folder).
- **Temporary vs Permanent**: Permanent static code files.
- **User Download Need**: None.
- **Public / Private Access**: Public web access for static frontend files.
- **Approximate File-Size Expectations**: Entire frontend repository is < 1 MB.
- **Persistent Cloud Storage Required?**: **NO** for backend file uploads. **YES** for frontend static file hosting (S3 bucket).
- **Amazon S3 Utility**: S3 is **RECOMMENDED** for hosting static frontend assets (`frontend/*.html`), backed by AWS CloudFront CDN for global distribution and SSL termination.

---

## 7. AI / ML COMPONENTS

- **AI / ML Libraries**: `Not Found / Cannot Determine` (None used).
- **Model Files / Formats**: `Not Found / Cannot Determine` (None present).
- **Hugging Face / OpenAI / Gemini / Anthropic**: `Not Found / Cannot Determine` (None integrated).
- **Local LLMs / Embeddings / Vector Databases**: `Not Found / Cannot Determine` (None present).
- **Compute Requirements**: Standard CPU only (< 1 vCPU).
- **RAM Requirements**: Low RAM (< 512 MB).
- **Persistent Model Storage**: `Not Found / Cannot Determine` (None required).
- **Model Loaded at Startup**: `Not Found / Cannot Determine` (None).

---

## 8. EXTERNAL APIS AND SERVICES

| API / Service Name | Purpose | Location in Code | Environment Variable Required | Internet Access Required? | Can Remain External on AWS? |
|---|---|---|---|---|---|
| **Supabase Cloud** | Managed PostgreSQL Database | `backend/server.js` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | YES | YES (or migrate to AWS RDS) |
| **Google Fonts CDN** | Typography (`Playfair Display`, `DM Sans`) | `frontend/*.html` | None | YES (Browser) | YES (or bundle locally) |
| **Font Awesome CDN** | UI Icons (`font-awesome/6.4.0`) | `frontend/*.html` | None | YES (Browser) | YES (or bundle locally) |
| **Chart.js CDN** | Vitals visualization charts | `frontend/dashboard.html` | None | YES (Browser) | YES (or bundle locally) |

---

## 9. ENVIRONMENT VARIABLES AND SECRETS

No `.env` or `.env.example` file currently exists in the repository. All values are hardcoded.

### Table of Required Environment Variables for AWS

| Variable Name | Used By | Purpose | Required? | Default / Example Value |
|---|---|---|---|---|
| `PORT` | Backend (`server.js`) | Port for Express HTTP server | Recommended | `3000` |
| `SUPABASE_URL` | Backend (`server.js`) | Supabase PostgreSQL project URL | Required (if using Supabase) | `https://<id>.supabase.co` |
| `SUPABASE_ANON_KEY` | Backend (`server.js`) | Supabase API JWT Anon key | Required (if using Supabase) | `eyJhbGci...` |
| `NODE_ENV` | Backend (`server.js`) | Runtime environment (`production`/`development`) | Recommended | `production` |
| `API_BASE_URL` | Frontend JS | Base URL for API requests | Required for AWS | `https://api.yourdomain.com` |
| `DATABASE_URL` | Backend (`server.js`) | Direct PostgreSQL URI (if using AWS RDS) | Optional (RDS alternative) | `postgres://user:pass@host:5432/db` |

> [!SECURITY NOTICE]
> Plaintext Supabase anon JWT key detected in `backend/server.js` (Line 21). This credential must be extracted into AWS Secrets Manager or Parameter Store and rotated before deployment.

---

## 10. DOCKER ANALYSIS

- **Dockerfile(s)**: `Not Found / Cannot Determine` (No Dockerfile in project).
- **docker-compose.yml**: `Not Found / Cannot Determine` (No docker-compose file in project).
- **Container Readiness**: **100% Container-Ready**. The Node.js Express backend (`backend/server.js`) is stateless, standard, and lightweight. A basic Alpine-based Dockerfile can be added to package the backend for AWS ECS, AWS Fargate, or AWS App Runner.

---

## 11. CURRENT LOCAL RUN PROCESS

### Exact Local Execution Commands

#### Frontend:
```bash
# Option 1: Served automatically by Express backend on http://localhost:3000/
# Option 2: Standalone local web server
npx serve frontend
```

#### Backend:
```bash
cd backend
npm install
npm start
# OR from root directory:
npm start
```

#### Database Setup:
```sql
-- Executed manually in Supabase SQL Editor or PostgreSQL client:
-- Run entire script in backend/schema.sql
```

#### Docker:
```bash
# Not configured in project
```

#### Build:
```bash
# No build step required
```

### Environment Requirements
- **Node.js**: v16.x or v18.x+
- **NPM**: v8.x+
- **Ports**: `3000`
- **Startup Order**: 1. Database (Supabase Cloud or local Postgres) -> 2. Backend Server (`backend/server.js`) -> 3. Access Web Browser at `http://localhost:3000`.

---

## 12. PORT AND NETWORK ANALYSIS

### Port Summary Table

| Component | Port | Protocol | Public/Private | Purpose |
|---|---:|---|---|---|
| **Frontend Static Web Server** | 3000 / 80 / 443 | HTTP/HTTPS | Public | Delivers HTML/JS/CSS to user browsers |
| **Backend REST API** | 3000 / 80 / 443 | HTTP/HTTPS | Public | Serves `/api/*` REST endpoints |
| **Supabase PostgreSQL** | 443 | HTTPS | Private/External | Cloud database API endpoint |
| **AWS RDS PostgreSQL** (Target) | 5432 | TCP | Private | VPC-bound relational database |

### Network & Security Requirements
- **Backend Public Accessibility**: YES (Backend REST API must be publicly accessible or exposed via Application Load Balancer / API Gateway).
- **Frontend/Backend Communication**: Client-side HTTPS REST `fetch` calls.
- **CORS Required?**: **YES** (Frontend and Backend hosted on separate domains/subdomains require CORS headers).
- **HTTPS Required?**: **YES** (Mandatory for medical/health data transmission).
- **WebSockets Required?**: **NO**.

---

## 13. PERFORMANCE / RESOURCE REQUIREMENTS

| Dimension | Project Status | Resource Requirement Estimate |
|---|---|---|
| **CPU Usage** | Verified | Very Low (0.25 - 0.5 vCPU sufficient for low to moderate traffic) |
| **RAM** | Verified | Low (128 MB - 512 MB for Node.js process) |
| **Disk Storage** | Verified | Minimal (< 100 MB for codebase and node_modules) |
| **Model Size** | Verified | None (0 MB) |
| **Database Size** | Verified | Initial seed data < 5 MB |
| **File Upload Storage** | Verified | 0 MB (No file uploads configured) |
| **Concurrent Users** | Unknown | Depends on deployment scale (Stateless backend scales horizontally) |
| **Startup Time** | Verified | < 2 seconds |
| **Build Requirements** | Verified | None |

---

## 14. SECURITY REQUIREMENTS

### Security Audit Findings & Deficiencies

1. **Hardcoded Credentials**: Plaintext `SUPABASE_ANON_KEY` in `backend/server.js` line 21.
2. **Plaintext Passwords**: User and doctor passwords (`password123`, `doctor123`) are stored unhashed in `backend/schema.sql` and `server.js` mock arrays. No hashing library (e.g., `bcrypt`) is used.
3. **Unauthenticated Endpoints / Lack of Tokens**: Authentication endpoints (`/api/auth/login-mother`, `/api/auth/login-doctor`) do not return JWT tokens or set session cookies. The frontend stores user object directly in `localStorage`.
4. **Disabled Row Level Security (RLS)**: `backend/schema.sql` contains `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for all 10 database tables, allowing unrestricted public read/write if the anon key is known.
5. **Wildcard CORS**: `app.use(cors())` allows any origin to query the backend API.
6. **Hardcoded Localhost Endpoints**: Frontend HTML scripts make requests directly to `http://localhost:3000`.

> [!IMPORTANT]
> All security issues listed above must be remediated prior to launching a production instance handling sensitive healthcare/maternal data (HIPAA / GDPR / DISHA compliance).

---

## 15. AWS SERVICE MAPPING

| AWS Service | Classification | Rationale & Use Case |
|---|---|---|
| **AWS App Runner** | **RECOMMENDED** | Simplest containerized deployment for Node.js Express backend with auto-scaling. |
| **Amazon ECS / Fargate** | **RECOMMENDED** | Container orchestration for Node.js API with zero server management in private subnets. |
| **Amazon EC2** | **RECOMMENDED (Option A)** | Low-cost virtual machine (`t4g.nano` / `t3.micro`) running Node.js behind Nginx. |
| **AWS Amplify / S3 + CloudFront**| **REQUIRED / RECOMMENDED**| Hosting static HTML5/JS frontend files with global CDN edge caching and free SSL. |
| **Amazon RDS (PostgreSQL)** | **RECOMMENDED** | Fully managed, Multi-AZ relational database replacing external Supabase dependence. |
| **AWS Lambda** | **OPTIONAL** | Serverless alternative using `@vendia/serverless-express` wrapper. |
| **Amazon Elastic Beanstalk**| **OPTIONAL** | PaaS hosting for Node.js application. |
| **Amazon S3** | **RECOMMENDED** | Static asset storage and web hosting. |
| **Amazon EBS** | **NOT NEEDED** | App is stateless; ephemeral container/EC2 storage is sufficient. |
| **Amazon DynamoDB** | **NOT NEEDED** | Relational schema with foreign keys is already established. |
| **Amazon VPC** | **REQUIRED** | Isolated network with public/private subnets for backend and database. |
| **Application Load Balancer**| **RECOMMENDED** | Routes HTTP/HTTPS traffic to backend instances/containers across AZs. |
| **Amazon CloudFront** | **RECOMMENDED** | Fast content delivery for static frontend assets & SSL termination. |
| **Amazon Route 53** | **RECOMMENDED** | DNS routing for custom domain (e.g., `maternix.com`). |
| **AWS Certificate Manager (ACM)**| **RECOMMENDED**| Free TLS/SSL certificates for HTTPS. |
| **AWS Secrets Manager** | **REQUIRED** | Secure storage for database credentials and API keys. |
| **Amazon CloudWatch** | **RECOMMENDED** | Application logging, monitoring, and health alerts. |
| **Amazon ECR** | **RECOMMENDED** | Private Docker container image registry for backend containers. |

---

## 16. AWS ARCHITECTURE OPTIONS

### Option A: Cost-Effective / Student Architecture (Lowest Cost)

- **Frontend**: AWS S3 Bucket (Static Web Hosting) + Amazon CloudFront CDN.
- **Backend**: AWS App Runner OR single Amazon EC2 instance (`t4g.nano` or `t3.micro`) running Node.js + Nginx.
- **Database**: Managed Supabase PostgreSQL (Existing) OR AWS RDS PostgreSQL (`db.t4g.micro` single-AZ).
- **Advantages**:
  - Extremely cheap (~$5 - $15/month).
  - Very simple setup and low management overhead.
  - S3 + CloudFront ensures fast global frontend loading.
- **Disadvantages**:
  - Single point of failure for backend if on single EC2.
  - Manual deployment unless CI/CD is configured.
- **Complexity**: Low.

---

### Option B: Production-Ready High Availability Architecture

- **Frontend**: AWS S3 Bucket + Amazon CloudFront CDN + AWS WAF (Web Application Firewall).
- **Backend**: Amazon ECS on AWS Fargate (Task instances distributed across Multi-AZ Private Subnets) behind an Application Load Balancer (ALB).
- **Database**: Amazon RDS for PostgreSQL (Multi-AZ Deployment in Private Subnets).
- **Security & Config**: AWS Secrets Manager, IAM Roles, ACM (SSL Certificates), CloudWatch.
- **Advantages**:
  - Highly Available (HA), zero downtime, automatic scaling.
  - Fully compliant with enterprise security standards (Database & Backend isolated in private subnets).
  - Zero server management via Fargate.
- **Disadvantages**:
  - Higher monthly cost (~$60 - $150+/month).
  - Greater deployment and VPC networking complexity.
- **Complexity**: Moderate-High.

---

### Architectural Recommendation
Start with **Option A (S3 + CloudFront for Frontend, AWS App Runner or EC2 for Backend, Supabase/RDS for Database)** for initial staging and testing. Transition to **Option B (ECS Fargate + ALB + RDS in VPC)** when launching for live medical users requiring high availability and regulatory data privacy.

---

## 17. AWS ARCHITECTURE DIAGRAM

### Production Architecture (Option B)

```
                     [ Internet Users / Mobile / Browsers ]
                                       │
                                       ▼
                             [ Amazon Route 53 ] (DNS)
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                    ▼                                     ▼
        [ Amazon CloudFront (CDN) ]               [ AWS WAF ]
                    │                                     │
                    ▼                                     │
      [ S3 Bucket: Static Frontend ]                      │
      (login.html, dashboard.html, etc.)                  │
                                                          ▼
                                            [ Application Load Balancer ]
                                            (Public Subnets / HTTPS / ACM)
                                                          │
                                         ┌────────────────┴────────────────┐
                                         │  VPC (Virtual Private Cloud)    │
                                         │                                 │
                                         │  [ Private Subnet - AZ1 ]       │  [ Private Subnet - AZ2 ]
                                         │  ┌───────────────────────┐      │  ┌───────────────────────┐
                                         │  │ AWS Fargate (ECS)     │      │  │ AWS Fargate (ECS)     │
                                         │  │ Node.js Backend API   │      │  │ Node.js Backend API   │
                                         │  └───────────┬───────────┘      │  └───────────┬───────────┘
                                         │              │                  │              │
                                         └──────────────┼──────────────────┴──────────────┼─────────┘
                                                        │                                 │
                                                        ▼                                 ▼
                                             [ Amazon RDS PostgreSQL ] ◄───► [ Multi-AZ Standby DB ]
                                             (Database Private Subnet)        (Automatic Failover)
                                                        │
                                                        ▼
                                             [ AWS Secrets Manager ]
                                             (Database Credentials)
```

---

## 18. AWS NETWORKING DESIGN

### Recommended VPC Configuration

- **VPC CIDR**: `10.0.0.0/16`
- **Public Subnets**:
  - `Public Subnet 1 (AZ-a)`: `10.0.1.0/24` (ALB, NAT Gateway)
  - `Public Subnet 2 (AZ-b)`: `10.0.2.0/24` (ALB)
- **Private Subnets (App Tier)**:
  - `Private Subnet 1 (AZ-a)`: `10.0.10.0/24` (ECS Fargate Backend Tasks)
  - `Private Subnet 2 (AZ-b)`: `10.0.11.0/24` (ECS Fargate Backend Tasks)
- **Database Subnets (Data Tier)**:
  - `DB Subnet 1 (AZ-a)`: `10.0.20.0/24` (Amazon RDS PostgreSQL Primary)
  - `DB Subnet 2 (AZ-b)`: `10.0.21.0/24` (Amazon RDS PostgreSQL Standby)

### Security Group Inbound / Outbound Conceptual Rules

1. **ALB Security Group (`sg-alb`)**:
   - Inbound: HTTP (80) & HTTPS (443) from `0.0.0.0/0`.
   - Outbound: Port 3000 to `sg-backend`.
2. **Backend ECS Security Group (`sg-backend`)**:
   - Inbound: Port 3000 ONLY from `sg-alb`.
   - Outbound: Port 5432 to `sg-database` & Port 443 to Internet (via NAT Gateway for external APIs).
3. **Database Security Group (`sg-database`)**:
   - Inbound: Port 5432 ONLY from `sg-backend`.
   - Outbound: None.

---

## 19. DOMAIN AND HTTPS

- **Custom Domain**: Route 53 hosted zone (e.g., `maternix.org`).
- **SSL / TLS Certificate**: Requested via **AWS Certificate Manager (ACM)** in region `us-east-1` (for CloudFront) and target region (for ALB).
- **Routing Setup**:
  - `https://maternix.org` -> CloudFront distribution -> S3 Bucket (Frontend).
  - `https://api.maternix.org` -> Application Load Balancer -> ECS / App Runner (Backend).
- **Reverse Proxy**: Nginx or ALB handles path routing and HTTPS termination.

---

## 20. DEPLOYMENT DEPENDENCIES

### "Things Required Before AWS Deployment"

#### Required:
1. **GitHub Repository**: Accessible repository containing cleaned project code.
2. **AWS Account**: Active account with IAM Administrative privileges.
3. **Environment Variable Configuration**: Centralized config layer replacing hardcoded values in `server.js`.
4. **Dynamic API Base URL**: Refactored frontend JS replacing hardcoded `http://localhost:3000`.

#### Recommended:
1. **Custom Domain Name**: Registered domain name configured on Route 53.
2. **Dockerization**: `Dockerfile` for backend service.
3. **Database Migration Plan**: `schema.sql` execution pipeline on AWS RDS PostgreSQL or Supabase production environment.
4. **Password Hashing Implementation**: Upgrade backend to hash passwords using `bcrypt` or `argon2`.
5. **JWT Authentication**: Secure token-based auth replacing raw database object returns.

#### Optional:
1. **CI/CD Pipeline**: GitHub Actions workflow deploying to AWS S3/ECR/ECS.
2. **AWS WAF**: Web Application Firewall rules for DDoS and SQL injection protection.

---

## 21. POTENTIAL DEPLOYMENT PROBLEMS

### 1. Hardcoded Localhost API Endpoints
- **Why it happens**: Frontend scripts (`login.html`, `dashboard.html`, `doctor-dashboard.html`, `questionnaire.html`) contain hardcoded strings like `fetch('http://localhost:3000/api/...')`.
- **Impact**: In production, user browsers will attempt to query their own local machine (`localhost`), causing all network requests to fail.
- **What needs to change**: Abstract API endpoint into a configurable global variable or relative path (e.g., `window.API_BASE_URL` or `/api/...`).

### 2. Hardcoded Database Keys & Credentials in Code
- **Why it happens**: `backend/server.js` contains literal strings for `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- **Impact**: Security vulnerability; keys are exposed in git history and cannot be safely changed across environments.
- **What needs to change**: Use `process.env.SUPABASE_URL` and `process.env.SUPABASE_ANON_KEY` loaded via `dotenv` or container environment variables.

### 3. Disabled Row Level Security (RLS) in Database
- **Why it happens**: `backend/schema.sql` explicitly executes `DISABLE ROW LEVEL SECURITY` on all tables.
- **Impact**: Any user with the Supabase anon key can directly query or modify any table in the database bypassing the API server.
- **What needs to change**: Enable RLS and define table-level access policies or restrict access strictly to backend service connection strings.

### 4. Unsecured Plaintext Password Handling
- **Why it happens**: Authentication endpoints compare plaintext strings directly without hashing.
- **Impact**: Severe privacy and regulatory violation for health data; passwords exposed in database logs.
- **What needs to change**: Implement `bcrypt` hashing on signup and verification on login.

### 5. Open Wildcard CORS
- **Why it happens**: `app.use(cors())` is invoked without origin filters.
- **Impact**: Cross-origin requests allowed from any malicious site.
- **What needs to change**: Restrict CORS origins to the domain hosting the frontend.

### 6. Missing Docker Configuration & Process Manager
- **Why it happens**: Project relies on manual `node server.js` execution.
- **Impact**: Backend will not automatically restart on crash or server reboot.
- **What needs to change**: Add a `Dockerfile` and use process managers (PM2) or container orchestrators (ECS/App Runner).

---

## 22. DEPLOYMENT READINESS CHECK

| Component | Status | Assessment Notes |
|---|:---:|---|
| **Frontend Code** | ⚠️ Needs Changes | Static structure is ready, but hardcoded `localhost:3000` fetch calls must be updated. |
| **Backend REST API** | ⚠️ Needs Changes | Endpoints work well, but environment variables and CORS policies must be added. |
| **Database Schema** | ⚠️ Needs Changes | Relational schema in `schema.sql` is complete, but RLS must be enabled and seed data separated. |
| **Authentication** | ❌ Blocking Issue | Plaintext passwords, lack of JWT/session tokens, and insecure client storage must be fixed. |
| **Storage** | ✅ Ready | No dynamic file uploads required; S3 static hosting is simple. |
| **Environment Variables** | ❌ Blocking Issue | No `.env` layer present; keys hardcoded in JavaScript. |
| **Docker Containerization**| ⚠️ Needs Changes | No Dockerfile present; needs to be created for ECS/App Runner. |
| **API Integration** | ⚠️ Needs Changes | REST endpoints functional, but URLs must be dynamically injected. |
| **Networking & TLS** | ⚠️ Needs Changes | Must transition from HTTP to HTTPS with ACM certificate. |
| **Security & Privacy** | ❌ Blocking Issue | Plaintext passwords, hardcoded keys, disabled RLS violate healthcare security standards. |
| **Production Build** | ✅ Ready | Static files and Node.js require no complex compilation pipeline. |
| **Logging & Monitoring** | ⚠️ Needs Changes | Basic `console.log` should be routed to CloudWatch. |
| **Scalability** | ✅ Ready | Backend is stateless; frontend is static and globally cacheable on CDN. |

---

## 23. EXACT INFORMATION NEEDED FOR AWS DEPLOYMENT

Before commencing AWS deployment, an engineer or automated AI deployment agent will require the following information:

### 1. AWS Account & Budget Details
- [ ] AWS Account ID & IAM Deployment Credentials (Access Key & Secret Key or Role).
- [ ] Target AWS Region (e.g., `us-east-1` or `ap-south-1`).
- [ ] Monthly budget target (e.g., < $20/mo for Option A vs $100+/mo for Option B).

### 2. Application Configuration
- [ ] Target domain name (e.g., `maternix.com`).
- [ ] Chosen backend port (default `3000`).
- [ ] Target Environment (`staging` vs `production`).

### 3. Database Credentials & Strategy
- [ ] Choice of Database: Retain Supabase Cloud vs Migrate to AWS RDS PostgreSQL.
- [ ] Database host URL, port, database name, master username, and master password.
- [ ] Database Anon Key / Service Role Key (if retaining Supabase).

### 4. Code Base & Deployment Artifacts
- [ ] GitHub repository URI and deployment branch (e.g., `main`).
- [ ] Created `Dockerfile` for backend packaging.
- [ ] Updated frontend API base URL variable.

---

## 24. FINAL RECOMMENDATION

### Recommended AWS Deployment Architecture

1. **Recommended AWS Services**:
   - **Frontend**: Amazon S3 + Amazon CloudFront + AWS Certificate Manager (ACM).
   - **Backend**: AWS App Runner (for simplicity) OR Amazon ECS Fargate behind an Application Load Balancer.
   - **Database**: AWS RDS for PostgreSQL (Multi-AZ) OR Production Supabase Instance.
   - **Security**: AWS Secrets Manager, IAM Roles, Route 53.
2. **Services NOT Required**:
   - Elastic Block Store (EBS) volumes (backend is stateless).
   - DynamoDB (relational PostgreSQL is already defined).
   - GPU Instances / EMR / SageMaker (no AI/ML components).
3. **Why This Architecture Fits the Project**:
   - The decoupled static frontend benefits from global CDN edge caching on CloudFront.
   - The stateless Node.js Express backend scales seamlessly on containerized services (App Runner or ECS Fargate).
   - The relational PostgreSQL schema maps directly to AWS RDS PostgreSQL.
4. **Major Changes Required Before Deployment**:
   - Replace hardcoded `http://localhost:3000` in frontend HTML files with dynamic API URL variables.
   - Extract hardcoded Supabase keys in `backend/server.js` into environment variables (`process.env`).
   - Implement password hashing (`bcrypt`) and JWT token authentication.
   - Enable Row Level Security (RLS) on PostgreSQL tables.
   - Add `Dockerfile` to root/backend directory.
5. **Expected Deployment Complexity**: **Low-to-Moderate**.
6. **Main AWS Cost Drivers**:
   - Amazon RDS PostgreSQL instance (if chosen over Supabase).
   - Fargate tasks / App Runner compute instances.
   - Application Load Balancer (ALB).
7. **Important Security Considerations**:
   - Ensure HTTPS is enforced across all frontend and API communications.
   - Secure database credentials in AWS Secrets Manager.
   - Restrict Database Security Group to accept traffic ONLY from backend tasks.

---

## Final Status

- **Project Deployment Type**: Full-Stack Web Application (Decoupled Static HTML/JS Frontend + Node.js Express REST API + PostgreSQL Database).
- **Recommended AWS Architecture**: S3 + CloudFront (Frontend) + AWS App Runner / ECS Fargate (Backend) + AWS RDS PostgreSQL / Supabase (Database).
- **Required AWS Services**: S3, CloudFront, App Runner / ECS Fargate, ACM, Route 53, IAM, Secrets Manager.
- **Major Blockers**: Hardcoded `localhost` URLs in frontend, hardcoded database keys in backend code, plaintext password handling, lack of environment variable file (`.env`), disabled database RLS.
- **Ready for AWS Deployment**: **WITH CHANGES** (Requires minor code refactoring for environment variables, API endpoints, and authentication security prior to launching live AWS resources).
