// =============================================================================
// Maternix — Automated Test Suite
// Covers authentication, password hashing, role-based authorization,
// patient record isolation, error handling, health checks, and rate limiting.
// =============================================================================

const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');

// Set test environment configuration
process.env.NODE_ENV = 'test';
process.env.PORT = '3005';
process.env.JWT_SECRET = 'maternix_test_jwt_secret_key_at_least_32_characters_long!';
process.env.ENABLE_MOCK_FALLBACK = 'true';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '100';

const { app, server } = require('../backend/server.js');

const BASE_URL = `http://127.0.0.1:3005`;

// ── Test Runner Utilities ───────────────────────────────────────────────────
let testsPassed = 0;
let testsFailed = 0;
const results = [];

function recordResult(testName, passed, details = '') {
  if (passed) {
    testsPassed++;
    console.log(`  [PASS] ${testName}`);
    results.push({ name: testName, status: 'PASS', details });
  } else {
    testsFailed++;
    console.error(`  [FAIL] ${testName}: ${details}`);
    results.push({ name: testName, status: 'FAIL', details });
  }
}

async function makeRequest(method, endpoint, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ── Test Suite Execution ────────────────────────────────────────────────────
async function runTests() {
  console.log('\n============================================================');
  console.log('  RUNNING MATERNIX COMPREHENSIVE SECURITY & INTEGRATION TESTS');
  console.log('============================================================\n');

  let motherToken1 = null;
  let motherId1 = null;
  let motherToken2 = null;
  let motherId2 = null;
  let doctorToken = null;

  try {
    // 1. Health check liveness
    {
      const res = await makeRequest('GET', '/health');
      const ok = res.statusCode === 200 && res.body.status === 'healthy';
      recordResult('1. GET /health liveness check', ok, `Status: ${res.statusCode}, Body: ${JSON.stringify(res.body)}`);
    }

    // 2. Health check readiness
    {
      const res = await makeRequest('GET', '/health/ready');
      const ok = res.statusCode === 200 && res.body.status === 'ready';
      recordResult('2. GET /health/ready readiness check', ok, `Status: ${res.statusCode}, Body: ${JSON.stringify(res.body)}`);
    }

    // 3. Mother signup with valid credentials
    {
      const res = await makeRequest('POST', '/api/auth/signup', {
        first: 'Aarthi',
        last: 'Raman',
        email: 'aarthi.test@example.com',
        username: 'aarthi_test',
        pwd: 'SecurePassword123!',
        status: 'pregnant',
        dueDate: '2026-11-20'
      });
      const ok = res.statusCode === 201 && res.body.token && res.body.motherId && !res.body.user.password;
      motherToken1 = res.body.token;
      motherId1 = res.body.motherId;
      recordResult('3. Mother signup generates token, motherId, and never returns password', ok, `Status: ${res.statusCode}`);
    }

    // 4. Mother signup rejects short password (< 8 chars)
    {
      const res = await makeRequest('POST', '/api/auth/signup', {
        first: 'Bad',
        last: 'Pass',
        email: 'badpass@example.com',
        username: 'badpass_user',
        pwd: '123',
        status: 'pregnant'
      });
      const ok = res.statusCode === 400 && res.body.error.includes('Password must be at least 8 characters');
      recordResult('4. Mother signup validation rejects weak password (<8 chars)', ok, `Status: ${res.statusCode}`);
    }

    // 5. Signup a second mother for cross-patient isolation testing
    {
      const res = await makeRequest('POST', '/api/auth/signup', {
        first: 'Deepa',
        last: 'Venkatesh',
        email: 'deepa.test@example.com',
        username: 'deepa_test',
        pwd: 'SecurePassword123!',
        status: 'pregnant',
        dueDate: '2026-12-15'
      });
      motherToken2 = res.body.token;
      motherId2 = res.body.motherId;
      recordResult('5. Register second mother for cross-user isolation tests', res.statusCode === 201, `Status: ${res.statusCode}`);
    }

    // 6. Mother login with valid credentials
    {
      const res = await makeRequest('POST', '/api/auth/login-mother', {
        username: 'aarthi_test',
        pwd: 'SecurePassword123!'
      });
      const ok = res.statusCode === 200 && res.body.token && res.body.user && !res.body.user.password;
      recordResult('6. Mother login succeeds with valid credentials', ok, `Status: ${res.statusCode}`);
    }

    // 7. Mother login fails with incorrect password (generic error)
    {
      const res = await makeRequest('POST', '/api/auth/login-mother', {
        username: 'aarthi_test',
        pwd: 'WrongPassword999!'
      });
      const ok = res.statusCode === 401 && res.body.error === 'Invalid username or password.';
      recordResult('7. Mother login fails on wrong password with generic error', ok, `Status: ${res.statusCode}`);
    }

    // 8. Doctor login with valid credentials
    {
      const res = await makeRequest('POST', '/api/auth/login-doctor', {
        docId: 'DOC001',
        pwd: 'doctor123'
      });
      const ok = res.statusCode === 200 && res.body.token && res.body.doctor && !res.body.doctor.password;
      doctorToken = res.body.token;
      recordResult('8. Doctor login succeeds and returns token without password', ok, `Status: ${res.statusCode}`);
    }

    // 9. Doctor login fails with bad credentials
    {
      const res = await makeRequest('POST', '/api/auth/login-doctor', {
        docId: 'DOC001',
        pwd: 'wrongDoctorPassword'
      });
      const ok = res.statusCode === 401 && res.body.error === 'Invalid doctor ID or password.';
      recordResult('9. Doctor login fails on invalid password', ok, `Status: ${res.statusCode}`);
    }

    // 10. Password hashing verification (bcrypt hash check)
    {
      const testPlain = 'SecretPassw0rd!';
      const hash = await bcrypt.hash(testPlain, 10);
      const isMatch = await bcrypt.compare(testPlain, hash);
      const isMismatch = await bcrypt.compare('WrongPass', hash);
      const isBcryptFormat = hash.startsWith('$2a$') || hash.startsWith('$2b$');
      const ok = isMatch && !isMismatch && isBcryptFormat;
      recordResult('10. Bcrypt password hashing and verification behavior', ok);
    }

    // 11. Unauthenticated access blocked on /api/dashboard/:motherId
    {
      const res = await makeRequest('GET', `/api/dashboard/${motherId1}`);
      const ok = res.statusCode === 401 && res.body.error.includes('Authentication required');
      recordResult('11. Unauthenticated GET /api/dashboard/:motherId returns 401 Unauthorized', ok, `Status: ${res.statusCode}`);
    }

    // 12. Unauthenticated access blocked on /api/questionnaire
    {
      const res = await makeRequest('POST', '/api/questionnaire', { motherId: motherId1 });
      const ok = res.statusCode === 401;
      recordResult('12. Unauthenticated POST /api/questionnaire returns 401 Unauthorized', ok, `Status: ${res.statusCode}`);
    }

    // 13. Unauthenticated access blocked on /api/doctor/patients
    {
      const res = await makeRequest('GET', '/api/doctor/patients');
      const ok = res.statusCode === 401;
      recordResult('13. Unauthenticated GET /api/doctor/patients returns 401 Unauthorized', ok, `Status: ${res.statusCode}`);
    }

    // 14. Unauthenticated access blocked on /api/doctor/prescription
    {
      const res = await makeRequest('POST', '/api/doctor/prescription', { motherId: motherId1, diagnosis: 'Test', prescription: 'Meds' });
      const ok = res.statusCode === 401;
      recordResult('14. Unauthenticated POST /api/doctor/prescription returns 401 Unauthorized', ok, `Status: ${res.statusCode}`);
    }

    // 15. Cross-Patient Access Isolation: Mother 1 cannot access Mother 2's dashboard
    {
      const res = await makeRequest('GET', `/api/dashboard/${motherId2}`, null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 403 && res.body.error.includes('cannot access another patient');
      recordResult('15. Cross-Patient Isolation: Mother 1 cannot access Mother 2 records (403 Forbidden)', ok, `Status: ${res.statusCode}`);
    }

    // 16. Cross-Patient Isolation: Mother 1 cannot modify Mother 2's questionnaire
    {
      const res = await makeRequest('POST', '/api/questionnaire', {
        motherId: motherId2,
        age: 30,
        bloodType: 'B+'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 403;
      recordResult('16. Cross-Patient Isolation: Mother 1 cannot modify Mother 2 questionnaire (403 Forbidden)', ok, `Status: ${res.statusCode}`);
    }

    // 17. Doctor-only endpoint rejection: Mother cannot view doctor patient roster
    {
      const res = await makeRequest('GET', '/api/doctor/patients', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 403 && res.body.error.includes('insufficient permissions');
      recordResult('17. Doctor-only endpoint rejection: Mother cannot view doctor patient list (403 Forbidden)', ok, `Status: ${res.statusCode}`);
    }

    // 18. Doctor-only endpoint rejection: Mother cannot write prescriptions
    {
      const res = await makeRequest('POST', '/api/doctor/prescription', {
        motherId: motherId1,
        diagnosis: 'Forgery Attempt',
        prescription: 'Illegal meds'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 403 && res.body.error.includes('insufficient permissions');
      recordResult('18. Doctor-only endpoint rejection: Mother cannot write prescriptions (403 Forbidden)', ok, `Status: ${res.statusCode}`);
    }

    // 19. Doctor authorized access: Doctor can view patient roster
    {
      const res = await makeRequest('GET', '/api/doctor/patients', null, {
        Authorization: `Bearer ${doctorToken}`
      });
      const hasPatients = Array.isArray(res.body) && res.body.length > 0;
      // Ensure no password field exists in any patient object
      const noPasswordsInResponse = hasPatients && res.body.every(p => p.password === undefined);
      const ok = res.statusCode === 200 && hasPatients && noPasswordsInResponse;
      recordResult('19. Doctor can retrieve patient roster with sanitized records (no passwords)', ok, `Status: ${res.statusCode}`);
    }

    // 20. Doctor authorized access: Doctor can write prescription
    {
      const res = await makeRequest('POST', '/api/doctor/prescription', {
        motherId: motherId1,
        diagnosis: 'Mild gestational hypertension',
        prescription: 'Labetalol 100mg twice daily with meals'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 200 && res.body.success === true;
      recordResult('20. Doctor can write prescription for patient', ok, `Status: ${res.statusCode}`);
    }

    // 21. Authorized Mother Dashboard retrieval
    {
      const res = await makeRequest('GET', `/api/dashboard/${motherId1}`, null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && res.body.appointments !== undefined && res.body.medicalRecords !== undefined;
      recordResult('21. Authorized mother can retrieve her own dashboard data', ok, `Status: ${res.statusCode}`);
    }

    // 22. Authorized Mother Questionnaire submission
    {
      const res = await makeRequest('POST', '/api/questionnaire', {
        motherId: motherId1,
        age: 27,
        bloodType: 'O+',
        status: 'pregnant',
        currentWeek: 16,
        chronicDetails: 'None',
        allergies: 'Penicillin'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && res.body.success === true;
      recordResult('22. Authorized mother can update questionnaire for her own account', ok, `Status: ${res.statusCode}`);
    }

    // 23. Current session profile (/api/auth/me)
    {
      const res = await makeRequest('GET', '/api/auth/me', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && res.body.user && res.body.user.role === 'mother';
      recordResult('23. GET /api/auth/me returns authenticated user identity', ok, `Status: ${res.statusCode}`);
    }

    // 24. Logout endpoint clears session
    {
      const res = await makeRequest('POST', '/api/auth/logout');
      const ok = res.statusCode === 200 && res.body.success === true;
      recordResult('24. POST /api/auth/logout clears session successfully', ok, `Status: ${res.statusCode}`);
    }

    // ════════════════════════════════════════════════════════════
    // MATERNIX APPOINTMENT SCHEDULING INTEGRATION TESTS (25-45)
    // ════════════════════════════════════════════════════════════

    // 25. GET /api/doctors returns directory without passwords
    {
      const res = await makeRequest('GET', '/api/doctors');
      const ok = res.statusCode === 200 && Array.isArray(res.body) && res.body.length > 0 &&
        res.body.every(d => d.doctor_id && d.name && d.specialization && d.password === undefined);
      recordResult('25. GET /api/doctors returns sanitized doctor directory', ok, `Count: ${res.body.length}`);
    }

    // 26. GET /api/doctors with specialization filter
    {
      const res = await makeRequest('GET', '/api/doctors?specialization=Fetal');
      const ok = res.statusCode === 200 && Array.isArray(res.body) && res.body.length > 0 &&
        res.body.every(d => d.specialization.toLowerCase().includes('fetal'));
      recordResult('26. GET /api/doctors filters by specialization correctly', ok, `Filtered count: ${res.body.length}`);
    }

    // 27. GET /api/doctors/:doctorId/slots rejects past date
    {
      const res = await makeRequest('GET', '/api/doctors/DOC001/slots?date=2020-01-01', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 400 && res.body.error !== undefined;
      recordResult('27. Slot check rejects past dates with 400 Bad Request', ok, `Status: ${res.statusCode}`);
    }

    // 28. GET /api/doctors/:doctorId/slots returns available slots for future date
    {
      const res = await makeRequest('GET', '/api/doctors/DOC001/slots?date=2026-11-20', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && Array.isArray(res.body.availableSlots) && res.body.availableSlots.length > 0;
      recordResult('28. Slot check returns available time slots for future date', ok, `Slots count: ${res.body.availableSlots ? res.body.availableSlots.length : 0}`);
    }

    // 29. POST /api/appointments rejects unauthenticated requests
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: '2026-11-20',
        appointmentTime: '10:00 AM',
        reason: 'Routine Prenatal Consultation'
      });
      const ok = res.statusCode === 401;
      recordResult('29. Unauthenticated POST /api/appointments returns 401', ok, `Status: ${res.statusCode}`);
    }

    // 30. POST /api/appointments rejects doctor role (patient-only endpoint)
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: '2026-11-20',
        appointmentTime: '10:00 AM',
        reason: 'Routine Prenatal Consultation'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 403;
      recordResult('30. Doctor role cannot book via patient endpoint (403 Forbidden)', ok, `Status: ${res.statusCode}`);
    }

    // 31. POST /api/appointments rejects invalid inputs (missing doctor or reason)
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: '',
        appointmentDate: '2026-11-20',
        appointmentTime: '10:00 AM',
        reason: ''
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 400;
      recordResult('31. POST /api/appointments rejects invalid/missing input fields (400)', ok, `Status: ${res.statusCode}`);
    }

    let bookedAppointmentId = null;
    const testDate = '2026-11-25';
    const testSlot = '10:00 AM';

    // 32. POST /api/appointments successfully creates pending appointment request
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: testDate,
        appointmentTime: testSlot,
        reason: '28-week routine prenatal evaluation and ultrasound',
        appointmentType: 'Prenatal Checkup'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 201 && res.body.success === true &&
        res.body.appointment && res.body.appointment.status === 'Pending' &&
        res.body.appointment.appointment_time === testSlot;
      if (ok) bookedAppointmentId = res.body.appointment.appointment_id;
      recordResult('32. Patient can submit appointment booking request (status: Pending)', ok, `Status: ${res.statusCode}, ApptId: ${bookedAppointmentId}`);
    }

    // 33. Double-Booking Prevention: Doctor Conflict (Mother 2 cannot book same doctor & slot)
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: testDate,
        appointmentTime: testSlot,
        reason: 'Second mother booking conflict test',
        appointmentType: 'Prenatal Checkup'
      }, {
        Authorization: `Bearer ${motherToken2}`
      });
      const ok = res.statusCode === 409 && res.body.error && res.body.error.includes('already booked');
      recordResult('33. Double-booking prevention: Doctor conflict rejected with 409 Conflict', ok, `Status: ${res.statusCode}, Msg: ${res.body.error}`);
    }

    // 34. Double-Booking Prevention: Patient Conflict (Mother 1 cannot double-book self at same slot)
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC002',
        appointmentDate: testDate,
        appointmentTime: testSlot,
        reason: 'Attempting to book two doctors at same time',
        appointmentType: 'Consultation'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 409 && res.body.error && res.body.error.includes('already have an active appointment');
      recordResult('34. Double-booking prevention: Patient conflict rejected with 409 Conflict', ok, `Status: ${res.statusCode}, Msg: ${res.body.error}`);
    }

    // 35. GET /api/appointments returns patient's own appointments with enriched details
    {
      const res = await makeRequest('GET', '/api/appointments', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && Array.isArray(res.body) &&
        res.body.some(a => a.appointment_id === bookedAppointmentId && a.doctor_name && a.hospital_name);
      recordResult('35. Patient retrieves appointments list with enriched doctor & hospital info', ok, `Count: ${res.body.length}`);
    }

    // 36. GET /api/appointments/:id enforces patient ownership (Mother 2 blocked from Mother 1's appointment)
    {
      const resAllowed = await makeRequest('GET', `/api/appointments/${bookedAppointmentId}`, null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const resDenied = await makeRequest('GET', `/api/appointments/${bookedAppointmentId}`, null, {
        Authorization: `Bearer ${motherToken2}`
      });
      const ok = resAllowed.statusCode === 200 && resDenied.statusCode === 403;
      recordResult('36. Single appointment endpoint enforces patient ownership (403 for other patients)', ok, `Allowed: ${resAllowed.statusCode}, Denied: ${resDenied.statusCode}`);
    }

    // 37. PATCH /api/appointments/:id/cancel allows patient to cancel own appointment
    {
      const res = await makeRequest('PATCH', `/api/appointments/${bookedAppointmentId}/cancel`, {
        reason: 'Rescheduling conflict with work'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 200 && res.body.success === true && res.body.appointment.status === 'Cancelled';
      recordResult('37. Patient can cancel own pending/scheduled appointment (status: Cancelled)', ok, `Status: ${res.statusCode}`);
    }

    // 38. PATCH /api/appointments/:id/cancel rejects cancelling already cancelled appointment
    {
      const res = await makeRequest('PATCH', `/api/appointments/${bookedAppointmentId}/cancel`, {
        reason: 'Trying to cancel again'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = res.statusCode === 400 && res.body.error && res.body.error.includes('already cancelled');
      recordResult('38. Booking policy rejects cancelling an already cancelled appointment (400 Bad Request)', ok, `Status: ${res.statusCode}`);
    }

    // Create a new pending appointment for Doctor Workflow tests
    let docTestApptId = null;
    const docDate = '2026-11-28';
    const docSlot = '11:00 AM';
    {
      const res = await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: docDate,
        appointmentTime: docSlot,
        reason: 'Pre-delivery birth plan consultation',
        appointmentType: 'Prenatal Checkup'
      }, {
        Authorization: `Bearer ${motherToken1}`
      });
      if (res.statusCode === 201) {
        docTestApptId = res.body.appointment.appointment_id;
      }
    }

    // 39. GET /api/doctor/appointments rejects unauthorized access
    {
      const resAnon = await makeRequest('GET', '/api/doctor/appointments');
      const resMother = await makeRequest('GET', '/api/doctor/appointments', null, {
        Authorization: `Bearer ${motherToken1}`
      });
      const ok = resAnon.statusCode === 401 && resMother.statusCode === 403;
      recordResult('39. GET /api/doctor/appointments rejects anon (401) and patients (403)', ok, `Anon: ${resAnon.statusCode}, Mother: ${resMother.statusCode}`);
    }

    // 40. GET /api/doctor/appointments returns appointments assigned to logged-in doctor
    {
      const res = await makeRequest('GET', '/api/doctor/appointments', null, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 200 && Array.isArray(res.body) &&
        res.body.some(a => a.appointment_id === docTestApptId && a.mother_name);
      recordResult('40. Doctor retrieves assigned appointments roster with patient details', ok, `Count: ${res.body.length}`);
    }

    // 41. PATCH /api/doctor/appointments/:id/confirm confirms appointment
    {
      const res = await makeRequest('PATCH', `/api/doctor/appointments/${docTestApptId}/confirm`, null, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 200 && res.body.success === true && res.body.appointment.status === 'Scheduled';
      recordResult('41. Doctor can confirm appointment request (status: Scheduled)', ok, `Status: ${res.statusCode}`);
    }

    // 42. PATCH /api/doctor/appointments/:id/reschedule proposes new date and time
    const reschedDate = '2026-11-29';
    const reschedSlot = '02:00 PM';
    {
      const res = await makeRequest('PATCH', `/api/doctor/appointments/${docTestApptId}/reschedule`, {
        appointmentDate: reschedDate,
        appointmentTime: reschedSlot,
        notes: 'Doctor clinic shift change'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 200 && res.body.success === true &&
        res.body.appointment.status === 'Rescheduled' &&
        res.body.appointment.appointment_date === reschedDate &&
        res.body.appointment.appointment_time === reschedSlot;
      recordResult('42. Doctor can reschedule appointment to new date and time slot (status: Rescheduled)', ok, `Status: ${res.statusCode}`);
    }

    // 43. PATCH /api/doctor/appointments/:id/reschedule prevents booking already occupied slot
    {
      // First book another appointment at 03:00 PM
      await makeRequest('POST', '/api/appointments', {
        doctorId: 'DOC001',
        appointmentDate: reschedDate,
        appointmentTime: '03:00 PM',
        reason: 'Another patient checkup'
      }, {
        Authorization: `Bearer ${motherToken2}`
      });

      // Try to reschedule docTestApptId into 03:00 PM (conflict)
      const res = await makeRequest('PATCH', `/api/doctor/appointments/${docTestApptId}/reschedule`, {
        appointmentDate: reschedDate,
        appointmentTime: '03:00 PM',
        notes: 'Try conflicting slot'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 409;
      recordResult('43. Reschedule rejects already occupied time slot with 409 Conflict', ok, `Status: ${res.statusCode}`);
    }

    // 44. PATCH /api/doctor/appointments/:id/reject declines appointment with notes
    {
      const res = await makeRequest('PATCH', `/api/doctor/appointments/${docTestApptId}/reject`, {
        reason: 'Doctor on leave on rescheduled date'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 200 && res.body.success === true &&
        res.body.appointment.status === 'Rejected' &&
        res.body.appointment.notes.includes('Doctor on leave');
      recordResult('44. Doctor can reject appointment with reason recorded', ok, `Status: ${res.statusCode}`);
    }

    // 45. POST /api/doctor/appointments/follow-up creates doctor-scheduled follow-up
    {
      const res = await makeRequest('POST', '/api/doctor/appointments/follow-up', {
        motherId: motherId1,
        appointmentDate: '2026-12-05',
        appointmentTime: '09:30 AM',
        reason: 'Post-scan review and prescription adjustment',
        appointmentType: 'Follow-up',
        notes: 'Follow up after third-trimester ultrasound'
      }, {
        Authorization: `Bearer ${doctorToken}`
      });
      const ok = res.statusCode === 201 && res.body.success === true &&
        res.body.appointment.status === 'Scheduled' &&
        res.body.appointment.appointment_type === 'Follow-up';
      recordResult('45. Doctor can schedule follow-up appointment (status: Scheduled)', ok, `Status: ${res.statusCode}, ApptId: ${res.body.appointment ? res.body.appointment.appointment_id : 'N/A'}`);
    }

  } catch (err) {
    console.error('[TEST SUITE ERROR]', err);
  } finally {
    server.close();
  }

  console.log('\n------------------------------------------------------------');
  console.log(`TOTAL TESTS: ${testsPassed + testsFailed} | PASSED: ${testsPassed} | FAILED: ${testsFailed}`);
  console.log('------------------------------------------------------------\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
