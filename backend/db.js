// =============================================================================
// Maternix — PostgreSQL Database Connection Pool & Query Helper
// File: backend/db.js
// 
// Production-grade PostgreSQL connection management for Amazon RDS
// Features: Connection pooling, parameterized queries, custom type parsing,
// SSL support, idle client error handling, and graceful shutdown.
// =============================================================================

const { Pool, types } = require('pg');

// Parse PostgreSQL DATE (OID 1082) as raw 'YYYY-MM-DD' string
// to avoid timezone drift and retain consistency across frontend APIs
types.setTypeParser(1082, (val) => val);

// Parse PostgreSQL BIGINT (OID 20) as integer if within safe integer range
types.setTypeParser(20, (val) => {
  const parsed = parseInt(val, 10);
  return Number.isSafeInteger(parsed) ? parsed : val;
});

// Parse PostgreSQL NUMERIC/DECIMAL (OID 1700) as float
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

// Determine whether database configuration has been supplied
function isDbConfigured() {
  if (process.env.DATABASE_URL) return true;
  return Boolean(process.env.DB_HOST && process.env.DB_USER);
}

// Build Pool configuration from environment variables
function buildPoolConfig() {
  const isProd = process.env.NODE_ENV === 'production';

  if (process.env.DATABASE_URL) {
    const config = {
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10)
    };

    if (process.env.DB_SSL === 'true' || isProd) {
      config.ssl = {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      };
    }
    return config;
  }

  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'maternix',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10)
  };

  // SSL configuration for Amazon RDS
  if (process.env.DB_SSL === 'true' || (isProd && process.env.DB_SSL !== 'false')) {
    config.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    };
  }

  return config;
}

let pool = null;

// Initialize connection pool if database credentials exist
if (isDbConfigured()) {
  try {
    pool = new Pool(buildPoolConfig());

    // Prevent uncaught exceptions on idle pool clients from terminating the node process
    pool.on('error', (err) => {
      console.error('[DB POOL ERROR] Unexpected error on idle PostgreSQL client:', err.message);
    });
  } catch (err) {
    console.error('[FATAL] Failed to construct PostgreSQL connection pool:', err.message);
    pool = null;
  }
}

/**
 * Executes a parameterized SQL query with the connection pool
 * @param {string} text - Parameterized SQL query string (e.g. 'SELECT * FROM mothers WHERE mother_id = $1')
 * @param {Array} [params] - Bound parameters array
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params = []) {
  if (!pool) {
    const err = new Error('Database connection pool is not initialized');
    err.code = 'POOL_NOT_INITIALIZED';
    throw err;
  }
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    // Sanitize log by avoiding parameter values that may hold passwords/PII
    console.error(`[DB ERROR] Query failed in ${Date.now() - start}ms:`, {
      message: err.message,
      code: err.code,
      query: text.replace(/\s+/g, ' ').trim().slice(0, 100)
    });
    throw err;
  }
}

/**
 * Acquires a client from the pool for transactional workflows
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  if (!pool) {
    const err = new Error('Database connection pool is not initialized');
    err.code = 'POOL_NOT_INITIALIZED';
    throw err;
  }
  return await pool.connect();
}

/**
 * Rapid database readiness probe
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  if (!pool) return false;
  try {
    const res = await pool.query('SELECT 1 AS ready FROM hospitals LIMIT 1');
    return Boolean(res && res.rows && res.rows.length >= 0);
  } catch (err) {
    return false;
  }
}

/**
 * Graceful pool shutdown
 */
async function closePool() {
  if (pool) {
    try {
      await pool.end();
      pool = null;
    } catch (err) {
      console.error('[DB SHUTDOWN ERROR] Failed to close connection pool cleanly:', err.message);
    }
  }
}

/**
 * Reset/reinitialize pool (primarily for testing or dynamic config)
 */
function setPool(customPool) {
  pool = customPool;
}

module.exports = {
  query,
  getClient,
  healthCheck,
  isDbConfigured,
  closePool,
  setPool,
  get pool() {
    return pool;
  }
};
