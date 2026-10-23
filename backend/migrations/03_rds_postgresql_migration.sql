-- =============================================================================
-- Maternix — Amazon RDS for PostgreSQL Production Migration
-- File: backend/migrations/03_rds_postgresql_migration.sql
--
-- TARGET DATABASE: Amazon RDS for PostgreSQL (Engine version 14.x, 15.x, or 16.x)
--
-- PURPOSE:
-- 1. Complete, idempotent DDL schema for all 10 Maternix platform tables.
-- 2. Foreign keys, primary keys, check constraints, and performance indexes.
-- 3. Database-level double-booking protection (conditional unique index).
-- 4. Automated timestamp update triggers.
-- 5. Complete, sanitized demo seed data with pre-computed bcrypt password hashes.
-- 6. Sequence synchronization for serial primary keys.
-- 7. Amazon RDS least-privilege security role definition ('maternix_app').
--
-- OPERATOR RUN INSTRUCTIONS:
-- 1. Connect to your Amazon RDS PostgreSQL instance via psql:
--    psql "host=<rds-endpoint> port=5432 dbname=maternix user=maternix_admin sslmode=require"
-- 2. Execute this migration script:
--    \i backend/migrations/03_rds_postgresql_migration.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1: Utility Functions & Triggers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Step 2: Table DDL Definitions (10 Core Tables)
-- -----------------------------------------------------------------------------

-- 1. Hospitals Table
CREATE TABLE IF NOT EXISTS hospitals (
    hospital_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location VARCHAR(255),
    contact_no VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Mothers / Patients Table
CREATE TABLE IF NOT EXISTS mothers (
    mother_id SERIAL PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT,
    status TEXT DEFAULT 'pregnant' CHECK (status IN ('pregnant', 'postnatal')),
    due_date DATE,
    current_week INT DEFAULT 1,
    age INT,
    blood_group VARCHAR(10),
    pregnancy_stage INT DEFAULT 1,
    medical_history TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    doctor_id VARCHAR(50) PRIMARY KEY,
    user_id BIGINT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password TEXT,
    specialization TEXT,
    experience INT DEFAULT 0,
    contact_no VARCHAR(50),
    hospitalref_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Infants Table
CREATE TABLE IF NOT EXISTS infants (
    infant_id SERIAL PRIMARY KEY,
    mother_id INT NOT NULL REFERENCES mothers(mother_id) ON DELETE CASCADE,
    name TEXT,
    date_of_birth DATE,
    gender VARCHAR(20),
    weight INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Support Contacts Table
CREATE TABLE IF NOT EXISTS support_contacts (
    support_id SERIAL PRIMARY KEY,
    mother_id INT NOT NULL REFERENCES mothers(mother_id) ON DELETE CASCADE,
    contact_name TEXT,
    contact_number VARCHAR(50),
    relation VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id SERIAL PRIMARY KEY,
    mother_id INT NOT NULL REFERENCES mothers(mother_id) ON DELETE CASCADE,
    doctor_id VARCHAR(50) NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    appointment_date DATE NOT NULL,
    appointment_time VARCHAR(20) DEFAULT '10:00 AM',
    reason TEXT,
    appointment_type VARCHAR(100) DEFAULT 'Prenatal Checkup',
    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Scheduled', 'Completed', 'Cancelled', 'Rejected', 'Rescheduled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Health Monitors Table (Maternal & Infant Vitals)
CREATE TABLE IF NOT EXISTS health_monitors (
    monitor_id SERIAL PRIMARY KEY,
    mother_id INT NOT NULL REFERENCES mothers(mother_id) ON DELETE CASCADE,
    infant_id INT REFERENCES infants(infant_id) ON DELETE SET NULL,
    blood_pressure INT,
    sugar_level REAL,
    weight REAL,
    record_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Medical Records Table (Diagnoses & Prescriptions)
CREATE TABLE IF NOT EXISTS medical_records (
    record_id SERIAL PRIMARY KEY,
    mother_id INT NOT NULL REFERENCES mothers(mother_id) ON DELETE CASCADE,
    infant_id INT REFERENCES infants(infant_id) ON DELETE SET NULL,
    diagnosis TEXT NOT NULL,
    prescription TEXT NOT NULL,
    record_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    payment_id SERIAL PRIMARY KEY,
    appointment_id INT REFERENCES appointments(appointment_id) ON DELETE SET NULL,
    amount REAL DEFAULT 0,
    payment_method VARCHAR(50),
    payment_status VARCHAR(50) DEFAULT 'Pending',
    payment_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Vaccinations Table
CREATE TABLE IF NOT EXISTS vaccinations (
    vaccination_id SERIAL PRIMARY KEY,
    infant_id INT NOT NULL REFERENCES infants(infant_id) ON DELETE CASCADE,
    vaccine_name VARCHAR(100) NOT NULL,
    vaccination_date DATE,
    next_due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Step 3: Performance Indexes & Anti-Double-Booking Constraint
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_mothers_email ON mothers (email);
CREATE INDEX IF NOT EXISTS idx_mothers_username ON mothers (username);
CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors (specialization);

CREATE INDEX IF NOT EXISTS idx_appointments_mother_date ON appointments (mother_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments (doctor_id, appointment_date);

-- Database-level Anti-Double-Booking Constraint:
-- Ensures a doctor cannot be booked for two active appointments at the same date and time slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot 
    ON appointments (doctor_id, appointment_date, appointment_time) 
    WHERE status NOT IN ('Cancelled', 'Rejected');

CREATE INDEX IF NOT EXISTS idx_health_monitors_mother_date ON health_monitors (mother_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_medical_records_mother_date ON medical_records (mother_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_vaccinations_infant ON vaccinations (infant_id);

-- -----------------------------------------------------------------------------
-- Step 4: Triggers for Automated updated_at Maintenance
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_mothers_updated_at ON mothers;
CREATE TRIGGER trg_mothers_updated_at
    BEFORE UPDATE ON mothers
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_doctors_updated_at ON doctors;
CREATE TRIGGER trg_doctors_updated_at
    BEFORE UPDATE ON doctors
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON appointments;
CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_timestamp();

-- -----------------------------------------------------------------------------
-- Step 5: Demonstration Seed Data (Clean Initial Baseline)
-- Pre-computed 10-round bcrypt hashes:
-- 'password123' -> $2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52
-- 'doctor123'   -> $2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW
-- -----------------------------------------------------------------------------

-- Hospitals
INSERT INTO hospitals (hospital_id, name, location, contact_no) VALUES
(1, 'City Hospital', 'Chennai', '+9198000000001'),
(2, 'Green Care', 'Bangalore', '+9198000000002'),
(3, 'MotherCare Clinic', 'Vellore', '+9198000000003')
ON CONFLICT (hospital_id) DO UPDATE SET
    name = EXCLUDED.name,
    location = EXCLUDED.location,
    contact_no = EXCLUDED.contact_no;

-- Doctors
INSERT INTO doctors (doctor_id, user_id, name, email, password, specialization, experience, contact_no, hospitalref_id) VALUES
('DOC001', 201, 'Dr. Rajesh Kumar', 'doc001@maternix.portal', '$2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW', 'Senior OB-GYN and Maternal-Fetal specialist', 7, '+919876543276', '1'),
('DOC002', 202, 'Dr. Anita Sharma', 'doc002@maternix.portal', '$2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW', 'Anesthesiologist', 6, '+919876543895', '1'),
('DOC003', 203, 'Dr. Vikram Patel', 'doc003@maternix.portal', '$2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW', 'Pediatrician', 5, '+919876543093', '2'),
('DOC004', 204, 'Dr. Sonia Mehta', 'doc004@maternix.portal', '$2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW', 'Laparoscopic surgeon', 8, '+919876543281', '1'),
('DOC005', 205, 'Dr. Arjun Nair', 'doc005@maternix.portal', '$2b$10$d4tv4yujWhwTowq.lf4eYeprYrdE6ejL.zjd.vj3BS4As67bmFkUW', 'Fetal medicine expert', 6, '+919876543674', '3')
ON CONFLICT (doctor_id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    password = EXCLUDED.password,
    specialization = EXCLUDED.specialization,
    experience = EXCLUDED.experience,
    contact_no = EXCLUDED.contact_no,
    hospitalref_id = EXCLUDED.hospitalref_id;

-- Mothers
INSERT INTO mothers (mother_id, first_name, last_name, email, username, password, status, due_date, current_week, age, blood_group, pregnancy_stage, medical_history) VALUES
(1, 'Priya', 'Sharma', 'priya@example.com', 'priya', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-08-15', 28, 24, 'O+', 1, 'Routine'),
(2, 'Neha', 'Gupta', 'neha@example.com', 'neha', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-07-10', 32, 29, 'A+', 2, 'Mild Anemia'),
(3, 'Anjali', 'Singh', 'anjali@example.com', 'anjali', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-09-20', 25, 32, 'B+', 3, 'Gestational diabetes'),
(4, 'Divya', 'Patel', 'divya@example.com', 'divya', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'postnatal', NULL, 0, 27, 'AB+', 0, 'Hypothyroidism'),
(5, 'Meera', 'Malhotra', 'meera@example.com', 'meera', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'postnatal', NULL, 0, 35, 'O-', 0, 'Previous C-section'),
(6, 'Kavya', 'Reddy', 'kavya@example.com', 'kavya', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-11-01', 12, 22, 'A-', 1, NULL),
(7, 'Sunita', 'Nair', 'sunita@example.com', 'sunita', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-06-28', 34, 30, 'B-', 3, 'Hypertension'),
(8, 'Ranjitha', 'Kumar', 'ranjitha@example.com', 'ranjitha', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'postnatal', NULL, 0, 26, 'O+', 0, 'Iron deficiency Anemia'),
(9, 'Pallavi', 'Iyer', 'pallavi@example.com', 'pallavi', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-09-05', 20, 31, 'AB-', 3, 'Asthma'),
(10, 'Swathi', 'Menon', 'swathi@example.com', 'swathi', '$2b$10$LrSkn47DHsPhVZv0.hUr/evhYV1Qbz24shGsT4DWcE7PPN85OVz52', 'pregnant', '2026-12-10', 8, 28, 'O+', 1, NULL)
ON CONFLICT (mother_id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    username = EXCLUDED.username,
    password = EXCLUDED.password,
    status = EXCLUDED.status,
    due_date = EXCLUDED.due_date,
    current_week = EXCLUDED.current_week,
    age = EXCLUDED.age,
    blood_group = EXCLUDED.blood_group,
    pregnancy_stage = EXCLUDED.pregnancy_stage,
    medical_history = EXCLUDED.medical_history;

-- Infants
INSERT INTO infants (infant_id, mother_id, name, date_of_birth, gender, weight) VALUES
(1, 1, 'Baby_1', '2026-05-01', 'Male', 2),
(2, 2, 'Baby_2', '2026-05-02', 'Female', 3),
(3, 3, 'Baby_3', '2026-05-03', 'Male', 4),
(4, 4, 'Baby_4', '2026-05-04', 'Female', 2),
(5, 5, 'Baby_5', '2026-05-05', 'Male', 3),
(6, 6, 'Baby_6', '2026-05-06', 'Female', 4),
(7, 7, 'Baby_7', '2026-05-07', 'Male', 2),
(8, 8, 'Baby_8', '2026-05-08', 'Female', 3),
(9, 9, 'Baby_9', '2026-05-09', 'Male', 4),
(10, 10, 'Baby_10', '2026-05-10', 'Female', 2)
ON CONFLICT (infant_id) DO UPDATE SET
    name = EXCLUDED.name,
    date_of_birth = EXCLUDED.date_of_birth,
    gender = EXCLUDED.gender,
    weight = EXCLUDED.weight;

-- Support Contacts
INSERT INTO support_contacts (support_id, mother_id, contact_name, contact_number, relation) VALUES
(1, 2, 'Contact_1', '+919811111111', 'Husband'),
(2, 4, 'Contact_2', '+919811111112', 'Mother'),
(3, 6, 'Contact_3', '+919811111113', 'Sister'),
(4, 8, 'Contact_4', '+919811111114', 'Friend'),
(5, 10, 'Contact_5', '+919811111115', 'Brother')
ON CONFLICT (support_id) DO UPDATE SET
    contact_name = EXCLUDED.contact_name,
    contact_number = EXCLUDED.contact_number,
    relation = EXCLUDED.relation;

-- Appointments
INSERT INTO appointments (appointment_id, mother_id, doctor_id, appointment_date, appointment_time, reason, appointment_type, status, notes) VALUES
(1, 1, 'DOC001', '2026-06-01', '10:00 AM', 'Routine Monthly Checkup', 'Prenatal Checkup', 'Scheduled', NULL),
(2, 2, 'DOC002', '2026-06-02', '11:00 AM', 'Pain Management Consultation', 'Consultation', 'Completed', 'Checkup completed'),
(3, 3, 'DOC003', '2026-06-03', '02:00 PM', 'Pediatric follow-up', 'Follow-up', 'Cancelled', 'Cancelled by patient'),
(4, 4, 'DOC004', '2026-06-04', '03:00 PM', 'Postnatal Surgical Review', 'Postnatal Review', 'Completed', 'Healing well'),
(5, 5, 'DOC005', '2026-06-05', '09:30 AM', 'Fetal Growth Scan', 'Ultrasound Scan', 'Scheduled', NULL),
(6, 6, 'DOC001', '2026-06-06', '10:30 AM', 'Routine Second Trimester Consultation', 'Prenatal Checkup', 'Completed', NULL),
(7, 7, 'DOC002', '2026-06-07', '02:30 PM', 'Hypertension review', 'Consultation', 'Scheduled', NULL),
(8, 8, 'DOC003', '2026-06-08', '03:30 PM', 'Postpartum pediatric check', 'Follow-up', 'Cancelled', 'Rescheduled to next week'),
(9, 9, 'DOC004', '2026-06-09', '04:00 PM', 'Asthma management in pregnancy', 'Consultation', 'Completed', 'Prescription updated'),
(10, 10, 'DOC005', '2026-06-10', '11:30 AM', 'First trimester ultrasound', 'Ultrasound Scan', 'Scheduled', NULL)
ON CONFLICT (appointment_id) DO UPDATE SET
    appointment_date = EXCLUDED.appointment_date,
    appointment_time = EXCLUDED.appointment_time,
    reason = EXCLUDED.reason,
    appointment_type = EXCLUDED.appointment_type,
    status = EXCLUDED.status,
    notes = EXCLUDED.notes;

-- Health Monitors
INSERT INTO health_monitors (monitor_id, mother_id, infant_id, blood_pressure, sugar_level, weight, record_date) VALUES
(1, 1, 1, 120, 90, 60, '2026-06-01'),
(2, 2, 2, 121, 95, 61, '2026-06-02'),
(3, 3, 3, 122, 100, 62, '2026-06-03'),
(4, 4, 4, 123, 105, 63, '2026-06-04'),
(5, 5, 5, 124, 110, 64, '2026-06-05'),
(6, 6, 6, 125, 115, 65, '2026-06-06'),
(7, 7, 7, 126, 120, 66, '2026-06-07'),
(8, 8, 8, 127, 125, 67, '2026-06-08'),
(9, 9, 9, 128, 130, 68, '2026-06-09'),
(10, 10, 10, 129, 135, 69, '2026-06-10')
ON CONFLICT (monitor_id) DO UPDATE SET
    blood_pressure = EXCLUDED.blood_pressure,
    sugar_level = EXCLUDED.sugar_level,
    weight = EXCLUDED.weight,
    record_date = EXCLUDED.record_date;

-- Medical Records
INSERT INTO medical_records (record_id, mother_id, infant_id, diagnosis, prescription, record_date) VALUES
(1, 1, 1, 'Normal routine pregnancy', 'Prenatal multivitamins and iron supplements', '2026-06-01'),
(2, 2, 2, 'Mild Anemia', 'Ferrous sulfate 200mg once daily', '2026-06-02'),
(3, 3, 3, 'Gestational Diabetes', 'Dietary control and glucose monitoring 3x daily', '2026-06-03'),
(4, 4, 4, 'Hypertension', 'Labetalol 100mg twice daily with food', '2026-06-04'),
(5, 5, 5, 'Thyroid (Hypothyroidism)', 'Levothyroxine 50mcg empty stomach', '2026-06-05'),
(6, 6, 6, 'Normal pregnancy', 'Folic acid 5mg daily', '2026-06-06'),
(7, 7, 7, 'Gestational Anemia', 'Iron + Vitamin C chewable', '2026-06-07'),
(8, 8, 8, 'Postnatal review', 'Routine post-partum care', '2026-06-08'),
(9, 9, 9, 'Asthma in pregnancy', 'Budesonide inhaler as prescribed', '2026-06-09'),
(10, 10, 10, 'Early trimester nausea', 'Pyridoxine 10mg as needed', '2026-06-10')
ON CONFLICT (record_id) DO UPDATE SET
    diagnosis = EXCLUDED.diagnosis,
    prescription = EXCLUDED.prescription,
    record_date = EXCLUDED.record_date;

-- Payments
INSERT INTO payments (payment_id, appointment_id, amount, payment_method, payment_status, payment_date) VALUES
(1, 1, 500, 'UPI', 'Paid', '2026-06-01'),
(2, 2, 550, 'Card', 'Pending', '2026-06-02'),
(3, 3, 600, 'Cash', 'Paid', '2026-06-03'),
(4, 4, 650, 'UPI', 'Pending', '2026-06-04'),
(5, 5, 700, 'Card', 'Paid', '2026-06-05'),
(6, 6, 750, 'UPI', 'Pending', '2026-06-06'),
(7, 7, 800, 'Card', 'Paid', '2026-06-07'),
(8, 8, 850, 'Cash', 'Pending', '2026-06-08'),
(9, 9, 900, 'UPI', 'Paid', '2026-06-09')
ON CONFLICT (payment_id) DO UPDATE SET
    amount = EXCLUDED.amount,
    payment_method = EXCLUDED.payment_method,
    payment_status = EXCLUDED.payment_status,
    payment_date = EXCLUDED.payment_date;

-- Vaccinations
INSERT INTO vaccinations (vaccination_id, infant_id, vaccine_name, vaccination_date, next_due_date) VALUES
(1, 1, 'BCG', '2026-05-01', '2026-06-01'),
(2, 2, 'HepB', '2026-05-02', '2026-06-02'),
(3, 3, 'Polio', '2026-05-03', '2026-06-03'),
(4, 4, 'DPT', '2026-05-04', '2026-06-04'),
(5, 5, 'MMR', '2026-05-05', '2026-06-05'),
(6, 6, 'BCG', '2026-05-06', '2026-06-06'),
(7, 7, 'HepB', '2026-05-07', '2026-06-07'),
(8, 8, 'Polio', '2026-05-08', '2026-06-08'),
(9, 9, 'DPT', '2026-05-09', '2026-06-09'),
(10, 10, 'MMR', '2026-05-10', '2026-06-10')
ON CONFLICT (vaccination_id) DO UPDATE SET
    vaccine_name = EXCLUDED.vaccine_name,
    vaccination_date = EXCLUDED.vaccination_date,
    next_due_date = EXCLUDED.next_due_date;

-- -----------------------------------------------------------------------------
-- Step 6: Sequence Synchronization
-- Resets sequence counters to MAX(id) to ensure subsequent auto-increments succeed
-- -----------------------------------------------------------------------------

SELECT setval('mothers_mother_id_seq', (SELECT COALESCE(MAX(mother_id), 1) FROM mothers));
SELECT setval('hospitals_hospital_id_seq', (SELECT COALESCE(MAX(hospital_id), 1) FROM hospitals));
SELECT setval('infants_infant_id_seq', (SELECT COALESCE(MAX(infant_id), 1) FROM infants));
SELECT setval('support_contacts_support_id_seq', (SELECT COALESCE(MAX(support_id), 1) FROM support_contacts));
SELECT setval('appointments_appointment_id_seq', (SELECT COALESCE(MAX(appointment_id), 1) FROM appointments));
SELECT setval('health_monitors_monitor_id_seq', (SELECT COALESCE(MAX(monitor_id), 1) FROM health_monitors));
SELECT setval('medical_records_record_id_seq', (SELECT COALESCE(MAX(record_id), 1) FROM medical_records));
SELECT setval('payments_payment_id_seq', (SELECT COALESCE(MAX(payment_id), 1) FROM payments));
SELECT setval('vaccinations_vaccination_id_seq', (SELECT COALESCE(MAX(vaccination_id), 1) FROM vaccinations));

-- -----------------------------------------------------------------------------
-- Step 7: Amazon RDS Least-Privilege Role Provisioning Instructions
-- (Run as 'maternix_admin' or RDS master user)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maternix_app') THEN
        CREATE ROLE maternix_app WITH LOGIN PASSWORD 'CHANGE_TO_SECURE_RANDOM_PASSWORD_FOR_RDS_APP';
    END IF;
END
$$;

GRANT CONNECT ON DATABASE maternix TO maternix_app;
GRANT USAGE ON SCHEMA public TO maternix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO maternix_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO maternix_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO maternix_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO maternix_app;

COMMIT;

-- -----------------------------------------------------------------------------
-- Step 8: Migration Verification Query
-- -----------------------------------------------------------------------------
-- SELECT table_name, (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) AS column_count
-- FROM information_schema.tables t
-- WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
-- ORDER BY table_name;
