-- =============================================================================
-- Maternix — Supabase Database Schema
-- Run this entire file in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → Paste → Run)
-- =============================================================================

-- 1. Create and Populate "mothers" Table
CREATE TABLE mothers (
    mother_id SERIAL PRIMARY KEY,
    age INT,
    blood_group TEXT,
    pregnancy_stage INT,
    medical_history TEXT
);

INSERT INTO mothers (mother_id, age, blood_group, pregnancy_stage, medical_history) VALUES
(1, 24, 'O+', 1, NULL),
(2, 29, 'A+', 2, 'Mild Anemia'),
(3, 32, 'B+', 3, 'Gestational diabetes'),
(4, 27, 'AB+', 1, 'Hypothyroidism'),
(5, 35, 'O-', 2, 'Previous C-section'),
(6, 22, 'A-', 1, NULL),
(7, 30, 'B-', 3, 'Hypertension'),
(8, 26, 'O+', 2, 'Iron deficiency Anemia'),
(9, 31, 'AB-', 3, 'Asthma'),
(10, 28, 'O+', 1, NULL);


-- 2. Create and Populate "hospitals" Table
CREATE TABLE hospitals (
    hospital_id SERIAL PRIMARY KEY,
    name TEXT,
    location VARCHAR,
    contact_no VARCHAR
);

INSERT INTO hospitals (hospital_id, name, location, contact_no) VALUES
(1, 'City Hospital', 'Chennai', '+9198000000001'),
(2, 'Green Care', 'Bangalore', '+9198000000002'),
(3, 'MotherCare Clinic', 'Vellore', '+9198000000003');


-- 3. Create and Populate "doctors" Table
CREATE TABLE doctors (
    doctor_id VARCHAR PRIMARY KEY,
    user_id BIGINT,
    specialization TEXT,
    experience INT,
    contact_no VARCHAR,
    hospitalref_id VARCHAR
);

INSERT INTO doctors (doctor_id, user_id, specialization, experience, contact_no, hospitalref_id) VALUES
('DOC001', 201, 'Senior OB-GYN and Maternal-Fetal specialist', 7, '+919876543276', 'CHN-600-127'),
('DOC002', 202, 'Anesthesiologist', 6, '+919876543895', 'CHN-600-127'),
('DOC003', 203, 'Pediatrician', 5, '+919876543093', 'CHN-600-127'),
('DOC004', 204, 'Laparoscopic surgeon', 8, '+919876543281', 'CHN-600-127'),
('DOC005', 205, 'Fetal medicine expert', 6, '+919876543674', 'CHN-600-127');


-- 4. Create and Populate "infants" Table
CREATE TABLE infants (
    infant_id SERIAL PRIMARY KEY,
    mother_id INT REFERENCES mothers(mother_id),
    name TEXT,
    date_of_birth DATE,
    gender TEXT,
    weight INT
);

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
(10, 10, 'Baby_10', '2026-05-10', 'Female', 2);


-- 5. Create and Populate "support_contacts" Table
CREATE TABLE support_contacts (
    support_id SERIAL PRIMARY KEY,
    mother_id INT REFERENCES mothers(mother_id),
    contact_name TEXT,
    contact_number VARCHAR,
    relation TEXT
);

INSERT INTO support_contacts (support_id, mother_id, contact_name, contact_number, relation) VALUES
(1, 2, 'Contact_1', '+919811111111', 'Husband'),
(2, 4, 'Contact_2', '+919811111112', 'Mother'),
(3, 6, 'Contact_3', '+919811111113', 'Sister'),
(4, 8, 'Contact_4', '+919811111114', 'Friend'),
(5, 10, 'Contact_5', '+919811111115', 'Brother');


-- 6. Create and Populate "appointments" Table
CREATE TABLE appointments (
    appointment_id SERIAL PRIMARY KEY,
    mother_id INT REFERENCES mothers(mother_id),
    doctor_id VARCHAR REFERENCES doctors(doctor_id),
    appointment_date DATE,
    status TEXT
);

INSERT INTO appointments (appointment_id, mother_id, doctor_id, appointment_date, status) VALUES
(1, 1, 'DOC001', '2026-06-01', 'Scheduled'),
(2, 2, 'DOC002', '2026-06-02', 'Completed'),
(3, 3, 'DOC003', '2026-06-03', 'Cancelled'),
(4, 4, 'DOC004', '2026-06-04', 'Completed'),
(5, 5, 'DOC005', '2026-06-05', 'Scheduled'),
(6, 6, 'DOC001', '2026-06-06', 'Completed'),
(7, 7, 'DOC002', '2026-06-07', 'Scheduled'),
(8, 8, 'DOC003', '2026-06-08', 'Cancelled'),
(9, 9, 'DOC004', '2026-06-09', 'Completed'),
(10, 10, 'DOC005', '2026-06-10', 'Scheduled');


-- 7. Create and Populate "health_monitors" Table
CREATE TABLE health_monitors (
    monitor_id SERIAL PRIMARY KEY,
    mother_id INT REFERENCES mothers(mother_id),
    infant_id INT REFERENCES infants(infant_id),
    blood_pressure INT,
    sugar_level REAL,
    weight REAL,
    record_date DATE
);

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
(10, 10, 10, 129, 135, 69, '2026-06-10');


-- 8. Create and Populate "medical_records" Table
CREATE TABLE medical_records (
    record_id SERIAL PRIMARY KEY,
    mother_id INT REFERENCES mothers(mother_id),
    infant_id INT REFERENCES infants(infant_id),
    diagnosis TEXT,
    prescription TEXT,
    record_date DATE
);

INSERT INTO medical_records (record_id, mother_id, infant_id, diagnosis, prescription, record_date) VALUES
(1, 1, 1, 'Normal', 'Routine', '2026-06-01'),
(2, 2, 2, 'Anemia', 'Iron', '2026-06-02'),
(3, 3, 3, 'Diabetes', 'Insulin', '2026-06-03'),
(4, 4, 4, 'Hypertension', 'BP meds', '2026-06-04'),
(5, 5, 5, 'Thyroid', 'Thyroxine', '2026-06-05'),
(6, 6, 6, 'Normal', 'Routine', '2026-06-06'),
(7, 7, 7, 'Anemia', 'Iron', '2026-06-07'),
(8, 8, 8, 'Diabetes', 'Insulin', '2026-06-08'),
(9, 9, 9, 'Hypertension', 'BP meds', '2026-06-09'),
(10, 10, 10, 'Thyroid', 'Thyroxine', '2026-06-10');


-- 9. Create and Populate "payments" Table
CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    appointment_id INT REFERENCES appointments(appointment_id),
    amount REAL,
    payment_method TEXT,
    payment_status TEXT,
    payment_date DATE
);

INSERT INTO payments (payment_id, appointment_id, amount, payment_method, payment_status, payment_date) VALUES
(1, 1, 500, 'UPI', 'Paid', '2026-06-01'),
(2, 2, 550, 'Card', 'Pending', '2026-06-02'),
(3, 3, 600, 'Cash', 'Paid', '2026-06-03'),
(4, 4, 650, 'UPI', 'Pending', '2026-06-04'),
(5, 5, 700, 'Card', 'Paid', '2026-06-05'),
(6, 6, 750, 'UPI', 'Pending', '2026-06-06'),
(7, 7, 800, 'Card', 'Paid', '2026-06-07'),
(8, 8, 850, 'Cash', 'Pending', '2026-06-08'),
(9, 9, 900, 'UPI', 'Paid', '2026-06-09');


-- 10. Create and Populate "vaccinations" Table
CREATE TABLE vaccinations (
    vaccination_id SERIAL PRIMARY KEY,
    infant_id INT REFERENCES infants(infant_id),
    vaccine_name VARCHAR,
    vaccination_date DATE,
    next_due_date DATE
);

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
(10, 10, 'MMR', '2026-05-10', '2026-06-10');


-- =============================================================================
-- EXTENSION: Add UI-required columns to mothers and doctors tables
-- These columns allow the frontend to display names, email, and link auth sessions
-- =============================================================================

ALTER TABLE mothers ADD COLUMN IF NOT EXISTS first_name  TEXT;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS last_name   TEXT;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS email       TEXT UNIQUE;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS username    TEXT UNIQUE;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'pregnant';  -- 'pregnant' | 'postnatal'
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS due_date    DATE;
ALTER TABLE mothers ADD COLUMN IF NOT EXISTS current_week INT DEFAULT 1;

-- Seed display names matching the demo credentials in login.html
UPDATE mothers SET first_name='Priya',  last_name='Sharma',   email='priya@example.com',  username='priya',  status='pregnant',  current_week=28, due_date='2026-08-15' WHERE mother_id=1;
UPDATE mothers SET first_name='Neha',   last_name='Gupta',    email='neha@example.com',   username='neha',   status='pregnant',  current_week=32, due_date='2026-07-10' WHERE mother_id=2;
UPDATE mothers SET first_name='Anjali', last_name='Singh',    email='anjali@example.com', username='anjali', status='pregnant',  current_week=25, due_date='2026-09-20' WHERE mother_id=3;
UPDATE mothers SET first_name='Divya',  last_name='Patel',    email='divya@example.com',  username='divya',  status='postnatal', current_week=0                          WHERE mother_id=4;
UPDATE mothers SET first_name='Meera',  last_name='Malhotra', email='meera@example.com',  username='meera',  status='postnatal', current_week=0                          WHERE mother_id=5;
UPDATE mothers SET first_name='Kavya',  last_name='Reddy',    email='kavya@example.com',  username='kavya',  status='pregnant',  current_week=12, due_date='2026-11-01' WHERE mother_id=6;
UPDATE mothers SET first_name='Sunita', last_name='Nair',     email='sunita@example.com', username='sunita', status='pregnant',  current_week=34, due_date='2026-06-28' WHERE mother_id=7;
UPDATE mothers SET first_name='Ranjitha',last_name='Kumar',   email='ranjitha@example.com',username='ranjitha',status='postnatal',current_week=0                         WHERE mother_id=8;
UPDATE mothers SET first_name='Pallavi', last_name='Iyer',    email='pallavi@example.com',username='pallavi',status='pregnant',  current_week=20, due_date='2026-09-05' WHERE mother_id=9;
UPDATE mothers SET first_name='Swathi',  last_name='Menon',   email='swathi@example.com', username='swathi', status='pregnant',  current_week=8,  due_date='2026-12-10' WHERE mother_id=10;

-- Add doctor display names
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS name        TEXT;
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS email       TEXT UNIQUE;

UPDATE doctors SET name='Dr. Rajesh Kumar',   email='doc001@maternix.portal' WHERE doctor_id='DOC001';
UPDATE doctors SET name='Dr. Anita Sharma',   email='doc002@maternix.portal' WHERE doctor_id='DOC002';
UPDATE doctors SET name='Dr. Vikram Patel',   email='doc003@maternix.portal' WHERE doctor_id='DOC003';
UPDATE doctors SET name='Dr. Sonia Mehta',    email='doc004@maternix.portal' WHERE doctor_id='DOC004';
UPDATE doctors SET name='Dr. Arjun Nair',     email='doc005@maternix.portal' WHERE doctor_id='DOC005';


-- =============================================================================
-- DISABLE Row Level Security for local development
-- IMPORTANT: Enable RLS and add policies before deploying to production!
-- =============================================================================

ALTER TABLE mothers          DISABLE ROW LEVEL SECURITY;
ALTER TABLE hospitals        DISABLE ROW LEVEL SECURITY;
ALTER TABLE doctors          DISABLE ROW LEVEL SECURITY;
ALTER TABLE infants          DISABLE ROW LEVEL SECURITY;
ALTER TABLE support_contacts DISABLE ROW LEVEL SECURITY;
ALTER TABLE appointments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE health_monitors  DISABLE ROW LEVEL SECURITY;
ALTER TABLE medical_records  DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments         DISABLE ROW LEVEL SECURITY;
ALTER TABLE vaccinations     DISABLE ROW LEVEL SECURITY;
