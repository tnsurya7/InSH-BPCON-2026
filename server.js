import express from 'express';
import pg from 'pg';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

app.use(express.json());
app.use(cookieParser());

const hasDatabase = Boolean(process.env.DATABASE_URL);
const pool = hasDatabase
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : null;

// Dynamic configuration from environment variables (Zero hardcoding - Pure process.env)
const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_ADMIN_EMAIL_2 = (process.env.ADMIN_EMAIL_2 || '').toLowerCase().trim();
const DEFAULT_ADMIN_PASSWORD_2 = process.env.ADMIN_PASSWORD_2 || '';
const DEFAULT_STAFF_EMAIL = (process.env.STAFF_EMAIL || '').toLowerCase().trim();
const DEFAULT_STAFF_PASSWORD = process.env.STAFF_PASSWORD || '';
const DEFAULT_SCANNER_EMAIL = (process.env.SCANNER_EMAIL || '').toLowerCase().trim();
const DEFAULT_SCANNER_PASSWORD = process.env.SCANNER_PASSWORD || '';

// ──────────────────────────── IN-MEMORY FALLBACK STORE ────────────────────────────
const defaultMockStore = {
  users: [
    ...(DEFAULT_ADMIN_EMAIL && DEFAULT_ADMIN_PASSWORD
      ? [{ id: '00000000-0000-0000-0000-000000000001', email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD }]
      : []),
    ...(DEFAULT_ADMIN_EMAIL_2 && DEFAULT_ADMIN_PASSWORD_2
      ? [{ id: '00000000-0000-0000-0000-000000000002', email: DEFAULT_ADMIN_EMAIL_2, password: DEFAULT_ADMIN_PASSWORD_2 }]
      : []),
    ...(DEFAULT_STAFF_EMAIL && DEFAULT_STAFF_PASSWORD
      ? [{ id: '00000000-0000-0000-0000-000000000003', email: DEFAULT_STAFF_EMAIL, password: DEFAULT_STAFF_PASSWORD }]
      : []),
    ...(DEFAULT_SCANNER_EMAIL && DEFAULT_SCANNER_PASSWORD
      ? [{ id: '00000000-0000-0000-0000-000000000004', email: DEFAULT_SCANNER_EMAIL, password: DEFAULT_SCANNER_PASSWORD }]
      : []),
  ],
  staff_profiles: [
    ...(DEFAULT_ADMIN_EMAIL
      ? [{ id: '00000000-0000-0000-0000-000000000001', name: 'System Administrator', role: 'admin', active: true, email: DEFAULT_ADMIN_EMAIL, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
      : []),
    ...(DEFAULT_ADMIN_EMAIL_2
      ? [{ id: '00000000-0000-0000-0000-000000000002', name: 'Admin', role: 'admin', active: true, email: DEFAULT_ADMIN_EMAIL_2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
      : []),
    ...(DEFAULT_STAFF_EMAIL
      ? [{ id: '00000000-0000-0000-0000-000000000003', name: 'Conference Staff', role: 'staff', active: true, email: DEFAULT_STAFF_EMAIL, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
      : []),
    ...(DEFAULT_SCANNER_EMAIL
      ? [{ id: '00000000-0000-0000-0000-000000000004', name: 'Scanner Operator', role: 'scanner', active: true, email: DEFAULT_SCANNER_EMAIL, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
      : []),
  ],
  registration_counters: [
    {
      counter_key: 'faculty_counter',
      display_name: 'Faculty',
      prefix: 'PMCON26',
      start_value: 150,
      next_value: 150,
      padding: 4,
      last_used_value: null,
    },
    {
      counter_key: 'delegate_counter',
      display_name: 'Delegates',
      prefix: 'PMCON26',
      start_value: 350,
      next_value: 350,
      padding: 4,
      last_used_value: null,
    },
    {
      counter_key: 'student_counter',
      display_name: 'Post & Under Graduates',
      prefix: 'PMCON26',
      start_value: 850,
      next_value: 850,
      padding: 4,
      last_used_value: null,
    },
    {
      counter_key: 'exhibitor_counter',
      display_name: 'Exhibitors',
      prefix: 'PMCON26',
      start_value: 1001,
      next_value: 1001,
      padding: 4,
      last_used_value: null,
    },
    {
      counter_key: 'pmcon_counter',
      display_name: 'General / No Category',
      prefix: 'PMCON26',
      start_value: 2001,
      next_value: 2005,
      padding: 4,
      last_used_value: 2004,
    },
  ],
  attendees: [],
  application_settings: [
    { key: 'conference_name', value: 'InSH-BPCON 2026' },
    { key: 'conference_year', value: 2026 },
    { key: 'venue', value: 'Chennai' },
    { key: 'conference_dates', value: 'TBD' },
    {
      key: 'badge_layout',
      value: {
        registration: { top: 2.28, left: 0.25, width: 3.5, fontSize: 0.2, color: '#cf252b' },
        qr: { top: 2.65, left: 1.275, size: 1.45 },
        name: { top: 4.2, left: 0.25, width: 3.5, fontSize: 0.25, color: '#17251f' },
      },
    },
  ],
  audit_events: [],
  scan_logs: [],
  scan_events: [],
  badge_print_events: [],
  import_batches: [],
};

const mockStore = JSON.parse(JSON.stringify(defaultMockStore));

// Database auto-initializer
let isDbInitialized = false;
async function ensureDatabaseReady() {
  if (!pool || isDbInitialized) return;
  try {
    const client = await pool.connect();
    try {
      // Ensure seed users from env exist with hashed passwords
      const seedUsers = [
        { email: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASSWORD, name: 'Surya (System Administrator)', role: 'admin' },
        { email: DEFAULT_ADMIN_EMAIL_2, password: DEFAULT_ADMIN_PASSWORD_2, name: 'Mukesh (Admin)', role: 'admin' },
        { email: DEFAULT_STAFF_EMAIL, password: DEFAULT_STAFF_PASSWORD, name: 'Conference Staff', role: 'staff' },
        { email: DEFAULT_SCANNER_EMAIL, password: DEFAULT_SCANNER_PASSWORD, name: 'Scanner Operator', role: 'scanner' },
      ];

      for (const u of seedUsers) {
        if (!u.email || !u.password) continue;
        const exist = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = $1', [u.email.toLowerCase()]);
        let userId;
        const hash = bcrypt.hashSync(u.password, 10);
        if (exist.rows.length === 0) {
          const ins = await client.query('INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id', [u.email.toLowerCase(), hash]);
          userId = ins.rows[0].id;
        } else {
          userId = exist.rows[0].id;
          await client.query('UPDATE auth.users SET password_hash = $1 WHERE id = $2', [hash, userId]);
        }
        await client.query(`
          INSERT INTO public.staff_profiles (id, name, role, active, email)
          VALUES ($1, $2, $3, true, $4)
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, active = true, email = EXCLUDED.email
        `, [userId, u.name, u.role, u.email.toLowerCase()]);
      }

      // Ensure active sessions table exists in Neon DB
      await client.query(`
        CREATE TABLE IF NOT EXISTS auth.sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          token text UNIQUE NOT NULL,
          created_at timestamptz DEFAULT now(),
          expires_at timestamptz NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth.sessions(token);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth.sessions(user_id);
      `);

      isDbInitialized = true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Database ready check warning:', err.message);
  }
}

if (pool) {
  ensureDatabaseReady();
}

// ──────────────────────────── AUTHENTICATION MIDDLEWARE ────────────────────────────
const authenticateUser = async (req, res, next) => {
  let token = req.cookies?.sb_session;
  const authHeader = req.headers?.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (token && token !== 'undefined' && token !== 'null') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (pool) {
        // Verify active session against Neon DB
        const sessRes = await pool.query(
          'SELECT user_id FROM auth.sessions WHERE token = $1 AND expires_at > now()',
          [token]
        );
        if (sessRes.rows.length > 0) {
          req.user = decoded;
          req.token = token;
          return next();
        } else {
          // Token is revoked, deleted in Neon DB on sign-out, or expired
          req.user = null;
          req.token = null;
          return next();
        }
      } else {
        req.user = decoded;
        req.token = token;
        return next();
      }
    } catch {
      // token expired or invalid
      req.user = null;
      req.token = null;
    }
  }

  next();
};

app.use(authenticateUser);

// Database transaction execution runner helper
async function executeQueryInTransaction(userId, sql, params = []) {
  if (!pool) throw new Error('Database connection not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) {
      await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    }
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Helper: Mock Query Processor (Fallback when no DB is configured)
function executeMockQuery({ table, method, columns, filters, orderBy, limit, offset, data, countOption }) {
  const storeTable = mockStore[table] || [];

  if (method === 'select') {
    let rows = [...storeTable];
    if (filters && filters.length > 0) {
      for (const f of filters) {
        if (f.type === 'eq') rows = rows.filter((r) => r[f.column] === f.value);
        else if (f.type === 'neq') rows = rows.filter((r) => r[f.column] !== f.value);
        else if (f.type === 'ilike') {
          const needle = String(f.value).replace(/%/g, '').toLowerCase();
          rows = rows.filter((r) => String(r[f.column] || '').toLowerCase().includes(needle));
        } else if (f.type === 'in') {
          rows = rows.filter((r) => Array.isArray(f.value) && f.value.includes(r[f.column]));
        }
      }
    }
    const totalCount = rows.length;
    if (orderBy) {
      rows.sort((a, b) => {
        const valA = a[orderBy.column];
        const valB = b[orderBy.column];
        if (valA === valB) return 0;
        if (valA > valB) return orderBy.ascending ? 1 : -1;
        return orderBy.ascending ? -1 : 1;
      });
    }
    if (offset !== undefined) rows = rows.slice(offset);
    if (limit !== undefined) rows = rows.slice(0, limit);
    return { data: rows, count: countOption === 'exact' ? totalCount : null };
  }

  if (method === 'upsert' || method === 'insert') {
    const isArray = Array.isArray(data);
    const toInsert = (isArray ? data : [data]).map((d) => ({
      id: d.id || crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...d,
    }));
    storeTable.push(...toInsert);
    return { data: toInsert, count: toInsert.length };
  }

  if (method === 'update') {
    return { data: [data], count: 1 };
  }

  if (method === 'delete') {
    let deleted = [];
    if (filters && filters.length > 0) {
      const remaining = [];
      for (const row of storeTable) {
        let match = true;
        for (const f of filters) {
          if (f.type === 'eq' && row[f.column] !== f.value) match = false;
          if (f.type === 'in' && (!Array.isArray(f.value) || !f.value.includes(row[f.column]))) match = false;
        }
        if (match) deleted.push(row);
        else remaining.push(row);
      }
      mockStore[table] = remaining;
    } else {
      deleted = [...storeTable];
      mockStore[table] = [];
    }
    return { data: deleted, count: deleted.length };
  }

  return { data: [], count: 0 };
}

// ──────────────────────────────── AUTH ROUTES ────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normEmail = (email || '').trim().toLowerCase();

  // If Neon DB is configured, authenticate against database
  if (pool) {
    try {
      const userRes = await pool.query('SELECT id, email, password_hash FROM auth.users WHERE LOWER(email) = $1', [normEmail]);
      if (userRes.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid login credentials' });
      }

      const user = userRes.rows[0];
      const valid = bcrypt.compareSync(password, user.password_hash);
      if (!valid) {
        return res.status(400).json({ error: 'Invalid login credentials' });
      }

      const profileRes = await pool.query(
        'SELECT id, name, role, active FROM public.staff_profiles WHERE id = $1',
        [user.id]
      );
      if (profileRes.rows.length === 0) {
        return res.status(403).json({ error: 'Staff profile not found' });
      }

      const profile = profileRes.rows[0];
      if (!profile.active) {
        return res.status(403).json({ error: 'Your staff account is inactive' });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

      // Save active session in Neon DB auth.sessions
      await pool.query(
        'INSERT INTO auth.sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'24 hours\')',
        [user.id, token]
      );

      res.cookie('sb_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
      });

      return res.json({
        session: {
          access_token: token,
          token_type: 'bearer',
          expires_in: 86400,
          user: { id: user.id, email: user.email },
        },
        profile,
        token,
      });
    } catch (err) {
      console.error('Database login error:', err.message);
      return res.status(500).json({ error: 'Internal server error during login' });
    }
  }

  // Fallback to mock store if no database configured
  const matchedMockUser = mockStore.users.find(
    (u) => u.email.toLowerCase() === normEmail && u.password === password
  );

  if (matchedMockUser) {
    const profile =
      mockStore.staff_profiles.find(
        (p) => p.id === matchedMockUser.id || (p.email && p.email.toLowerCase() === matchedMockUser.email.toLowerCase())
      ) || mockStore.staff_profiles[0];
    const token = jwt.sign({ id: matchedMockUser.id, email: matchedMockUser.email }, JWT_SECRET, {
      expiresIn: '24h',
    });
    res.cookie('sb_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.json({
      session: {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400,
        user: { id: matchedMockUser.id, email: matchedMockUser.email },
      },
      profile,
      token,
    });
  }

  return res.status(400).json({ error: 'Invalid login credentials' });
});

app.post('/api/auth/logout', async (req, res) => {
  let token = req.cookies?.sb_session;
  const authHeader = req.headers?.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (token && pool) {
    try {
      await pool.query('DELETE FROM auth.sessions WHERE token = $1', [token]);
    } catch (err) {
      console.error('Database logout session deletion error:', err.message);
    }
  }

  res.clearCookie('sb_session', { path: '/' });
  res.json({ success: true });
});

app.get('/api/auth/profile', async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (pool) {
    try {
      const profileRes = await pool.query(
        'SELECT id, name, role, active, created_at, updated_at FROM public.staff_profiles WHERE id = $1',
        [userId]
      );
      if (profileRes.rows.length > 0) {
        const profile = profileRes.rows[0];
        if (!profile.active) {
          return res.status(403).json({ error: 'Account inactive' });
        }
        return res.json({
          user: req.user,
          profile,
          token: req.token,
        });
      }
    } catch (err) {
      console.error('Database profile fetch error:', err.message);
    }
  } else {
    const profile = mockStore.staff_profiles.find((p) => p.id === userId);
    if (profile) {
      return res.json({
        user: req.user,
        profile,
        token: req.token,
      });
    }
  }

  return res.status(401).json({ error: 'Not authenticated' });
});

// ─────────────────────────────── QUERY API ───────────────────────────────────

app.post('/api/query', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }

  const { table, method, columns, filters, orderBy, limit, offset, data, onConflict, countOption } = req.body;

  if (!pool) {
    const result = executeMockQuery({ table, method, columns, filters, orderBy, limit, offset, data, countOption });
    return res.json(result);
  }

  let sql = '';
  const params = [];

  try {
    if (method === 'select') {
      if (countOption === 'exact') {
        sql = `SELECT ${columns || '*'}, count(*) OVER() AS total_count FROM ${table}`;
      } else {
        sql = `SELECT ${columns || '*'} FROM ${table}`;
      }
    } else if (method === 'insert') {
      const isArray = Array.isArray(data);
      const rows = isArray ? data : [data];
      if (rows.length === 0) return res.status(400).json({ error: 'No data to insert' });
      const keys = Object.keys(rows[0]);
      const rowsPlaceholder = [];
      for (const row of rows) {
        const rowPlaceholders = [];
        for (const key of keys) {
          let val = row[key];
          if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
            val = JSON.stringify(val);
          }
          params.push(val);
          rowPlaceholders.push(`$${params.length}`);
        }
        rowsPlaceholder.push(`(${rowPlaceholders.join(', ')})`);
      }
      sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${rowsPlaceholder.join(', ')} RETURNING *`;
    } else if (method === 'update') {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sets = keys.map((k, i) => `${k} = $${params.length + i + 1}`);
      const serializedValues = values.map((val) => {
        if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
          return JSON.stringify(val);
        }
        return val;
      });
      params.push(...serializedValues);
      sql = `UPDATE ${table} SET ${sets.join(', ')}`;
    } else if (method === 'upsert') {
      const isArray = Array.isArray(data);
      const rows = isArray ? data : [data];
      if (rows.length === 0) return res.status(400).json({ error: 'No data to upsert' });
      const keys = Object.keys(rows[0]);
      const conflictKey = onConflict || (keys.includes('key') ? 'key' : 'id');
      const updateSets = keys.filter((k) => k !== conflictKey).map((k) => `${k} = EXCLUDED.${k}`);
      const rowsPlaceholder = [];
      for (const row of rows) {
        const rowPlaceholders = [];
        for (const key of keys) {
          let val = row[key];
          if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
            val = JSON.stringify(val);
          }
          params.push(val);
          rowPlaceholders.push(`$${params.length}`);
        }
        rowsPlaceholder.push(`(${rowPlaceholders.join(', ')})`);
      }
      const updateClause = updateSets.length > 0 ? `DO UPDATE SET ${updateSets.join(', ')}` : 'DO NOTHING';
      sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${rowsPlaceholder.join(', ')} ON CONFLICT (${conflictKey}) ${updateClause} RETURNING *`;
    } else if (method === 'delete') {
      if (table === 'attendees') {
        try {
          if (filters && filters.length > 0) {
            for (const f of filters) {
              if (f.type === 'eq' && f.column === 'id') {
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_logs WHERE attendee_id = $1`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_events WHERE attendee_id = $1`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.badge_print_events WHERE attendee_id = $1`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.spot_registration_keys WHERE attendee_id = $1`, [f.value]);
              } else if (f.type === 'in' && f.column === 'id') {
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_logs WHERE attendee_id = ANY($1)`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_events WHERE attendee_id = ANY($1)`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.badge_print_events WHERE attendee_id = ANY($1)`, [f.value]);
                await executeQueryInTransaction(req.user.id, `DELETE FROM public.spot_registration_keys WHERE attendee_id = ANY($1)`, [f.value]);
              }
            }
          } else {
            await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_logs`);
            await executeQueryInTransaction(req.user.id, `DELETE FROM public.scan_events`);
            await executeQueryInTransaction(req.user.id, `DELETE FROM public.badge_print_events`);
            await executeQueryInTransaction(req.user.id, `DELETE FROM public.spot_registration_keys`);
          }
        } catch (e) {}
      }
      sql = `DELETE FROM ${table}`;
    } else {
      return res.status(400).json({ error: `Unsupported method ${method}` });
    }

    if (filters && filters.length > 0) {
      const filterSQLs = [];
      for (const f of filters) {
        if (f.type === 'eq') {
          if (f.value === null) {
            filterSQLs.push(`${f.column} IS NULL`);
          } else {
            params.push(f.value);
            filterSQLs.push(`${f.column} = $${params.length}`);
          }
        } else if (f.type === 'neq') {
          if (f.value === null) {
            filterSQLs.push(`${f.column} IS NOT NULL`);
          } else {
            params.push(f.value);
            filterSQLs.push(`${f.column} <> $${params.length}`);
          }
        } else if (f.type === 'ilike') {
          params.push(f.value);
          filterSQLs.push(`${f.column} ILIKE $${params.length}`);
        } else if (f.type === 'in') {
          params.push(f.value);
          filterSQLs.push(`${f.column} = ANY($${params.length})`);
        } else if (f.type === 'gte') {
          params.push(f.value);
          filterSQLs.push(`${f.column} >= $${params.length}`);
        } else if (f.type === 'lte') {
          params.push(f.value);
          filterSQLs.push(`${f.column} <= $${params.length}`);
        } else if (f.type === 'or') {
          const parts = (f.value || '').split(',');
          const orSQLs = [];
          for (const part of parts) {
            const match = part.match(/^([^.]+)\.([^.]+)\.(.+)$/);
            if (match) {
              const [_, col, op, val] = match;
              params.push(val);
              if (op === 'ilike') orSQLs.push(`${col} ILIKE $${params.length}`);
              else if (op === 'eq') orSQLs.push(`${col} = $${params.length}`);
            }
          }
          if (orSQLs.length > 0) {
            filterSQLs.push(`(${orSQLs.join(' OR ')})`);
          }
        }
      }
      sql += ` WHERE ${filterSQLs.join(' AND ')}`;
    }

    if (method === 'update') {
      sql += ' RETURNING *';
    }

    if (orderBy) {
      sql += ` ORDER BY ${orderBy.column} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
    }
    if (limit !== undefined) {
      sql += ` LIMIT ${limit}`;
    }
    if (offset !== undefined) {
      sql += ` OFFSET ${offset}`;
    }

    const result = await executeQueryInTransaction(req.user.id, sql, params);

    let count = null;
    let dataResult = result.rows;

    if (countOption === 'exact' && result.rows.length > 0) {
      count = parseInt(result.rows[0].total_count, 10);
      dataResult = result.rows.map((r) => {
        const { total_count, ...rest } = r;
        return rest;
      });
    } else if (countOption === 'exact' && result.rows.length === 0) {
      count = 0;
    }

    res.json({
      data: method === 'delete' ? [] : dataResult,
      count: count !== null ? count : dataResult.length,
    });
  } catch (err) {
    console.error('PostgreSQL Query Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ──────────────────────────────── RPC API ───────────────────────────────────

app.post('/api/rpc', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }

  const { name, args } = req.body;

  if (!pool) {
    return res.status(500).json({ error: 'Database connection not available' });
  }

  try {
    let sql = '';
    const params = [];

    if (args) {
      const keys = Object.keys(args);
      const values = Object.values(args);
      const placeHolders = keys.map((k, i) => {
        let val = values[i];
        if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
          val = JSON.stringify(val);
        }
        params.push(val);
        return `${k} => $${params.length}`;
      });
      sql = `SELECT * FROM ${name}(${placeHolders.join(', ')})`;
    } else {
      sql = `SELECT * FROM ${name}()`;
    }

    const result = await executeQueryInTransaction(req.user.id, sql, params);

    let responseData = result.rows;
    if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1 && result.rows[0][name] !== undefined) {
      responseData = result.rows[0][name];
    }

    res.json({ data: responseData });
  } catch (err) {
    console.error(`RPC Error [${name}]:`, err.message);
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────── STAFF ADMIN ENDPOINTS ───────────────────────────

app.post('/functions/v1/staff-admin/create', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const { name, email, role, password } = req.body;
  const newUserId = crypto.randomUUID();
  const emailNorm = (email || '').toLowerCase().trim();

  if (pool) {
    try {
      const hash = bcrypt.hashSync(password || 'tempPassword123', 10);
      const uRes = await pool.query(
        'INSERT INTO auth.users (id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [newUserId, emailNorm, hash]
      );
      await pool.query(
        'INSERT INTO public.staff_profiles (id, name, role, active, email) VALUES ($1, $2, $3, true, $4)',
        [uRes.rows[0].id, name, role || 'staff', emailNorm]
      );
      return res.json({ id: newUserId, name, email: emailNorm, role, active: true });
    } catch (err) {
      console.error('Failed to create staff in Neon DB:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ id: newUserId, name, email: emailNorm, role, active: true });
});

app.put('/functions/v1/staff-admin/update/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  const { name, role, active } = req.body;

  if (pool) {
    try {
      const sets = [];
      const params = [];
      if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
      if (role !== undefined) { params.push(role); sets.push(`role = $${params.length}`); }
      if (active !== undefined) { params.push(active); sets.push(`active = $${params.length}`); }
      if (sets.length > 0) {
        params.push(targetId);
        await pool.query(`UPDATE public.staff_profiles SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
      }
      return res.json({ id: targetId, updated: { name, role, active } });
    } catch (err) {
      console.error('Failed to update staff in Neon DB:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ id: targetId, updated: { name, role, active } });
});

app.delete('/functions/v1/staff-admin/delete/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;

  if (pool) {
    try {
      await pool.query('DELETE FROM auth.users WHERE id = $1', [targetId]);
      return res.json({ success: true, deletedId: targetId });
    } catch (err) {
      console.error('Failed to delete staff in Neon DB:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ success: true, deletedId: targetId });
});

app.post('/functions/v1/staff-admin/reset/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  const newPass = 'reset_' + crypto.randomBytes(4).toString('hex');

  if (pool) {
    try {
      const hash = bcrypt.hashSync(newPass, 10);
      await pool.query('UPDATE auth.users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, targetId]);
      return res.json({ sent: true, temporaryPassword: newPass });
    } catch (err) {
      console.error('Failed to reset staff password in Neon DB:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ sent: true, temporaryPassword: newPass });
});

// Start Express server conditionally
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
}

export default app;
