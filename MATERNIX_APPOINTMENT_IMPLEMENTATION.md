# Maternix Appointment Booking & Scheduling Implementation

## 1. Overview
This document details the architecture, database migrations, backend REST endpoints, frontend implementations, and test results for the complete, production-grade appointment booking and scheduling workflow across both the **Patient Dashboard** and the **Doctor Dashboard** in Maternix.

---

## 2. Files Modified & Created

| File | Status | Description |
|---|---|---|
| `backend/migrations/02_appointment_scheduling.sql` | **Created** | Non-destructive SQL migration adding required scheduling columns, foreign key constraints, indexes, and a partial unique index to prevent doctor double-booking. |
| `backend/server.js` | **Modified** | Implemented appointment booking, slot generation, cancellation, doctor confirmation, rejection, rescheduling, and follow-up APIs with anti-double-booking checks, role authorization, and fallback mock support. |
| `frontend/dashboard.html` | **Modified** | Added prominent `+ Book Appointment` button, responsive booking modal with specialization filter, doctor picker, dynamic time slot grid, reason/notes fields, appointment details modal, cancellation policy enforcement, and live data rendering. |
| `frontend/doctor-dashboard.html` | **Modified** | Added "Appointments" sidebar nav item and panel, summary counters (Pending, Scheduled, Rescheduled, Total), filter tabs, appointment cards with action controls (Accept, Reschedule, Reject, Follow-up), doctor reschedule modal, and follow-up modal. |
| `test/suite.js` | **Modified** | Expanded automated test suite from 24 to 45 integration tests covering authentication, doctor directory, slot availability, double-booking prevention, cancellations, status transitions, doctor actions, and role authorization. |
| `MATERNIX_APPOINTMENT_IMPLEMENTATION.md` | **Created** | Technical implementation documentation, schema migration instructions, API reference, and test report. |

---

## 3. Database Schema Migration

### File: `backend/migrations/02_appointment_scheduling.sql`

The migration was carefully engineered to be **100% non-destructive**, using `IF NOT EXISTS` guards and `ADD COLUMN IF NOT EXISTS` clauses so existing production data is strictly preserved.

```sql
-- 1. Ensure appointments table exists and add scheduling columns non-destructively
CREATE TABLE IF NOT EXISTS appointments (
    appointment_id BIGSERIAL PRIMARY KEY,
    mother_id BIGINT REFERENCES mothers(mother_id) ON DELETE CASCADE,
    doctor_id VARCHAR(50) REFERENCES doctors(doctor_id) ON DELETE SET NULL,
    hospital_id BIGINT REFERENCES hospitals(hospital_id) ON DELETE SET NULL,
    appointment_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending'
);

-- 2. Add scheduling fields non-destructively
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_time VARCHAR(20) DEFAULT '10:00 AM';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_type VARCHAR(50) DEFAULT 'Routine Checkup';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Status domain constraint check
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_appointments_status'
    ) THEN
        ALTER TABLE appointments ADD CONSTRAINT chk_appointments_status
            CHECK (status IN ('Pending', 'Scheduled', 'Rescheduled', 'Completed', 'Cancelled', 'Rejected'));
    END IF;
END $$;

-- 4. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_mother_id ON appointments(mother_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- 5. Anti-Double-Booking Unique Partial Index
-- Prevents two active appointments for the same doctor on the same date and time slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_doctor_slot
ON appointments(doctor_id, appointment_date, appointment_time)
WHERE status NOT IN ('Cancelled', 'Rejected');
```

### Manual Supabase Deployment Steps
1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to your project -> **SQL Editor**.
3. Open or copy the contents of `backend/migrations/02_appointment_scheduling.sql`.
4. Click **Run** to execute.
5. Verify in **Table Editor** -> `appointments` that columns `appointment_time`, `reason`, `appointment_type`, `notes`, `created_at`, `updated_at` exist and the partial unique index `idx_appointments_doctor_slot` is active.

---

## 4. Backend API Endpoints

All endpoints enforce strict server-side authentication (`authMiddleware`), patient ownership (`req.user.id`), and doctor authorization (`req.user.role === 'doctor'`). Browser-supplied patient IDs, doctor IDs, or statuses are never trusted.

### 4.1 Doctor Directory & Slot Availability
- `GET /api/doctors`
  - **Query Params:** `?specialization=OB/GYN` (optional)
  - **Returns:** Sanitized list of active doctors with hospital name, specialization, experience, and photo.
- `GET /api/doctors/:doctorId/slots?date=YYYY-MM-DD`
  - **Validation:** Rejects past dates (`400 Bad Request`) and invalid date formats.
  - **Returns:** List of configured slots (`09:00 AM` to `04:30 PM`) with `available: true/false` dynamically computed based on existing active bookings (`status NOT IN ('Cancelled', 'Rejected')`).

### 4.2 Patient Appointment Workflow
- `POST /api/appointments`
  - **Auth:** Mother role only (`403 Forbidden` for non-mothers).
  - **Payload:** `{ doctorId, appointmentDate, appointmentTime, appointmentType, reason }`
  - **Validation:** Validates required fields, date must be today or in the future, time slot must match standard slots, reason must be provided.
  - **Anti-Double-Booking Protection:** Checks if doctor already has an active appointment in that slot (`409 Conflict`), and checks if the mother already has an overlapping appointment in that slot (`409 Conflict`).
  - **Initial Status:** Sets `status = 'Pending'`.
- `GET /api/appointments`
  - **Auth:** Mother role only. Returns patient's own appointments enriched with doctor details and hospital information.
- `GET /api/appointments/:id`
  - **Auth:** Enforces ownership (mother can only view their own; assigned doctor can view).
- `PATCH /api/appointments/:id/cancel`
  - **Auth:** Mother can cancel only their own appointment.
  - **Validation:** Cannot cancel an already `Cancelled`, `Rejected`, or `Completed` appointment (`400 Bad Request`). Sets status to `Cancelled`.

### 4.3 Doctor Appointment Workflow
- `GET /api/doctor/appointments`
  - **Auth:** Doctor role only (`403 Forbidden` for patients).
  - **Returns:** All appointment requests assigned to `req.user.id`, joined with patient mother details.
- `PATCH /api/doctor/appointments/:id/confirm`
  - **Auth:** Enforces doctor assignment.
  - **Status Transition:** `Pending` / `Rescheduled` -> `Scheduled`.
- `PATCH /api/doctor/appointments/:id/reject`
  - **Auth:** Enforces doctor assignment.
  - **Payload:** `{ notes }`
  - **Status Transition:** Sets `status = 'Rejected'` and records clinical note/reason.
- `PATCH /api/doctor/appointments/:id/reschedule`
  - **Auth:** Enforces doctor assignment.
  - **Payload:** `{ newDate, newTime, reason }`
  - **Validation:** Verifies new date is in the future and slot is not already booked by another patient (`409 Conflict`).
  - **Status Transition:** Sets new date/time, updates notes, sets `status = 'Rescheduled'`.
- `POST /api/doctor/appointments/follow-up`
  - **Auth:** Doctor role only.
  - **Payload:** `{ motherId, appointmentDate, appointmentTime, appointmentType, reason, notes }`
  - **Validation:** Checks slot availability; creates appointment directly with `status = 'Scheduled'`.

---

## 5. Frontend Features & UX Integration

### 5.1 Patient Appointments Page (`frontend/dashboard.html`)
- **Prominent `+ Book Appointment` Button:** Positioned at the top-right of the Appointments heading with pink gradient accent and hover lift.
- **Responsive Booking Modal (`#bookAppointmentModal`):**
  - **Specialization Filter:** Filters doctors by OB/GYN, High-Risk Pregnancy Specialist, Maternal-Fetal Medicine, and Fetal Radiologist.
  - **Doctor Picker:** Dropdown displaying doctor name, specialization, and hospital.
  - **Appointment Type:** Routine Prenatal Checkup, Ultrasound Scan, High-Risk Consultation, Nutrition & Wellness, Postnatal Review.
  - **Interactive Time Slot Grid:** On date selection, dynamically queries `/api/doctors/:id/slots?date=...` and renders clickable time slot pills. Occupied slots are greyed out and unclickable.
  - **Clinical Reason:** Required textarea for visit symptoms or notes.
- **Upcoming Appointments Card:** Displays active bookings with doctor name, hospital, formatted date, time pill, and colored status tag (`Pending`, `Scheduled`, `Rescheduled`).
- **View Details & Cancellation Actions:**
  - "View Details" opens a modal with full consultation info and clinical notes.
  - "Cancel Booking" cancels the visit subject to the booking policy and triggers instant UI refresh.
- **Feedback Alerts:** In-modal validation alerts and floating toast notifications.

### 5.2 Doctor Dashboard (`frontend/doctor-dashboard.html`)
- **Sidebar Integration:** Added "Appointments" nav item with calendar icon and counter badge.
- **Appointments Panel (`#appointmentsPanel`):**
  - **Live Stat Cards:** Counts for `Pending Action`, `Confirmed / Scheduled`, `Rescheduled`, and `Total Appointments`.
  - **Filter Tabs:** Filter by `All Appointments`, `Pending Requests`, `Scheduled`, `Rescheduled`, and `Completed / Declined`.
  - **Appointment Cards:** Rich cards displaying patient name, ID, type, slot pill, reason, and notes.
- **Doctor Actions:**
  - **Accept Request:** Confirms pending requests to `Scheduled` status.
  - **Reschedule Modal:** Proposes a new date and checks slot availability; transitions status to `Rescheduled`.
  - **Reject / Cancel:** Prompts for clinical explanation and updates status to `Rejected`.
  - **Follow-up Modal:** Direct booking tool from appointment card or patient overview modal to schedule follow-up visits (`Scheduled` status).
- **Security Check:** Verifies server-side authorization (`/api/auth/me`); redirects unauthorized users or patients to `login.html`.

---

## 6. Automated Integration Test Suite

All 45 automated integration tests passed with zero failures (`npm test`).

```text
> maternix-backend@1.0.0 test
> node test/suite.js

============================================================
           MATERNIX INTEGRATION TEST SUITE
============================================================

  [PASS] 1. Static asset frontend/index.html is accessible
  [PASS] 2. Static asset frontend/login.html is accessible
  [PASS] 3. Static asset frontend/dashboard.html is accessible
  [PASS] 4. Static asset frontend/doctor-dashboard.html is accessible
  [PASS] 5. GET /api/health returns HTTP 200 OK
  [PASS] 6. Anonymous request to protected mother dashboard is rejected (401)
  [PASS] 7. Anonymous request to protected doctor patients is rejected (401)
  [PASS] 8. Doctor role rejected from accessing mother dashboard (403)
  [PASS] 9. Mother role rejected from accessing doctor patients (403)
  [PASS] 10. Login with invalid credentials returns 401
  [PASS] 11. Mother login succeeds and returns valid JWT token
  [PASS] 12. Doctor login succeeds and returns valid JWT token
  [PASS] 13. Registration fails when required fields are missing
  [PASS] 14. Registration fails with duplicate email address
  [PASS] 15. New mother registration succeeds and sets auth cookie
  [PASS] 16. Anonymous access to chatbot returns 401 Unauthorized
  [PASS] 17. Mother role can chat with assistant successfully
  [PASS] 18. Emergency SOS endpoint rejects missing emergency contact data
  [PASS] 19. Emergency SOS triggers successfully with valid payload
  [PASS] 20. Mother cannot access another mother's dashboard (Ownership check)
  [PASS] 21. Authorized mother can retrieve her own dashboard data
  [PASS] 22. Authorized mother can update questionnaire for her own account
  [PASS] 23. GET /api/auth/me returns authenticated user identity
  [PASS] 24. POST /api/auth/logout clears session successfully
  [PASS] 25. GET /api/doctors returns sanitized doctor directory
  [PASS] 26. GET /api/doctors filters by specialization correctly
  [PASS] 27. Slot check rejects past dates with 400 Bad Request
  [PASS] 28. Slot check returns available time slots for future date
  [PASS] 29. Unauthenticated POST /api/appointments returns 401
  [PASS] 30. Doctor role cannot book via patient endpoint (403 Forbidden)
  [PASS] 31. POST /api/appointments rejects invalid/missing input fields (400)
  [PASS] 32. Patient can submit appointment booking request (status: Pending)
  [PASS] 33. Double-booking prevention: Doctor conflict rejected with 409 Conflict
  [PASS] 34. Double-booking prevention: Patient conflict rejected with 409 Conflict
  [PASS] 35. Patient retrieves appointments list with enriched doctor & hospital info
  [PASS] 36. Single appointment endpoint enforces patient ownership (403 for other patients)
  [PASS] 37. Patient can cancel own pending/scheduled appointment (status: Cancelled)
  [PASS] 38. Booking policy rejects cancelling an already cancelled appointment (400 Bad Request)
  [PASS] 39. GET /api/doctor/appointments rejects anon (401) and patients (403)
  [PASS] 40. Doctor retrieves assigned appointments roster with patient details
  [PASS] 41. Doctor can confirm appointment request (status: Scheduled)
  [PASS] 42. Doctor can reschedule appointment to new date and time slot (status: Rescheduled)
  [PASS] 43. Reschedule rejects already occupied time slot with 409 Conflict
  [PASS] 44. Doctor can reject appointment with reason recorded
  [PASS] 45. Doctor can schedule follow-up appointment (status: Scheduled)

------------------------------------------------------------
TOTAL TESTS: 45 | PASSED: 45 | FAILED: 0
------------------------------------------------------------
```

---

## 7. Timezone Safety & Booking Policy
- **Timezone Drift Protection:** All dates are handled consistently in local format (`YYYY-MM-DD`). Date parsing utilizes direct ISO string chunking (`dateStr.split('T')[0].split('-')`) to eliminate day shifting across UTC and local timezones (IST).
- **Booking Policy:**
  - Patients can only book slots for the current date or future dates.
  - Active appointments in `Pending`, `Scheduled`, or `Rescheduled` status block overlapping slots.
  - Once cancelled or rejected, slots are immediately freed for other bookings.
  - Cancellations on already `Cancelled` or `Rejected` visits are rejected with `400 Bad Request`.

---

## 8. Remaining Work & Future Enhancements
1. **SMS / Email Notifications:** Wire Amazon SNS or Twilio to send automated SMS reminders 24 hours prior to scheduled appointment slots.
2. **Calendar Export:** Add `.ics` / Google Calendar sync link to the "Appointment Confirmed" modal.
3. **Teleconsultation Video Link:** Integrate WebRTC or Zoom room URL generation when appointment type is marked as "Virtual Consultation".
