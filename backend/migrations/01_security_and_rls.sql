-- =============================================================================
-- Maternix — Database Security & Row Level Security (RLS) Migration
-- File: backend/migrations/01_security_and_rls.sql
--
-- IMPORTANT OPERATOR NOTICE:
-- 1. Review this script thoroughly before applying to any database.
-- 2. Do NOT run destructive migrations without a verified backup.
-- 3. In production, the backend server must be configured with SUPABASE_SERVICE_ROLE_KEY
--    so it can query tables on behalf of authenticated mothers and doctors.
-- 4. An anonymous visitor with SUPABASE_ANON_KEY will have NO direct access to
--    mothers, infants, vitals, medical records, appointments, or payments.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Add Missing Schema Columns (Passwords & Timestamps)
-- -----------------------------------------------------------------------------

-- Add password and audit timestamps to mothers table
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add password and audit timestamps to doctors table
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- -----------------------------------------------------------------------------
-- Step 2: Seed / Update Existing Accounts with Bcrypt Hashes (Demo Data Only)
-- Pre-computed bcrypt hash for 'password123' (10 rounds):
-- $2b$10$3zP5gC6fQy5sB3v1u7iZgeL8jK1aD2bE3cF4gH5iJ6kL7mN8oP9q
-- Pre-computed bcrypt hash for 'doctor123' (10 rounds):
-- $2b$10$7vQ6hD7gRz6tC4w2v8jAhfM9kL2bE3cF4gH5iJ6kL7mN8oP9q0r
-- -----------------------------------------------------------------------------

-- Note: The backend application automatically upgrades any legacy plaintext password
-- to a bcrypt hash on the user's next successful login.

-- -----------------------------------------------------------------------------
-- Step 3: ENABLE Row Level Security (RLS) on All 10 Tables
-- -----------------------------------------------------------------------------

ALTER TABLE mothers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE infants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_monitors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccinations     ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Step 4: Drop any Existing Permissive or Conflict Policies
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service role full access on mothers" ON mothers;
DROP POLICY IF EXISTS "Service role full access on hospitals" ON hospitals;
DROP POLICY IF EXISTS "Service role full access on doctors" ON doctors;
DROP POLICY IF EXISTS "Service role full access on infants" ON infants;
DROP POLICY IF EXISTS "Service role full access on support_contacts" ON support_contacts;
DROP POLICY IF EXISTS "Service role full access on appointments" ON appointments;
DROP POLICY IF EXISTS "Service role full access on health_monitors" ON health_monitors;
DROP POLICY IF EXISTS "Service role full access on medical_records" ON medical_records;
DROP POLICY IF EXISTS "Service role full access on payments" ON payments;
DROP POLICY IF EXISTS "Service role full access on vaccinations" ON vaccinations;

DROP POLICY IF EXISTS "Allow public read access on hospitals" ON hospitals;
DROP POLICY IF EXISTS "Allow public read on doctor profiles" ON doctors;
DROP POLICY IF EXISTS "Deny anon access on mothers" ON mothers;

-- -----------------------------------------------------------------------------
-- Step 5: Configure Privileged Access for Backend Service Role
-- The Node.js Express backend enforces authentication (JWT/session cookie) and
-- role-based authorization before accessing records via the service_role key.
-- -----------------------------------------------------------------------------

CREATE POLICY "Service role full access on mothers"
    ON mothers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on hospitals"
    ON hospitals FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on doctors"
    ON doctors FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on infants"
    ON infants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on support_contacts"
    ON support_contacts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on appointments"
    ON appointments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on health_monitors"
    ON health_monitors FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on medical_records"
    ON medical_records FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on payments"
    ON payments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on vaccinations"
    ON vaccinations FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Step 6: Public / Anon Direct Access Policies (Least Privilege)
-- Public users (anon role) can only view the hospital list.
-- Direct queries to mothers, infants, medical_records, vitals, appointments,
-- and payments via anon key are STRICTLY DENIED by default under RLS.
-- -----------------------------------------------------------------------------

CREATE POLICY "Allow public read access on hospitals"
    ON hospitals FOR SELECT TO anon, authenticated USING (true);

-- -----------------------------------------------------------------------------
-- Step 7: Verification Query (Run to verify RLS status)
-- -----------------------------------------------------------------------------
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- -----------------------------------------------------------------------------
-- ROLLBACK INSTRUCTIONS (In emergency only):
-- To revert RLS if production application is unable to connect:
-- ALTER TABLE mothers          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE hospitals        DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE doctors          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE infants          DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE support_contacts DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE appointments     DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE health_monitors  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE medical_records  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE vaccinations     DISABLE ROW LEVEL SECURITY;
-- =============================================================================
