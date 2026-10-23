// =============================================================================
// Maternix — Backend REST API Server
// Production-ready, secure Express server with JWT authentication,
// bcrypt password hashing, role-based authorization, rate limiting,
// and PostgreSQL connection pooling for Amazon RDS.
// =============================================================================

const path = require('path');
const crypto = require('crypto');

// Load environment variables (.env in workspace root or backend/)
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// PostgreSQL Database Client Module
const db = require('./db');

// ── Startup Environment Validation ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// JWT Secret validation: Enforce strong secret in production
const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? null : 'maternix_dev_insecure_secret_min_32_chars!');
if (!JWT_SECRET || (IS_PROD && JWT_SECRET.includes('replace_with_a_secure'))) {
  console.error('[FATAL] Valid JWT_SECRET is required. Cannot start in production without a secure secret.');
  process.exit(1);
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const ENABLE_MOCK_FALLBACK = process.env.ENABLE_MOCK_FALLBACK === 'true' && !IS_PROD;

// Validate PostgreSQL credentials in production
if (IS_PROD && !db.isDbConfigured()) {
  console.error('[FATAL] PostgreSQL configuration (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD or DATABASE_URL) is required in production.');
  process.exit(1);
} else if (!db.isDbConfigured()) {
  console.warn('[WARN] Running without PostgreSQL credentials. Mock fallback will be used for local development.');
}

// ── Application Initialization ──────────────────────────────────────────────
const app = express();

// Trust proxy when behind AWS Application Load Balancer
if (IS_PROD) {
  app.set('trust proxy', 1);
}

// ── Structured Logging Helper ───────────────────────────────────────────────
function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  if (IS_PROD) {
    console.log(JSON.stringify(entry));
  } else {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`);
  }
}

// ── Security Headers & Middleware ───────────────────────────────────────────
// Content Security Policy is disabled to permit CDN assets (FontAwesome, Google Fonts, Chart.js)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cookieParser());
app.use(express.json({ limit: '50kb' }));

// Request ID & Correlation Tracking
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Request duration & access logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Avoid logging sensitive endpoints payloads or static assets noise
    if (req.path.startsWith('/api') || req.path === '/health') {
      log('info', 'HTTP Request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start
      });
    }
  });
  next();
});

// CORS Configuration
const allowedOrigins = process.env.FRONTEND_ORIGIN 
  ? process.env.FRONTEND_ORIGIN.split(',').map(s => s.trim()) 
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin, curl, server-to-server or listed origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS request blocked by security policy'));
  },
  credentials: true
}));

// Rate Limiter for Authentication Endpoints
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins default
  max: parseInt(process.env.RATE_LIMIT_MAX || '20', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' }
});

// Static frontend serving
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve login on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// ── In-Memory Development Mock Data (Strictly Local / Testing Only) ─────────
const BCRYPT_SALT_ROUNDS = 10;

const VALID_TIME_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '02:00 PM', '02:30 PM', '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM'
];

function isValidFutureDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  const dateObj = new Date(y, m - 1, d);
  if (isNaN(dateObj.getTime())) return false;
  if (dateObj.getFullYear() !== y || dateObj.getMonth() !== (m - 1) || dateObj.getDate() !== d) {
    return false;
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dateObj >= today;
}

const mockMothers = [
  { mother_id: 1, first_name: 'Priya', last_name: 'Sharma', email: 'priya@example.com', username: 'priya', password: bcrypt.hashSync('password123', BCRYPT_SALT_ROUNDS), status: 'pregnant', current_week: 28, due_date: '2026-08-15', age: 24, blood_group: 'O+', medical_history: 'None' },
  { mother_id: 2, first_name: 'Neha', last_name: 'Gupta', email: 'neha@example.com', username: 'neha', password: bcrypt.hashSync('password123', BCRYPT_SALT_ROUNDS), status: 'pregnant', current_week: 32, due_date: '2026-07-10', age: 29, blood_group: 'A+', medical_history: 'Mild Anemia' },
  { mother_id: 3, first_name: 'Anjali', last_name: 'Singh', email: 'anjali@example.com', username: 'anjali', password: bcrypt.hashSync('password123', BCRYPT_SALT_ROUNDS), status: 'pregnant', current_week: 25, due_date: '2026-09-20', age: 32, blood_group: 'B+', medical_history: 'Gestational diabetes' },
  { mother_id: 4, first_name: 'Divya', last_name: 'Patel', email: 'divya@example.com', username: 'divya', password: bcrypt.hashSync('password123', BCRYPT_SALT_ROUNDS), status: 'postnatal', current_week: 0, due_date: null, age: 27, blood_group: 'AB+', medical_history: 'Hypothyroidism' },
  { mother_id: 5, first_name: 'Meera', last_name: 'Malhotra', email: 'meera@example.com', username: 'meera', password: bcrypt.hashSync('password123', BCRYPT_SALT_ROUNDS), status: 'postnatal', current_week: 0, due_date: null, age: 35, blood_group: 'O-', medical_history: 'Previous C-section' }
];

const mockHospitals = [
  { hospital_id: 1, name: 'City Hospital', location: 'Chennai', contact_no: '+9198000000001' },
  { hospital_id: 2, name: 'Green Care', location: 'Bangalore', contact_no: '+9198000000002' },
  { hospital_id: 3, name: 'MotherCare Clinic', location: 'Vellore', contact_no: '+9198000000003' }
];

const mockDoctors = [
  { doctor_id: 'DOC001', name: 'Dr. Rajesh Kumar', password: bcrypt.hashSync('doctor123', BCRYPT_SALT_ROUNDS), specialization: 'Senior OB-GYN and Maternal-Fetal specialist', experience: 7, contact_no: '+919876543276', hospital_id: 1, hospital_name: 'City Hospital', email: 'doc001@maternix.portal' },
  { doctor_id: 'DOC002', name: 'Dr. Anita Sharma', password: bcrypt.hashSync('doctor123', BCRYPT_SALT_ROUNDS), specialization: 'Anesthesiologist', experience: 6, contact_no: '+919876543895', hospital_id: 1, hospital_name: 'City Hospital', email: 'doc002@maternix.portal' },
  { doctor_id: 'DOC003', name: 'Dr. Vikram Patel', password: bcrypt.hashSync('doctor123', BCRYPT_SALT_ROUNDS), specialization: 'Pediatrician', experience: 5, contact_no: '+919876543093', hospital_id: 2, hospital_name: 'Green Care', email: 'doc003@maternix.portal' },
  { doctor_id: 'DOC004', name: 'Dr. Sonia Mehta', password: bcrypt.hashSync('doctor123', BCRYPT_SALT_ROUNDS), specialization: 'Laparoscopic surgeon', experience: 8, contact_no: '+919876543281', hospital_id: 1, hospital_name: 'City Hospital', email: 'doc004@maternix.portal' },
  { doctor_id: 'DOC005', name: 'Dr. Arjun Nair', password: bcrypt.hashSync('doctor123', BCRYPT_SALT_ROUNDS), specialization: 'Fetal medicine expert', experience: 6, contact_no: '+919876543674', hospital_id: 3, hospital_name: 'MotherCare Clinic', email: 'doc005@maternix.portal' }
];

const mockHealthMonitors = [
  { monitor_id: 1, mother_id: 1, blood_pressure: 120, sugar_level: 90, weight: 60, record_date: '2026-06-01' }
];

let nextAppointmentId = 11;
const mockAppointments = [
  { appointment_id: 1, mother_id: 1, doctor_id: 'DOC001', appointment_date: '2026-06-01', appointment_time: '10:00 AM', status: 'Scheduled', reason: 'Routine Monthly Checkup', appointment_type: 'Prenatal Checkup', notes: null },
  { appointment_id: 2, mother_id: 2, doctor_id: 'DOC002', appointment_date: '2026-06-02', appointment_time: '11:00 AM', status: 'Completed', reason: 'Pain Management Consultation', appointment_type: 'Consultation', notes: 'Checkup completed' },
  { appointment_id: 3, mother_id: 3, doctor_id: 'DOC003', appointment_date: '2026-06-03', appointment_time: '02:00 PM', status: 'Cancelled', reason: 'Pediatric follow-up', appointment_type: 'Follow-up', notes: 'Cancelled by patient' },
  { appointment_id: 4, mother_id: 4, doctor_id: 'DOC004', appointment_date: '2026-06-04', appointment_time: '03:00 PM', status: 'Completed', reason: 'Postnatal Surgical Review', appointment_type: 'Postnatal Review', notes: 'Healing well' },
  { appointment_id: 5, mother_id: 5, doctor_id: 'DOC005', appointment_date: '2026-06-05', appointment_time: '09:30 AM', status: 'Scheduled', reason: 'Fetal Growth Scan', appointment_type: 'Ultrasound Scan', notes: null },
  { appointment_id: 6, mother_id: 1, doctor_id: 'DOC001', appointment_date: '2026-07-01', appointment_time: '10:30 AM', status: 'Pending', reason: 'Ultrasound scan and BP review', appointment_type: 'Ultrasound Scan', notes: null }
];

function enrichAppointmentRecord(appt) {
  const doctor = mockDoctors.find(d => d.doctor_id === appt.doctor_id);
  const mother = mockMothers.find(m => m.mother_id === appt.mother_id);
  const hospital = doctor ? (mockHospitals.find(h => h.hospital_id === doctor.hospital_id) || { name: doctor.hospital_name || 'City Hospital', location: 'Chennai', contact_no: '+9198000000001' }) : null;
  return {
    ...appt,
    doctor_name: doctor ? doctor.name : appt.doctor_id,
    doctor_specialization: doctor ? doctor.specialization : 'Obstetrician',
    doctor_contact: doctor ? doctor.contact_no : '',
    hospital_name: hospital ? hospital.name : 'City Hospital',
    hospital_location: hospital ? hospital.location : 'Chennai',
    mother_name: mother ? `${mother.first_name} ${mother.last_name}` : `Patient #${appt.mother_id}`,
    mother_email: mother ? mother.email : '',
    mother_status: mother ? mother.status : '',
    mother_week: mother ? mother.current_week : 0
  };
}

const mockMedicalRecords = [];

// ── Authentication & Token Helpers ──────────────────────────────────────────
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD, // Transmit only over HTTPS in production
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Password verification with backward-compatible legacy plaintext upgrade
async function verifyAndUpgradePassword(plainPassword, storedHashOrPlain, onUpgrade) {
  if (!storedHashOrPlain || !plainPassword) return false;

  const isBcrypt = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(storedHashOrPlain);
  if (isBcrypt) {
    return await bcrypt.compare(plainPassword, storedHashOrPlain);
  }

  // Legacy plaintext match
  if (plainPassword === storedHashOrPlain) {
    try {
      const newHash = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
      if (typeof onUpgrade === 'function') {
        await onUpgrade(newHash);
      }
    } catch (err) {
      log('warn', 'Failed to auto-upgrade legacy plaintext password', { error: err.message });
    }
    return true;
  }

  return false;
}

// ── Authentication & Authorization Middleware ───────────────────────────────
function authenticate(req, res, next) {
  let token = null;

  // 1. Check HttpOnly cookie
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  // 2. Check Authorization header
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role, username, name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions.' });
    }
    next();
  };
}

// Sanitize user object to never leak passwords or sensitive internal hashes
function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

// ── Health Check Endpoints (ALB & Auto Scaling Ready) ───────────────────────
// Liveness Check: Rapid probe for ALB Target Group
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Readiness Check: Verifies database connectivity
app.get('/health/ready', async (req, res) => {
  if (db.isDbConfigured()) {
    try {
      const isConnected = await db.healthCheck();
      if (isConnected) {
        return res.status(200).json({ status: 'ready', database: 'connected' });
      }
      throw new Error('Database health check query returned no rows');
    } catch (err) {
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ status: 'not_ready', database: 'disconnected', error: 'Database health check failed' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    return res.status(200).json({ status: 'ready', database: 'mock_fallback' });
  }

  return res.status(503).json({ status: 'not_ready', database: 'unconfigured' });
});

// ── API: Sign Up Mother ─────────────────────────────────────────────────────
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  const { first, last, email, username, pwd, status, dueDate } = req.body;

  // Validation
  if (!first || !last || !email || !username || !pwd || !status) {
    return res.status(400).json({ error: 'All registration fields are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }
  if (username.length < 4) {
    return res.status(400).json({ error: 'Username must be at least 4 characters.' });
  }
  if (pwd.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const hashedPassword = await bcrypt.hash(pwd, BCRYPT_SALT_ROUNDS);

  if (db.isDbConfigured()) {
    try {
      const insertSql = `
        INSERT INTO mothers (
          first_name, last_name, email, username, password,
          status, pregnancy_stage, current_week, due_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING mother_id, first_name, last_name, email, username, status, current_week, due_date;
      `;
      const params = [
        first,
        last,
        email.toLowerCase(),
        username.toLowerCase(),
        hashedPassword,
        status,
        status === 'pregnant' ? 1 : 0,
        status === 'pregnant' ? 1 : 0,
        dueDate || null
      ];

      const { rows } = await db.query(insertSql, params);
      const motherRow = rows[0];

      if (motherRow) {
        const token = generateToken({
          id: motherRow.mother_id,
          role: 'mother',
          username: motherRow.username
        });
        res.cookie('token', token, COOKIE_OPTIONS);
        return res.status(201).json({
          motherId: motherRow.mother_id,
          token,
          user: sanitizeUser(motherRow)
        });
      }
    } catch (err) {
      if (err.code === '23505') { // Postgres Unique constraint violation
        return res.status(409).json({ error: 'Username or email is already registered.' });
      }
      log('error', 'PostgreSQL signup exception', { error: err.message, code: err.code });
    }
  }

  // Safe fallback handling: ONLY if explicitly allowed in non-production
  if (!ENABLE_MOCK_FALLBACK) {
    return res.status(503).json({ error: 'Registration service temporarily unavailable. Please try again later.' });
  }

  log('warn', 'Signup using local mock storage fallback (DEV ONLY)');
  if (mockMothers.some(m => m.username === username.toLowerCase() || m.email === email.toLowerCase())) {
    return res.status(409).json({ error: 'Username or email already exists in mock data.' });
  }

  const newId = mockMothers.length + 1;
  const newMother = {
    mother_id: newId,
    first_name: first,
    last_name: last,
    email: email.toLowerCase(),
    username: username.toLowerCase(),
    password: hashedPassword,
    status,
    current_week: status === 'pregnant' ? 1 : 0,
    due_date: dueDate || null
  };
  mockMothers.push(newMother);

  const token = generateToken({ id: newId, role: 'mother', username: newMother.username });
  res.cookie('token', token, COOKIE_OPTIONS);
  return res.status(201).json({
    motherId: newId,
    token,
    user: sanitizeUser(newMother)
  });
});

// ── API: Mother Login ───────────────────────────────────────────────────────
app.post('/api/auth/login-mother', authLimiter, async (req, res) => {
  const { username, pwd } = req.body;

  if (!username || !pwd) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const cleanUser = username.trim().toLowerCase();

  if (db.isDbConfigured()) {
    try {
      const selectSql = `
        SELECT * FROM mothers
        WHERE LOWER(username) = $1 OR LOWER(email) = $1
        LIMIT 1;
      `;
      const { rows } = await db.query(selectSql, [cleanUser]);
      const userRow = rows[0];

      if (userRow) {
        const isMatch = await verifyAndUpgradePassword(pwd, userRow.password, async (newHash) => {
          await db.query(
            'UPDATE mothers SET password = $1, updated_at = NOW() WHERE mother_id = $2;',
            [newHash, userRow.mother_id]
          );
          log('info', 'Upgraded legacy mother password to bcrypt hash in PostgreSQL', { motherId: userRow.mother_id });
        });

        if (isMatch) {
          const token = generateToken({
            id: userRow.mother_id,
            role: 'mother',
            username: userRow.username
          });
          res.cookie('token', token, COOKIE_OPTIONS);
          return res.json({
            token,
            user: sanitizeUser(userRow)
          });
        }
      }
    } catch (err) {
      log('error', 'PostgreSQL mother login exception', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Authentication service temporarily unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    log('warn', 'Mother login evaluated against local mock fallback (DEV ONLY)');
    const mockUser = mockMothers.find(m => m.username === cleanUser || m.email === cleanUser);
    if (mockUser) {
      const isMatch = await verifyAndUpgradePassword(pwd, mockUser.password, (newHash) => {
        mockUser.password = newHash;
      });
      if (isMatch) {
        const token = generateToken({ id: mockUser.mother_id, role: 'mother', username: mockUser.username });
        res.cookie('token', token, COOKIE_OPTIONS);
        return res.json({ token, user: sanitizeUser(mockUser) });
      }
    }
  }

  // Generic authentication failure response
  return res.status(401).json({ error: 'Invalid username or password.' });
});

// ── API: Doctor Login ───────────────────────────────────────────────────────
app.post('/api/auth/login-doctor', authLimiter, async (req, res) => {
  const { docId, pwd } = req.body;

  if (!docId || !pwd) {
    return res.status(400).json({ error: 'Doctor ID and password are required.' });
  }

  const cleanId = docId.trim();

  if (db.isDbConfigured()) {
    try {
      const selectSql = `
        SELECT * FROM doctors
        WHERE doctor_id = $1
        LIMIT 1;
      `;
      const { rows } = await db.query(selectSql, [cleanId]);
      const docRow = rows[0];

      if (docRow) {
        const isMatch = await verifyAndUpgradePassword(pwd, docRow.password, async (newHash) => {
          await db.query(
            'UPDATE doctors SET password = $1, updated_at = NOW() WHERE doctor_id = $2;',
            [newHash, docRow.doctor_id]
          );
          log('info', 'Upgraded legacy doctor password to bcrypt hash in PostgreSQL', { doctorId: docRow.doctor_id });
        });

        if (isMatch) {
          const token = generateToken({
            id: docRow.doctor_id,
            role: 'doctor',
            name: docRow.name
          });
          res.cookie('token', token, COOKIE_OPTIONS);
          return res.json({
            token,
            doctor: sanitizeUser(docRow)
          });
        }
      }
    } catch (err) {
      log('error', 'PostgreSQL doctor login exception', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Authentication service temporarily unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    log('warn', 'Doctor login evaluated against mock data (DEV ONLY)');
    const docRow = mockDoctors.find(d => d.doctor_id === cleanId);
    if (docRow) {
      const isMatch = await verifyAndUpgradePassword(pwd, docRow.password, (newHash) => {
        docRow.password = newHash;
      });
      if (isMatch) {
        const token = generateToken({ id: docRow.doctor_id, role: 'doctor', name: docRow.name });
        res.cookie('token', token, COOKIE_OPTIONS);
        return res.json({ token, doctor: sanitizeUser(docRow) });
      }
    }
  }

  return res.status(401).json({ error: 'Invalid doctor ID or password.' });
});

// ── API: Current Session Profile ────────────────────────────────────────────
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ── API: Logout ─────────────────────────────────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTIONS);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// ── API: Questionnaire Submit ───────────────────────────────────────────────
app.post('/api/questionnaire', authenticate, async (req, res) => {
  const { motherId, age, bloodType, status, currentWeek, dueDate, chronicDetails, allergies, weight } = req.body;

  // Authorization: Mother can ONLY update her own records. Doctors can update any.
  if (req.user.role === 'mother' && parseInt(motherId, 10) !== parseInt(req.user.id, 10)) {
    return res.status(403).json({ error: 'Access denied: You cannot modify records for other patients.' });
  }

  const targetId = parseInt(motherId || req.user.id, 10);

  if (db.isDbConfigured()) {
    try {
      const updateSql = `
        UPDATE mothers
        SET age = $1,
            blood_group = $2,
            pregnancy_stage = $3,
            medical_history = $4,
            current_week = $5,
            due_date = $6,
            updated_at = NOW()
        WHERE mother_id = $7
        RETURNING mother_id;
      `;
      const params = [
        age ? parseInt(age, 10) : null,
        bloodType || null,
        status === 'pregnant' ? 1 : 0,
        chronicDetails || allergies || null,
        currentWeek ? parseInt(currentWeek, 10) : 1,
        dueDate || null,
        targetId
      ];

      const { rows } = await db.query(updateSql, params);
      if (rows && rows.length > 0) {
        return res.json({ success: true });
      }
      log('warn', 'Questionnaire update matched 0 rows in PostgreSQL', { targetId });
    } catch (err) {
      log('error', 'Questionnaire update exception', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Database service unavailable. Could not save questionnaire.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const mother = mockMothers.find(m => m.mother_id === targetId);
    if (mother) {
      if (age) mother.age = parseInt(age, 10);
      if (bloodType) mother.blood_group = bloodType;
      if (currentWeek) mother.current_week = parseInt(currentWeek, 10);
      if (dueDate) mother.due_date = dueDate;
      if (chronicDetails || allergies) mother.medical_history = chronicDetails || allergies;
      return res.json({ success: true });
    }
  }

  if (!ENABLE_MOCK_FALLBACK) {
    return res.status(503).json({ error: 'Database service unavailable. Could not save questionnaire.' });
  }

  return res.json({ success: true });
});

// ── API: Mother Dashboard Data ──────────────────────────────────────────────
app.get('/api/dashboard/:motherId', authenticate, async (req, res) => {
  const reqMotherId = parseInt(req.params.motherId, 10);

  // Authorization: Enforce strict cross-patient isolation.
  // A mother can only view her own dashboard data. Doctors can view all patients.
  if (req.user.role === 'mother' && parseInt(req.user.id, 10) !== reqMotherId) {
    log('warn', 'Unauthorized dashboard access attempt blocked', {
      authenticatedMotherId: req.user.id,
      requestedMotherId: reqMotherId
    });
    return res.status(403).json({ error: 'Access denied: You cannot access another patient\'s medical data.' });
  }

  if (db.isDbConfigured()) {
    try {
      const [
        monitorsRes,
        apptsRes,
        supportRes,
        hospitalsRes,
        recordsRes,
        infantsRes
      ] = await Promise.all([
        db.query('SELECT * FROM health_monitors WHERE mother_id = $1 ORDER BY record_date DESC;', [reqMotherId]),
        db.query(`
          SELECT a.*,
                 d.name AS doctor_name,
                 d.specialization AS doctor_specialization,
                 d.contact_no AS doctor_contact,
                 COALESCE(h.name, 'City Hospital') AS hospital_name,
                 COALESCE(h.location, 'Chennai') AS hospital_location
          FROM appointments a
          LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
          LEFT JOIN hospitals h ON CAST(h.hospital_id AS VARCHAR) = CAST(d.hospitalref_id AS VARCHAR)
          WHERE a.mother_id = $1
          ORDER BY a.appointment_date ASC;
        `, [reqMotherId]),
        db.query('SELECT * FROM support_contacts WHERE mother_id = $1;', [reqMotherId]),
        db.query('SELECT * FROM hospitals;', []),
        db.query('SELECT * FROM medical_records WHERE mother_id = $1 ORDER BY record_date DESC;', [reqMotherId]),
        db.query(`
          SELECT i.*, COALESCE(
            (SELECT json_agg(v.*) FROM vaccinations v WHERE v.infant_id = i.infant_id),
            '[]'::json
          ) AS vaccinations
          FROM infants i
          WHERE i.mother_id = $1;
        `, [reqMotherId])
      ]);

      const monitors = monitorsRes.rows || [];
      const vitals = monitors.length > 0 ? monitors[0] : null;

      return res.json({
        vitals,
        history: monitors,
        appointments: apptsRes.rows || [],
        supportContacts: supportRes.rows || [],
        hospitals: hospitalsRes.rows || [],
        medicalRecords: recordsRes.rows || [],
        infants: infantsRes.rows || []
      });
    } catch (err) {
      log('error', 'PostgreSQL dashboard query failed', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Health record database service unavailable.' });
      }
    }
  }

  if (!ENABLE_MOCK_FALLBACK) {
    return res.status(503).json({ error: 'Health record database service unavailable.' });
  }

  log('warn', 'Serving mock dashboard data for local offline development');
  const mMonitors = mockHealthMonitors.filter(m => m.mother_id === reqMotherId);
  return res.json({
    vitals: mMonitors[0] || null,
    history: mMonitors,
    appointments: mockAppointments.filter(a => a.mother_id === reqMotherId).map(enrichAppointmentRecord),
    supportContacts: [],
    hospitals: mockHospitals,
    medicalRecords: mockMedicalRecords.filter(r => r.mother_id === reqMotherId),
    infants: []
  });
});

// ── API: Doctor Prescription Write ──────────────────────────────────────────
app.post('/api/doctor/prescription', authenticate, requireRole('doctor'), async (req, res) => {
  const { motherId, diagnosis, prescription } = req.body;

  if (!motherId || !diagnosis || !prescription) {
    return res.status(400).json({ error: 'Patient ID, diagnosis, and prescription details are required.' });
  }

  const targetMotherId = parseInt(motherId, 10);
  const today = new Date().toISOString().split('T')[0];

  if (db.isDbConfigured()) {
    try {
      const insertSql = `
        INSERT INTO medical_records (mother_id, diagnosis, prescription, record_date)
        VALUES ($1, $2, $3, $4)
        RETURNING record_id;
      `;
      const { rows } = await db.query(insertSql, [targetMotherId, diagnosis, prescription, today]);
      if (rows && rows.length > 0) {
        log('info', 'Doctor prescription recorded in PostgreSQL', { doctorId: req.user.id, motherId: targetMotherId });
        return res.json({ success: true, recordId: rows[0].record_id });
      }
    } catch (err) {
      log('error', 'PostgreSQL prescription database exception', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Database service unavailable. Failed to persist prescription.' });
      }
    }
  }

  if (!ENABLE_MOCK_FALLBACK) {
    return res.status(503).json({ error: 'Database service unavailable. Failed to persist prescription.' });
  }

  log('warn', 'Saving prescription in memory mock records (DEV ONLY)');
  mockMedicalRecords.push({
    record_id: mockMedicalRecords.length + 1,
    mother_id: targetMotherId,
    diagnosis,
    prescription,
    record_date: today
  });
  return res.json({ success: true });
});

// ── API: Doctor Dashboard Patients ──────────────────────────────────────────
app.get('/api/doctor/patients', authenticate, requireRole('doctor'), async (req, res) => {
  if (db.isDbConfigured()) {
    try {
      const mothersRes = await db.query(`
        SELECT mother_id, first_name, last_name, email, username, status,
               pregnancy_stage, current_week, due_date, age, blood_group, medical_history
        FROM mothers
        ORDER BY mother_id;
      `);

      const [monitorsRes, apptsRes, infantsRes] = await Promise.all([
        db.query('SELECT * FROM health_monitors ORDER BY record_date DESC;'),
        db.query('SELECT * FROM appointments ORDER BY appointment_date ASC;'),
        db.query('SELECT * FROM infants;')
      ]);

      const monitors = monitorsRes.rows || [];
      const appts = apptsRes.rows || [];
      const infants = infantsRes.rows || [];

      const result = (mothersRes.rows || []).map(m => ({
        ...m,
        health_monitors: monitors.filter(h => h.mother_id === m.mother_id),
        appointments: appts.filter(a => a.mother_id === m.mother_id),
        infants: infants.filter(i => i.mother_id === m.mother_id)
      }));

      return res.json(result);
    } catch (err) {
      log('error', 'PostgreSQL doctor patients query failed', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Database service unavailable. Cannot retrieve patient list.' });
      }
    }
  }

  if (!ENABLE_MOCK_FALLBACK) {
    return res.status(503).json({ error: 'Database service unavailable. Cannot retrieve patient list.' });
  }

  log('warn', 'Serving mock doctor patient roster (DEV ONLY)');
  const result = mockMothers.map(m => ({
    ...sanitizeUser(m),
    health_monitors: mockHealthMonitors.filter(h => h.mother_id === m.mother_id),
    appointments: mockAppointments.filter(a => a.mother_id === m.mother_id),
    infants: []
  }));
  return res.json(result);
});

// ── API: Doctors Directory ──────────────────────────────────────────────────
app.get('/api/doctors', async (req, res) => {
  const { specialization } = req.query;

  if (db.isDbConfigured()) {
    try {
      const querySql = `
        SELECT d.doctor_id, d.name, d.specialization, d.experience, d.contact_no,
               COALESCE(h.name, 'City Hospital') AS hospital_name,
               COALESCE(h.location, 'Chennai') AS hospital_location
        FROM doctors d
        LEFT JOIN hospitals h ON CAST(h.hospital_id AS VARCHAR) = CAST(d.hospitalref_id AS VARCHAR)
        WHERE ($1::text IS NULL OR d.specialization ILIKE '%' || $1 || '%')
        ORDER BY d.doctor_id;
      `;
      const { rows } = await db.query(querySql, [specialization ? String(specialization) : null]);
      return res.json(rows || []);
    } catch (err) {
      log('warn', 'PostgreSQL doctors query exception', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Doctor directory service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    let list = mockDoctors;
    if (specialization) {
      const q = specialization.toLowerCase();
      list = list.filter(d => d.specialization && d.specialization.toLowerCase().includes(q));
    }
    return res.json(list.map(d => ({
      doctor_id: d.doctor_id,
      name: d.name,
      specialization: d.specialization,
      experience: d.experience,
      contact_no: d.contact_no,
      hospital_name: d.hospital_name || 'City Hospital',
      hospital_location: 'Chennai'
    })));
  }

  return res.status(503).json({ error: 'Doctor directory service unavailable.' });
});

// ── API: Doctor Available Time Slots ────────────────────────────────────────
app.get('/api/doctors/:doctorId/slots', authenticate, async (req, res) => {
  const { doctorId } = req.params;
  const { date } = req.query;

  if (!date || !isValidFutureDate(date)) {
    return res.status(400).json({ error: 'Valid appointment date (today or future in YYYY-MM-DD format) is required.' });
  }

  if (db.isDbConfigured()) {
    try {
      const docRes = await db.query('SELECT doctor_id, name FROM doctors WHERE doctor_id = $1 LIMIT 1;', [doctorId]);
      if (!docRes.rows || docRes.rows.length === 0) {
        return res.status(404).json({ error: 'Doctor not found.' });
      }
      const doc = docRes.rows[0];

      const apptsRes = await db.query(`
        SELECT appointment_time, status
        FROM appointments
        WHERE doctor_id = $1
          AND appointment_date = $2
          AND status NOT IN ('Cancelled', 'Rejected');
      `, [doctorId, date]);

      const bookedSlots = (apptsRes.rows || []).map(a => a.appointment_time).filter(Boolean);
      const availableSlots = VALID_TIME_SLOTS.filter(slot => !bookedSlots.includes(slot));

      return res.json({
        doctorId,
        doctorName: doc.name,
        date,
        allSlots: VALID_TIME_SLOTS,
        bookedSlots,
        availableSlots
      });
    } catch (err) {
      log('warn', 'PostgreSQL slot check error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Slot schedule service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const doc = mockDoctors.find(d => d.doctor_id === doctorId);
    if (!doc) {
      return res.status(404).json({ error: 'Doctor not found.' });
    }

    const bookedSlots = mockAppointments
      .filter(a => a.doctor_id === doctorId && a.appointment_date === date && a.status !== 'Cancelled' && a.status !== 'Rejected')
      .map(a => a.appointment_time);

    const availableSlots = VALID_TIME_SLOTS.filter(slot => !bookedSlots.includes(slot));

    return res.json({
      doctorId,
      doctorName: doc.name,
      date,
      allSlots: VALID_TIME_SLOTS,
      bookedSlots,
      availableSlots
    });
  }

  return res.status(503).json({ error: 'Slot schedule service unavailable.' });
});

// ── API: Patient Books Appointment ──────────────────────────────────────────
app.post('/api/appointments', authenticate, requireRole('mother'), async (req, res) => {
  const motherId = parseInt(req.user.id, 10);
  const { doctorId, appointmentDate, appointmentTime, reason, appointmentType } = req.body;

  // Strict Server-Side Validations
  if (!doctorId || typeof doctorId !== 'string') {
    return res.status(400).json({ error: 'Valid doctor selection is required.' });
  }

  if (!appointmentDate || !isValidFutureDate(appointmentDate)) {
    return res.status(400).json({ error: 'Appointment date must be today or a future date in YYYY-MM-DD format.' });
  }

  if (!appointmentTime || !VALID_TIME_SLOTS.includes(appointmentTime)) {
    return res.status(400).json({ error: `Invalid time slot. Allowed slots: ${VALID_TIME_SLOTS.join(', ')}` });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    return res.status(400).json({ error: 'Reason for visit is required (minimum 3 characters).' });
  }

  const cleanReason = reason.trim();
  const cleanType = (appointmentType && typeof appointmentType === 'string') 
    ? appointmentType.trim() 
    : 'Prenatal Checkup';

  if (db.isDbConfigured()) {
    try {
      const docRes = await db.query(`
        SELECT doctor_id, name, specialization, contact_no, hospitalref_id
        FROM doctors
        WHERE doctor_id = $1
        LIMIT 1;
      `, [doctorId]);

      if (!docRes.rows || docRes.rows.length === 0) {
        return res.status(404).json({ error: 'Selected doctor does not exist.' });
      }
      const doc = docRes.rows[0];

      // Check Doctor conflict (double-booking)
      const docConflictRes = await db.query(`
        SELECT appointment_id FROM appointments
        WHERE doctor_id = $1
          AND appointment_date = $2
          AND appointment_time = $3
          AND status NOT IN ('Cancelled', 'Rejected')
        LIMIT 1;
      `, [doctorId, appointmentDate, appointmentTime]);

      if (docConflictRes.rows && docConflictRes.rows.length > 0) {
        return res.status(409).json({ error: 'This time slot is already booked for this doctor. Please choose another time.' });
      }

      // Check Patient conflict
      const patientConflictRes = await db.query(`
        SELECT appointment_id FROM appointments
        WHERE mother_id = $1
          AND appointment_date = $2
          AND appointment_time = $3
          AND status NOT IN ('Cancelled', 'Rejected')
        LIMIT 1;
      `, [motherId, appointmentDate, appointmentTime]);

      if (patientConflictRes.rows && patientConflictRes.rows.length > 0) {
        return res.status(409).json({ error: 'You already have an active appointment scheduled at this date and time.' });
      }

      const insertSql = `
        INSERT INTO appointments (
          mother_id, doctor_id, appointment_date, appointment_time,
          reason, appointment_type, status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Pending', NULL)
        RETURNING *;
      `;
      const { rows } = await db.query(insertSql, [
        motherId,
        doctorId,
        appointmentDate,
        appointmentTime,
        cleanReason,
        cleanType
      ]);

      const newRow = rows[0];
      if (newRow) {
        log('info', 'Patient appointment request created in PostgreSQL', { motherId, doctorId, appointmentId: newRow.appointment_id });
        return res.status(201).json({
          success: true,
          message: 'Appointment request submitted successfully. Awaiting doctor confirmation.',
          appointment: {
            ...newRow,
            doctor_name: doc.name,
            doctor_specialization: doc.specialization,
            hospital_name: 'City Hospital'
          }
        });
      }
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This time slot is already booked for this doctor. Please choose another time.' });
      }
      log('error', 'PostgreSQL appointment booking exception', { error: err.message, code: err.code });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Appointment booking service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const doc = mockDoctors.find(d => d.doctor_id === doctorId);
    if (!doc) {
      return res.status(404).json({ error: 'Selected doctor does not exist.' });
    }

    // Double booking check: Doctor
    const docBusy = mockAppointments.some(a => 
      a.doctor_id === doctorId && 
      a.appointment_date === appointmentDate && 
      a.appointment_time === appointmentTime && 
      a.status !== 'Cancelled' && 
      a.status !== 'Rejected'
    );
    if (docBusy) {
      return res.status(409).json({ error: 'This time slot is already booked for this doctor. Please choose another time.' });
    }

    // Double booking check: Patient
    const patientBusy = mockAppointments.some(a => 
      a.mother_id === motherId && 
      a.appointment_date === appointmentDate && 
      a.appointment_time === appointmentTime && 
      a.status !== 'Cancelled' && 
      a.status !== 'Rejected'
    );
    if (patientBusy) {
      return res.status(409).json({ error: 'You already have an active appointment scheduled at this date and time.' });
    }

    const created = {
      appointment_id: nextAppointmentId++,
      mother_id: motherId,
      doctor_id: doctorId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      reason: cleanReason,
      appointment_type: cleanType,
      status: 'Pending',
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockAppointments.push(created);

    log('info', 'Mock patient appointment created', { motherId, doctorId, appointmentId: created.appointment_id });
    return res.status(201).json({
      success: true,
      message: 'Appointment request submitted successfully. Awaiting doctor confirmation.',
      appointment: enrichAppointmentRecord(created)
    });
  }

  return res.status(503).json({ error: 'Appointment booking service unavailable.' });
});

// ── API: Patient's Own Appointments ─────────────────────────────────────────
app.get('/api/appointments', authenticate, requireRole('mother'), async (req, res) => {
  const motherId = parseInt(req.user.id, 10);

  if (db.isDbConfigured()) {
    try {
      const selectSql = `
        SELECT a.*,
               d.name AS doctor_name,
               d.specialization AS doctor_specialization,
               d.contact_no AS doctor_contact,
               COALESCE(h.name, 'City Hospital') AS hospital_name,
               COALESCE(h.location, 'Chennai') AS hospital_location
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN hospitals h ON CAST(h.hospital_id AS VARCHAR) = CAST(d.hospitalref_id AS VARCHAR)
        WHERE a.mother_id = $1
        ORDER BY a.appointment_date ASC;
      `;
      const { rows } = await db.query(selectSql, [motherId]);
      return res.json(rows || []);
    } catch (err) {
      log('warn', 'PostgreSQL appointments retrieval error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Appointment retrieval service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const list = mockAppointments
      .filter(a => a.mother_id === motherId)
      .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date))
      .map(enrichAppointmentRecord);
    return res.json(list);
  }

  return res.status(503).json({ error: 'Appointment retrieval service unavailable.' });
});

// ── API: View Single Appointment Details ────────────────────────────────────
app.get('/api/appointments/:id', authenticate, async (req, res) => {
  const apptId = parseInt(req.params.id, 10);

  if (db.isDbConfigured()) {
    try {
      const selectSql = `
        SELECT a.*,
               d.name AS doctor_name,
               d.specialization AS doctor_specialization,
               d.contact_no AS doctor_contact,
               COALESCE(h.name, 'City Hospital') AS hospital_name,
               COALESCE(h.location, 'Chennai') AS hospital_location,
               CONCAT(m.first_name, ' ', m.last_name) AS mother_name,
               m.email AS mother_email
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.doctor_id
        LEFT JOIN hospitals h ON CAST(h.hospital_id AS VARCHAR) = CAST(d.hospitalref_id AS VARCHAR)
        LEFT JOIN mothers m ON a.mother_id = m.mother_id
        WHERE a.appointment_id = $1
        LIMIT 1;
      `;
      const { rows } = await db.query(selectSql, [apptId]);
      const a = rows[0];

      if (!a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (req.user.role === 'mother' && parseInt(req.user.id, 10) !== a.mother_id) {
        return res.status(403).json({ error: 'Access denied: You cannot view another patient\'s appointment.' });
      }
      if (req.user.role === 'doctor' && req.user.id !== a.doctor_id) {
        return res.status(403).json({ error: 'Access denied: You cannot view appointments for other doctors.' });
      }

      return res.json(a);
    } catch (err) {
      log('warn', 'PostgreSQL appointment detail error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const a = mockAppointments.find(item => item.appointment_id === apptId);
    if (!a) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (req.user.role === 'mother' && parseInt(req.user.id, 10) !== a.mother_id) {
      return res.status(403).json({ error: 'Access denied: You cannot view another patient\'s appointment.' });
    }
    if (req.user.role === 'doctor' && req.user.id !== a.doctor_id) {
      return res.status(403).json({ error: 'Access denied: You cannot view appointments for other doctors.' });
    }

    return res.json(enrichAppointmentRecord(a));
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── API: Patient Cancels Appointment ────────────────────────────────────────
app.patch('/api/appointments/:id/cancel', authenticate, requireRole('mother'), async (req, res) => {
  const apptId = parseInt(req.params.id, 10);
  const motherId = parseInt(req.user.id, 10);
  const { reason } = req.body || {};

  if (db.isDbConfigured()) {
    try {
      const checkRes = await db.query('SELECT * FROM appointments WHERE appointment_id = $1 LIMIT 1;', [apptId]);
      const a = checkRes.rows[0];

      if (!a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (a.mother_id !== motherId) {
        return res.status(403).json({ error: 'Access denied: You can only cancel your own appointments.' });
      }

      if (a.status === 'Completed') {
        return res.status(400).json({ error: 'Cannot cancel an appointment that has already been completed.' });
      }
      if (a.status === 'Cancelled' || a.status === 'Rejected') {
        return res.status(400).json({ error: 'Appointment is already cancelled.' });
      }

      const noteUpdate = reason ? `Cancelled by patient: ${reason}` : 'Cancelled by patient';
      const updateSql = `
        UPDATE appointments
        SET status = 'Cancelled', notes = $1, updated_at = NOW()
        WHERE appointment_id = $2
        RETURNING *;
      `;
      const { rows } = await db.query(updateSql, [noteUpdate, apptId]);
      const updated = rows[0];

      if (updated) {
        log('info', 'Patient cancelled appointment in PostgreSQL', { appointmentId: apptId, motherId });
        return res.json({ success: true, message: 'Appointment cancelled successfully.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'PostgreSQL appointment cancel failed', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const a = mockAppointments.find(item => item.appointment_id === apptId);
    if (!a) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (a.mother_id !== motherId) {
      return res.status(403).json({ error: 'Access denied: You can only cancel your own appointments.' });
    }

    if (a.status === 'Completed') {
      return res.status(400).json({ error: 'Cannot cancel an appointment that has already been completed.' });
    }
    if (a.status === 'Cancelled' || a.status === 'Rejected') {
      return res.status(400).json({ error: 'Appointment is already cancelled.' });
    }

    a.status = 'Cancelled';
    a.notes = reason ? `Cancelled by patient: ${reason}` : 'Cancelled by patient';
    a.updated_at = new Date().toISOString();

    log('info', 'Mock patient cancelled appointment', { appointmentId: apptId, motherId });
    return res.json({ success: true, message: 'Appointment cancelled successfully.', appointment: enrichAppointmentRecord(a) });
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── API: Doctor Appointments Roster ─────────────────────────────────────────
app.get('/api/doctor/appointments', authenticate, requireRole('doctor'), async (req, res) => {
  const doctorId = req.user.id;

  if (db.isDbConfigured()) {
    try {
      const selectSql = `
        SELECT a.*,
               CONCAT(m.first_name, ' ', m.last_name) AS mother_name,
               m.email AS mother_email,
               m.status AS mother_status,
               m.current_week AS mother_week,
               m.age AS mother_age,
               m.blood_group AS mother_blood_group
        FROM appointments a
        LEFT JOIN mothers m ON a.mother_id = m.mother_id
        WHERE a.doctor_id = $1
        ORDER BY a.appointment_date ASC;
      `;
      const { rows } = await db.query(selectSql, [doctorId]);
      return res.json(rows || []);
    } catch (err) {
      log('warn', 'PostgreSQL doctor appointments query error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Doctor appointments service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const list = mockAppointments
      .filter(a => a.doctor_id === doctorId)
      .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date))
      .map(enrichAppointmentRecord);
    return res.json(list);
  }

  return res.status(503).json({ error: 'Doctor appointments service unavailable.' });
});

// ── API: Doctor Confirms Appointment ────────────────────────────────────────
app.patch('/api/doctor/appointments/:id/confirm', authenticate, requireRole('doctor'), async (req, res) => {
  const apptId = parseInt(req.params.id, 10);
  const doctorId = req.user.id;

  if (db.isDbConfigured()) {
    try {
      const checkRes = await db.query('SELECT * FROM appointments WHERE appointment_id = $1 LIMIT 1;', [apptId]);
      const a = checkRes.rows[0];

      if (!a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (a.doctor_id !== doctorId) {
        return res.status(403).json({ error: 'Access denied: You can only confirm appointments assigned to you.' });
      }

      if (a.status === 'Scheduled') {
        return res.status(400).json({ error: 'Appointment is already confirmed and scheduled.' });
      }
      if (a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'Rejected') {
        return res.status(400).json({ error: `Cannot confirm an appointment with status '${a.status}'.` });
      }

      const updateSql = `
        UPDATE appointments
        SET status = 'Scheduled', updated_at = NOW()
        WHERE appointment_id = $1
        RETURNING *;
      `;
      const { rows } = await db.query(updateSql, [apptId]);
      const updated = rows[0];

      if (updated) {
        log('info', 'Doctor confirmed appointment in PostgreSQL', { appointmentId: apptId, doctorId });
        return res.json({ success: true, message: 'Appointment confirmed successfully.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'PostgreSQL doctor confirm error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const a = mockAppointments.find(item => item.appointment_id === apptId);
    if (!a) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (a.doctor_id !== doctorId) {
      return res.status(403).json({ error: 'Access denied: You can only confirm appointments assigned to you.' });
    }

    if (a.status === 'Scheduled') {
      return res.status(400).json({ error: 'Appointment is already confirmed and scheduled.' });
    }
    if (a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'Rejected') {
      return res.status(400).json({ error: `Cannot confirm an appointment with status '${a.status}'.` });
    }

    a.status = 'Scheduled';
    a.updated_at = new Date().toISOString();

    log('info', 'Mock doctor confirmed appointment', { appointmentId: apptId, doctorId });
    return res.json({ success: true, message: 'Appointment confirmed successfully.', appointment: enrichAppointmentRecord(a) });
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── API: Doctor Rejects Appointment ─────────────────────────────────────────
app.patch('/api/doctor/appointments/:id/reject', authenticate, requireRole('doctor'), async (req, res) => {
  const apptId = parseInt(req.params.id, 10);
  const doctorId = req.user.id;
  const { reason } = req.body || {};

  if (db.isDbConfigured()) {
    try {
      const checkRes = await db.query('SELECT * FROM appointments WHERE appointment_id = $1 LIMIT 1;', [apptId]);
      const a = checkRes.rows[0];

      if (!a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (a.doctor_id !== doctorId) {
        return res.status(403).json({ error: 'Access denied: You can only manage appointments assigned to you.' });
      }

      if (a.status === 'Completed') {
        return res.status(400).json({ error: 'Cannot reject an already completed appointment.' });
      }
      if (a.status === 'Cancelled' || a.status === 'Rejected') {
        return res.status(400).json({ error: 'Appointment is already cancelled or rejected.' });
      }

      const noteUpdate = reason ? `Declined by doctor: ${reason}` : 'Declined by doctor';
      const updateSql = `
        UPDATE appointments
        SET status = 'Rejected', notes = $1, updated_at = NOW()
        WHERE appointment_id = $2
        RETURNING *;
      `;
      const { rows } = await db.query(updateSql, [noteUpdate, apptId]);
      const updated = rows[0];

      if (updated) {
        log('info', 'Doctor rejected appointment in PostgreSQL', { appointmentId: apptId, doctorId });
        return res.json({ success: true, message: 'Appointment declined.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'PostgreSQL doctor reject error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const a = mockAppointments.find(item => item.appointment_id === apptId);
    if (!a) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (a.doctor_id !== doctorId) {
      return res.status(403).json({ error: 'Access denied: You can only manage appointments assigned to you.' });
    }

    if (a.status === 'Completed') {
      return res.status(400).json({ error: 'Cannot reject an already completed appointment.' });
    }
    if (a.status === 'Cancelled' || a.status === 'Rejected') {
      return res.status(400).json({ error: 'Appointment is already cancelled or rejected.' });
    }

    a.status = 'Rejected';
    a.notes = reason ? `Declined by doctor: ${reason}` : 'Declined by doctor';
    a.updated_at = new Date().toISOString();

    log('info', 'Mock doctor rejected appointment', { appointmentId: apptId, doctorId });
    return res.json({ success: true, message: 'Appointment declined.', appointment: enrichAppointmentRecord(a) });
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── API: Doctor Reschedules Appointment ─────────────────────────────────────
app.patch('/api/doctor/appointments/:id/reschedule', authenticate, requireRole('doctor'), async (req, res) => {
  const apptId = parseInt(req.params.id, 10);
  const doctorId = req.user.id;
  const { appointmentDate, appointmentTime, notes } = req.body;

  if (!appointmentDate || !isValidFutureDate(appointmentDate)) {
    return res.status(400).json({ error: 'Valid appointment date (today or future in YYYY-MM-DD format) is required.' });
  }

  if (!appointmentTime || !VALID_TIME_SLOTS.includes(appointmentTime)) {
    return res.status(400).json({ error: `Invalid time slot. Allowed slots: ${VALID_TIME_SLOTS.join(', ')}` });
  }

  if (db.isDbConfigured()) {
    try {
      const checkRes = await db.query('SELECT * FROM appointments WHERE appointment_id = $1 LIMIT 1;', [apptId]);
      const a = checkRes.rows[0];

      if (!a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (a.doctor_id !== doctorId) {
        return res.status(403).json({ error: 'Access denied: You can only reschedule appointments assigned to you.' });
      }

      if (a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'Rejected') {
        return res.status(400).json({ error: `Cannot reschedule an appointment with status '${a.status}'.` });
      }

      // Check doctor availability on new date & slot (excluding this appointment)
      const conflictRes = await db.query(`
        SELECT appointment_id FROM appointments
        WHERE doctor_id = $1
          AND appointment_date = $2
          AND appointment_time = $3
          AND appointment_id <> $4
          AND status NOT IN ('Cancelled', 'Rejected')
        LIMIT 1;
      `, [doctorId, appointmentDate, appointmentTime, apptId]);

      if (conflictRes.rows && conflictRes.rows.length > 0) {
        return res.status(409).json({ error: 'This time slot is already booked on the proposed date.' });
      }

      const noteText = notes ? `Rescheduled by doctor: ${notes}` : 'Rescheduled by doctor to new time slot';
      const updateSql = `
        UPDATE appointments
        SET appointment_date = $1,
            appointment_time = $2,
            status = 'Rescheduled',
            notes = $3,
            updated_at = NOW()
        WHERE appointment_id = $4
        RETURNING *;
      `;
      const { rows } = await db.query(updateSql, [appointmentDate, appointmentTime, noteText, apptId]);
      const updated = rows[0];

      if (updated) {
        log('info', 'Doctor rescheduled appointment in PostgreSQL', { appointmentId: apptId, doctorId, appointmentDate, appointmentTime });
        return res.json({ success: true, message: 'Appointment rescheduled successfully.', appointment: updated });
      }
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This time slot is already booked on the proposed date.' });
      }
      log('warn', 'PostgreSQL doctor reschedule error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const a = mockAppointments.find(item => item.appointment_id === apptId);
    if (!a) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (a.doctor_id !== doctorId) {
      return res.status(403).json({ error: 'Access denied: You can only reschedule appointments assigned to you.' });
    }

    if (a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'Rejected') {
      return res.status(400).json({ error: `Cannot reschedule an appointment with status '${a.status}'.` });
    }

    const conflict = mockAppointments.some(other =>
      other.appointment_id !== apptId &&
      other.doctor_id === doctorId &&
      other.appointment_date === appointmentDate &&
      other.appointment_time === appointmentTime &&
      other.status !== 'Cancelled' &&
      other.status !== 'Rejected'
    );

    if (conflict) {
      return res.status(409).json({ error: 'This time slot is already booked on the proposed date.' });
    }

    a.appointment_date = appointmentDate;
    a.appointment_time = appointmentTime;
    a.status = 'Rescheduled';
    a.notes = notes ? `Rescheduled by doctor: ${notes}` : 'Rescheduled by doctor to new time slot';
    a.updated_at = new Date().toISOString();

    log('info', 'Mock doctor rescheduled appointment', { appointmentId: apptId, doctorId, appointmentDate, appointmentTime });
    return res.json({ success: true, message: 'Appointment rescheduled successfully.', appointment: enrichAppointmentRecord(a) });
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── API: Doctor Schedules Follow-Up Appointment ─────────────────────────────
app.post('/api/doctor/appointments/follow-up', authenticate, requireRole('doctor'), async (req, res) => {
  const doctorId = req.user.id;
  const { motherId, appointmentDate, appointmentTime, reason, appointmentType, notes } = req.body;

  if (!motherId) {
    return res.status(400).json({ error: 'Patient ID (motherId) is required.' });
  }

  const targetMotherId = parseInt(motherId, 10);

  if (!appointmentDate || !isValidFutureDate(appointmentDate)) {
    return res.status(400).json({ error: 'Valid appointment date (today or future in YYYY-MM-DD format) is required.' });
  }

  if (!appointmentTime || !VALID_TIME_SLOTS.includes(appointmentTime)) {
    return res.status(400).json({ error: `Invalid time slot. Allowed slots: ${VALID_TIME_SLOTS.join(', ')}` });
  }

  const cleanReason = (reason && typeof reason === 'string' && reason.trim()) || 'Follow-up consultation';
  const cleanType = (appointmentType && typeof appointmentType === 'string' && appointmentType.trim()) || 'Follow-up';

  if (db.isDbConfigured()) {
    try {
      const motherCheck = await db.query('SELECT mother_id FROM mothers WHERE mother_id = $1 LIMIT 1;', [targetMotherId]);
      if (!motherCheck.rows || motherCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Patient not found.' });
      }

      const conflictCheck = await db.query(`
        SELECT appointment_id FROM appointments
        WHERE doctor_id = $1
          AND appointment_date = $2
          AND appointment_time = $3
          AND status NOT IN ('Cancelled', 'Rejected')
        LIMIT 1;
      `, [doctorId, appointmentDate, appointmentTime]);

      if (conflictCheck.rows && conflictCheck.rows.length > 0) {
        return res.status(409).json({ error: 'You already have an appointment booked at this date and time.' });
      }

      const insertSql = `
        INSERT INTO appointments (
          mother_id, doctor_id, appointment_date, appointment_time,
          reason, appointment_type, status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, 'Scheduled', $7)
        RETURNING *;
      `;
      const { rows } = await db.query(insertSql, [
        targetMotherId,
        doctorId,
        appointmentDate,
        appointmentTime,
        cleanReason,
        cleanType,
        notes || 'Scheduled by doctor during consultation'
      ]);

      const created = rows[0];
      if (created) {
        log('info', 'Doctor scheduled follow-up appointment in PostgreSQL', { doctorId, motherId: targetMotherId, appointmentId: created.appointment_id });
        return res.status(201).json({ success: true, message: 'Follow-up appointment scheduled successfully.', appointment: created });
      }
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'You already have an appointment booked at this date and time.' });
      }
      log('warn', 'PostgreSQL follow-up insert error', { error: err.message });
      if (!ENABLE_MOCK_FALLBACK) {
        return res.status(503).json({ error: 'Service unavailable.' });
      }
    }
  }

  if (ENABLE_MOCK_FALLBACK) {
    const mother = mockMothers.find(m => m.mother_id === targetMotherId);
    if (!mother) {
      return res.status(404).json({ error: 'Patient not found.' });
    }

    const conflict = mockAppointments.some(a =>
      a.doctor_id === doctorId &&
      a.appointment_date === appointmentDate &&
      a.appointment_time === appointmentTime &&
      a.status !== 'Cancelled' &&
      a.status !== 'Rejected'
    );

    if (conflict) {
      return res.status(409).json({ error: 'You already have an appointment booked at this date and time.' });
    }

    const created = {
      appointment_id: nextAppointmentId++,
      mother_id: targetMotherId,
      doctor_id: doctorId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      reason: cleanReason,
      appointment_type: cleanType,
      status: 'Scheduled',
      notes: notes || 'Scheduled by doctor during consultation',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    mockAppointments.push(created);

    log('info', 'Mock doctor scheduled follow-up appointment', { doctorId, motherId: targetMotherId, appointmentId: created.appointment_id });
    return res.status(201).json({ success: true, message: 'Follow-up appointment scheduled successfully.', appointment: enrichAppointmentRecord(created) });
  }

  return res.status(503).json({ error: 'Service unavailable.' });
});

// ── Centralized Error Handling Middleware ───────────────────────────────────
app.use((err, req, res, next) => {
  log('error', 'Unhandled application error', {
    requestId: req.id,
    error: err.message,
    ...(IS_PROD ? {} : { stack: err.stack })
  });

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: IS_PROD 
      ? 'An unexpected error occurred. Please try again later.' 
      : err.message
  });
});

// ── Server Bootstrap & Graceful Shutdown ────────────────────────────────────
const server = app.listen(PORT, () => {
  log('info', `Maternix server started successfully`, {
    port: PORT,
    environment: NODE_ENV,
    mockFallback: ENABLE_MOCK_FALLBACK,
    databaseConfigured: db.isDbConfigured()
  });
});

async function gracefulShutdown(signal) {
  log('info', `Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    log('info', 'HTTP server closed.');
    try {
      await db.closePool();
      log('info', 'PostgreSQL connection pool closed.');
    } catch (e) {
      log('error', 'Error while closing PostgreSQL pool', { error: e.message });
    }
    process.exit(0);
  });
  // Force shutdown after 10s timeout
  setTimeout(() => {
    log('error', 'Forced shutdown timeout expired. Exiting.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
