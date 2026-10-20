-- =============================================================================
-- Maternix — Appointment Booking & Scheduling Schema Migration
-- File: backend/migrations/02_appointment_scheduling.sql
--
-- PURPOSE:
-- Upgrades the appointments table to support interactive appointment booking,
-- time slot scheduling, visit reasons, appointment types, doctor notes, and
-- database-level prevention of double-booking.
--
-- IMPORTANT OPERATOR NOTICE:
-- 1. This migration is completely non-destructive and backward compatible.
-- 2. It uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- 3. Run in Supabase SQL Editor: Dashboard -> SQL Editor -> New query -> Paste -> Run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Add Missing Columns to Appointments Table
-- -----------------------------------------------------------------------------

-- Appointment time slot (e.g. '09:00 AM', '10:30 AM')
ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS appointment_time VARCHAR(20) DEFAULT '10:00 AM';

-- Reason for visit / chief complaint (e.g. 'Routine checkup', 'Ultrasound scan')
ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS reason TEXT;

-- Appointment type category (e.g. 'Prenatal Checkup', 'Ultrasound Scan', 'Follow-up')
ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(100) DEFAULT 'Prenatal Checkup';

-- Doctor/Patient remarks, reschedule explanation, or rejection reason
ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Audit timestamps
ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE appointments 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- -----------------------------------------------------------------------------
-- Step 2: Seed Initial Time Slots and Reasons for Existing Demo Appointments
-- -----------------------------------------------------------------------------

UPDATE appointments 
SET appointment_time = '10:00 AM', 
    reason = 'Routine Prenatal Consultation', 
    appointment_type = 'Prenatal Checkup' 
WHERE appointment_time IS NULL OR reason IS NULL;

-- -----------------------------------------------------------------------------
-- Step 3: Performance Indexes & Anti-Double-Booking Constraint
-- -----------------------------------------------------------------------------

-- Optimize query performance for doctor and patient dashboards
CREATE INDEX IF NOT EXISTS idx_appointments_mother_date 
    ON appointments (mother_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date 
    ON appointments (doctor_id, appointment_date);

-- Database-level safeguard against double-booking:
-- Ensures a doctor cannot be scheduled for two non-cancelled appointments at the identical date and time slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot 
    ON appointments (doctor_id, appointment_date, appointment_time) 
    WHERE status NOT IN ('Cancelled', 'Rejected');

-- -----------------------------------------------------------------------------
-- Step 4: Verification Query
-- -----------------------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'appointments';
--
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'appointments';

-- -----------------------------------------------------------------------------
-- ROLLBACK INSTRUCTIONS (Emergency Only):
-- DROP INDEX IF EXISTS idx_appointments_doctor_slot;
-- DROP INDEX IF EXISTS idx_appointments_doctor_date;
-- DROP INDEX IF EXISTS idx_appointments_mother_date;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS notes;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS appointment_type;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS reason;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS appointment_time;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS created_at;
-- ALTER TABLE appointments DROP COLUMN IF EXISTS updated_at;
-- =============================================================================
