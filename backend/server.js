// =============================================================================
// Maternix — Backend REST API Server
// Production-ready, secure Express server with JWT authentication,
// bcrypt password hashing, role-based authorization, rate limiting,
// and structured logging for AWS deployment.
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
const { createClient } = require('@supabase/supabase-js');

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

// Supabase credentials validation
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
  } catch (err) {
    console.error('[FATAL] Failed to initialize Supabase client:', err.message);
  }
} else if (IS_PROD) {
  console.error('[FATAL] SUPABASE_URL and database key are required in production.');
  process.exit(1);
} else {
  console.warn('[WARN] Running without Supabase credentials. Mock fallback will be used for local development.');
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
    // Upgrade to bcrypt hash
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
  if (supabase) {
    try {
      const { error } = await supabase.from('hospitals').select('hospital_id').limit(1);
      if (error) throw error;
      return res.status(200).json({ status: 'ready', database: 'connected' });
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

  if (supabase) {
    try {
      const { data: motherRow, error } = await supabase
        .from('mothers')
        .insert({
          first_name:      first,
          last_name:       last,
          email:           email.toLowerCase(),
          username:        username.toLowerCase(),
          password:        hashedPassword,
          status:          status,
          pregnancy_stage: status === 'pregnant' ? 1 : 0,
          current_week:    status === 'pregnant' ? 1 : 0,
          due_date:        dueDate || null
        })
        .select('mother_id, first_name, last_name, email, username, status, current_week, due_date')
        .single();

      if (!error && motherRow) {
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

      if (error && error.code === '23505') { // Unique constraint violation in Postgres
        return res.status(409).json({ error: 'Username or email is already registered.' });
      }

      log('warn', 'Supabase signup error', { error: error ? error.message : 'Unknown' });
    } catch (err) {
      log('error', 'Supabase signup exception', { error: err.message });
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

  if (supabase) {
    try {
      const { data: userRow, error } = await supabase
        .from('mothers')
        .select('*')
        .or(`username.eq.${cleanUser},email.eq.${cleanUser}`)
        .maybeSingle();

      if (!error && userRow) {
        const isMatch = await verifyAndUpgradePassword(pwd, userRow.password, async (newHash) => {
          await supabase.from('mothers').update({ password: newHash }).eq('mother_id', userRow.mother_id);
          log('info', 'Upgraded legacy mother password to bcrypt hash', { motherId: userRow.mother_id });
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
      log('error', 'Supabase login exception', { error: err.message });
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

  if (supabase) {
    try {
      const { data: docRow, error } = await supabase
        .from('doctors')
        .select('*')
        .eq('doctor_id', cleanId)
        .maybeSingle();

      if (!error && docRow) {
        const isMatch = await verifyAndUpgradePassword(pwd, docRow.password, async (newHash) => {
          await supabase.from('doctors').update({ password: newHash }).eq('doctor_id', docRow.doctor_id);
          log('info', 'Upgraded legacy doctor password to bcrypt hash', { doctorId: docRow.doctor_id });
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
      log('error', 'Doctor login exception', { error: err.message });
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

  if (supabase) {
    try {
      const { error } = await supabase.from('mothers').update({
        age: age ? parseInt(age, 10) : null,
        blood_group: bloodType || null,
        pregnancy_stage: status === 'pregnant' ? 1 : 0,
        medical_history: chronicDetails || allergies || null,
        current_week: currentWeek ? parseInt(currentWeek, 10) : 1,
        due_date: dueDate || null
      }).eq('mother_id', targetId);

      if (!error) {
        return res.json({ success: true });
      }
      log('warn', 'Supabase questionnaire update failed', { error: error.message });
    } catch (err) {
      log('error', 'Questionnaire update exception', { error: err.message });
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

  if (supabase) {
    try {
      const [
        { data: monitors },
        { data: appts },
        { data: supportContacts },
        { data: hospitals },
        { data: medicalRecords },
        { data: infants },
        { data: doctors }
      ] = await Promise.all([
        supabase.from('health_monitors').select('*').eq('mother_id', reqMotherId).order('record_date', { ascending: false }),
        supabase.from('appointments').select('*').eq('mother_id', reqMotherId).order('appointment_date', { ascending: true }),
        supabase.from('support_contacts').select('*').eq('mother_id', reqMotherId),
        supabase.from('hospitals').select('*'),
        supabase.from('medical_records').select('*').eq('mother_id', reqMotherId).order('record_date', { ascending: false }),
        supabase.from('infants').select('*, vaccinations(*)').eq('mother_id', reqMotherId),
        supabase.from('doctors').select('doctor_id, name, specialization, contact_no, hospitalref_id')
      ]);

      const enrichedAppts = (appts || []).map(a => {
        const doc = (doctors || []).find(d => d.doctor_id === a.doctor_id);
        const hosp = doc ? (hospitals || []).find(h => String(h.hospital_id) === String(doc.hospitalref_id)) : null;
        return {
          ...a,
          doctor_name: doc ? doc.name : (a.doctor_id || 'Doctor'),
          doctor_specialization: doc ? doc.specialization : 'OB-GYN Specialist',
          doctor_contact: doc ? doc.contact_no : '',
          hospital_name: hosp ? hosp.name : 'City Hospital'
        };
      });

      const vitals = monitors && monitors.length > 0 ? monitors[0] : null;
      return res.json({
        vitals,
        history: monitors || [],
        appointments: enrichedAppts,
        supportContacts: supportContacts || [],
        hospitals: hospitals || [],
        medicalRecords: medicalRecords || [],
        infants: infants || []
      });
    } catch (err) {
      log('error', 'Supabase dashboard query failed', { error: err.message });
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

  if (supabase) {
    try {
      const { data, error } = await supabase.from('medical_records').insert({
        mother_id: targetMotherId,
        diagnosis,
        prescription,
        record_date: today
      }).select('record_id').single();

      if (!error) {
        log('info', 'Doctor prescription recorded', { doctorId: req.user.id, motherId: targetMotherId });
        return res.json({ success: true, recordId: data ? data.record_id : null });
      }
      log('warn', 'Prescription insert error', { error: error.message });
    } catch (err) {
      log('error', 'Prescription database exception', { error: err.message });
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
  if (supabase) {
    try {
      const { data: mothers, error: mErr } = await supabase
        .from('mothers')
        .select('mother_id, first_name, last_name, email, username, status, pregnancy_stage, current_week, due_date, age, blood_group, medical_history')
        .order('mother_id');

      if (!mErr && mothers) {
        const [
          { data: monitors },
          { data: appts },
          { data: infants }
        ] = await Promise.all([
          supabase.from('health_monitors').select('*'),
          supabase.from('appointments').select('*'),
          supabase.from('infants').select('*')
        ]);

        const result = mothers.map(m => ({
          ...m,
          health_monitors: (monitors || []).filter(h => h.mother_id === m.mother_id),
          appointments: (appts || []).filter(a => a.mother_id === m.mother_id),
          infants: (infants || []).filter(i => i.mother_id === m.mother_id)
        }));

        return res.json(result);
      }
    } catch (err) {
      log('error', 'Supabase doctor patients query failed', { error: err.message });
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

  if (supabase) {
    try {
      let query = supabase.from('doctors').select('doctor_id, name, specialization, experience, contact_no, hospitalref_id');
      if (specialization) {
        query = query.ilike('specialization', `%${specialization}%`);
      }
      const [{ data: docs, error }, { data: hospitals }] = await Promise.all([
        query,
        supabase.from('hospitals').select('*')
      ]);

      if (!error && docs) {
        const list = docs.map(d => {
          const hosp = (hospitals || []).find(h => String(h.hospital_id) === String(d.hospitalref_id));
          return {
            doctor_id: d.doctor_id,
            name: d.name,
            specialization: d.specialization,
            experience: d.experience,
            contact_no: d.contact_no,
            hospital_name: hosp ? hosp.name : 'City Hospital',
            hospital_location: hosp ? hosp.location : 'Chennai'
          };
        });
        return res.json(list);
      }
    } catch (err) {
      log('warn', 'Supabase doctors query exception', { error: err.message });
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

  if (supabase) {
    try {
      const { data: doc, error: dErr } = await supabase
        .from('doctors')
        .select('doctor_id, name')
        .eq('doctor_id', doctorId)
        .maybeSingle();

      if (dErr || !doc) {
        return res.status(404).json({ error: 'Doctor not found.' });
      }

      const { data: activeAppts } = await supabase
        .from('appointments')
        .select('appointment_time, status')
        .eq('doctor_id', doctorId)
        .eq('appointment_date', date)
        .not('status', 'in', '("Cancelled","Rejected")');

      const bookedSlots = (activeAppts || []).map(a => a.appointment_time).filter(Boolean);
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
      log('warn', 'Supabase slot check error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: doc, error: docErr } = await supabase
        .from('doctors')
        .select('doctor_id, name, specialization, contact_no, hospitalref_id')
        .eq('doctor_id', doctorId)
        .maybeSingle();

      if (docErr || !doc) {
        return res.status(404).json({ error: 'Selected doctor does not exist.' });
      }

      // Check Doctor conflict (double-booking)
      const { data: docConflict } = await supabase
        .from('appointments')
        .select('appointment_id')
        .eq('doctor_id', doctorId)
        .eq('appointment_date', appointmentDate)
        .eq('appointment_time', appointmentTime)
        .not('status', 'in', '("Cancelled","Rejected")')
        .maybeSingle();

      if (docConflict) {
        return res.status(409).json({ error: 'This time slot is already booked for this doctor. Please choose another time.' });
      }

      // Check Patient conflict
      const { data: patientConflict } = await supabase
        .from('appointments')
        .select('appointment_id')
        .eq('mother_id', motherId)
        .eq('appointment_date', appointmentDate)
        .eq('appointment_time', appointmentTime)
        .not('status', 'in', '("Cancelled","Rejected")')
        .maybeSingle();

      if (patientConflict) {
        return res.status(409).json({ error: 'You already have an active appointment scheduled at this date and time.' });
      }

      const { data: newRow, error: insErr } = await supabase
        .from('appointments')
        .insert({
          mother_id: motherId,
          doctor_id: doctorId,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          reason: cleanReason,
          appointment_type: cleanType,
          status: 'Pending',
          notes: null
        })
        .select('*')
        .single();

      if (!insErr && newRow) {
        log('info', 'Patient appointment request created', { motherId, doctorId, appointmentId: newRow.appointment_id });
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
      log('warn', 'Supabase appointment insert failed', { error: insErr ? insErr.message : 'Unknown' });
    } catch (err) {
      log('error', 'Supabase appointment booking exception', { error: err.message });
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

  if (supabase) {
    try {
      const [{ data: appts, error }, { data: doctors }, { data: hospitals }] = await Promise.all([
        supabase.from('appointments').select('*').eq('mother_id', motherId).order('appointment_date', { ascending: true }),
        supabase.from('doctors').select('doctor_id, name, specialization, contact_no, hospitalref_id'),
        supabase.from('hospitals').select('*')
      ]);

      if (!error && appts) {
        const enriched = appts.map(a => {
          const doc = (doctors || []).find(d => d.doctor_id === a.doctor_id);
          const hosp = doc ? (hospitals || []).find(h => String(h.hospital_id) === String(doc.hospitalref_id)) : null;
          return {
            ...a,
            doctor_name: doc ? doc.name : (a.doctor_id || 'Doctor'),
            doctor_specialization: doc ? doc.specialization : 'Specialist',
            doctor_contact: doc ? doc.contact_no : '',
            hospital_name: hosp ? hosp.name : 'City Hospital',
            hospital_location: hosp ? hosp.location : 'Chennai'
          };
        });
        return res.json(enriched);
      }
    } catch (err) {
      log('warn', 'Supabase appointments retrieval error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: a, error } = await supabase.from('appointments').select('*').eq('appointment_id', apptId).maybeSingle();
      if (error || !a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (req.user.role === 'mother' && parseInt(req.user.id, 10) !== a.mother_id) {
        return res.status(403).json({ error: 'Access denied: You cannot view another patient\'s appointment.' });
      }
      if (req.user.role === 'doctor' && req.user.id !== a.doctor_id) {
        return res.status(403).json({ error: 'Access denied: You cannot view appointments for other doctors.' });
      }

      const [{ data: doc }, { data: mother }, { data: hospitals }] = await Promise.all([
        supabase.from('doctors').select('*').eq('doctor_id', a.doctor_id).maybeSingle(),
        supabase.from('mothers').select('*').eq('mother_id', a.mother_id).maybeSingle(),
        supabase.from('hospitals').select('*')
      ]);

      const hosp = doc ? (hospitals || []).find(h => String(h.hospital_id) === String(doc.hospitalref_id)) : null;

      return res.json({
        ...a,
        doctor_name: doc ? doc.name : a.doctor_id,
        doctor_specialization: doc ? doc.specialization : '',
        doctor_contact: doc ? doc.contact_no : '',
        hospital_name: hosp ? hosp.name : 'City Hospital',
        hospital_location: hosp ? hosp.location : 'Chennai',
        mother_name: mother ? `${mother.first_name} ${mother.last_name}` : `Patient #${a.mother_id}`,
        mother_email: mother ? mother.email : ''
      });
    } catch (err) {
      log('warn', 'Supabase appointment detail error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: a, error } = await supabase.from('appointments').select('*').eq('appointment_id', apptId).maybeSingle();
      if (error || !a) {
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
      const { data: updated, error: uErr } = await supabase
        .from('appointments')
        .update({ status: 'Cancelled', notes: noteUpdate, updated_at: new Date().toISOString() })
        .eq('appointment_id', apptId)
        .select('*')
        .single();

      if (!uErr && updated) {
        log('info', 'Patient cancelled appointment', { appointmentId: apptId, motherId });
        return res.json({ success: true, message: 'Appointment cancelled successfully.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'Supabase appointment cancel failed', { error: err.message });
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

  if (supabase) {
    try {
      const [{ data: appts, error }, { data: mothers }] = await Promise.all([
        supabase.from('appointments').select('*').eq('doctor_id', doctorId).order('appointment_date', { ascending: true }),
        supabase.from('mothers').select('mother_id, first_name, last_name, email, status, current_week, age, blood_group')
      ]);

      if (!error && appts) {
        const enriched = appts.map(a => {
          const m = (mothers || []).find(mother => mother.mother_id === a.mother_id);
          return {
            ...a,
            mother_name: m ? `${m.first_name} ${m.last_name}` : `Patient #${a.mother_id}`,
            mother_email: m ? m.email : '',
            mother_status: m ? m.status : '',
            mother_week: m ? m.current_week : 0,
            mother_age: m ? m.age : null,
            mother_blood_group: m ? m.blood_group : null
          };
        });
        return res.json(enriched);
      }
    } catch (err) {
      log('warn', 'Supabase doctor appointments query error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: a, error } = await supabase.from('appointments').select('*').eq('appointment_id', apptId).maybeSingle();
      if (error || !a) {
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

      const { data: updated, error: uErr } = await supabase
        .from('appointments')
        .update({ status: 'Scheduled', updated_at: new Date().toISOString() })
        .eq('appointment_id', apptId)
        .select('*')
        .single();

      if (!uErr && updated) {
        log('info', 'Doctor confirmed appointment', { appointmentId: apptId, doctorId });
        return res.json({ success: true, message: 'Appointment confirmed successfully.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'Supabase doctor confirm error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: a, error } = await supabase.from('appointments').select('*').eq('appointment_id', apptId).maybeSingle();
      if (error || !a) {
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
      const { data: updated, error: uErr } = await supabase
        .from('appointments')
        .update({ status: 'Rejected', notes: noteUpdate, updated_at: new Date().toISOString() })
        .eq('appointment_id', apptId)
        .select('*')
        .single();

      if (!uErr && updated) {
        log('info', 'Doctor rejected appointment', { appointmentId: apptId, doctorId });
        return res.json({ success: true, message: 'Appointment declined.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'Supabase doctor reject error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: a, error } = await supabase.from('appointments').select('*').eq('appointment_id', apptId).maybeSingle();
      if (error || !a) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }

      if (a.doctor_id !== doctorId) {
        return res.status(403).json({ error: 'Access denied: You can only reschedule appointments assigned to you.' });
      }

      if (a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'Rejected') {
        return res.status(400).json({ error: `Cannot reschedule an appointment with status '${a.status}'.` });
      }

      // Check doctor availability on new date & slot (excluding this appointment)
      const { data: conflict } = await supabase
        .from('appointments')
        .select('appointment_id')
        .eq('doctor_id', doctorId)
        .eq('appointment_date', appointmentDate)
        .eq('appointment_time', appointmentTime)
        .neq('appointment_id', apptId)
        .not('status', 'in', '("Cancelled","Rejected")')
        .maybeSingle();

      if (conflict) {
        return res.status(409).json({ error: 'This time slot is already booked on the proposed date.' });
      }

      const noteText = notes ? `Rescheduled by doctor: ${notes}` : 'Rescheduled by doctor to new time slot';
      const { data: updated, error: uErr } = await supabase
        .from('appointments')
        .update({
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          status: 'Rescheduled',
          notes: noteText,
          updated_at: new Date().toISOString()
        })
        .eq('appointment_id', apptId)
        .select('*')
        .single();

      if (!uErr && updated) {
        log('info', 'Doctor rescheduled appointment', { appointmentId: apptId, doctorId, appointmentDate, appointmentTime });
        return res.json({ success: true, message: 'Appointment rescheduled successfully.', appointment: updated });
      }
    } catch (err) {
      log('warn', 'Supabase doctor reschedule error', { error: err.message });
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

  if (supabase) {
    try {
      const { data: mother, error: mErr } = await supabase.from('mothers').select('mother_id').eq('mother_id', targetMotherId).maybeSingle();
      if (mErr || !mother) {
        return res.status(404).json({ error: 'Patient not found.' });
      }

      const { data: conflict } = await supabase
        .from('appointments')
        .select('appointment_id')
        .eq('doctor_id', doctorId)
        .eq('appointment_date', appointmentDate)
        .eq('appointment_time', appointmentTime)
        .not('status', 'in', '("Cancelled","Rejected")')
        .maybeSingle();

      if (conflict) {
        return res.status(409).json({ error: 'You already have an appointment booked at this date and time.' });
      }

      const { data: created, error: cErr } = await supabase
        .from('appointments')
        .insert({
          mother_id: targetMotherId,
          doctor_id: doctorId,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          reason: cleanReason,
          appointment_type: cleanType,
          status: 'Scheduled',
          notes: notes || 'Scheduled by doctor during consultation'
        })
        .select('*')
        .single();

      if (!cErr && created) {
        log('info', 'Doctor scheduled follow-up appointment', { doctorId, motherId: targetMotherId, appointmentId: created.appointment_id });
        return res.status(201).json({ success: true, message: 'Follow-up appointment scheduled successfully.', appointment: created });
      }
    } catch (err) {
      log('warn', 'Supabase follow-up insert error', { error: err.message });
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
    mockFallback: ENABLE_MOCK_FALLBACK
  });
});

function gracefulShutdown(signal) {
  log('info', `Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    log('info', 'HTTP server closed.');
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
