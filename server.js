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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware to extract authentication
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.sb_session) {
    token = req.cookies.sb_session;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email }
  } catch (err) {
    req.user = null;
  }
  next();
};

app.use(authenticateUser);

// Database transaction execution runner helper (sets local request.jwt.claim.sub)
async function executeQueryInTransaction(userId, sql, params = []) {
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

// ──────────────────────────────── AUTH ROUTES ────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT id, email, password_hash FROM auth.users WHERE email = $1', [email.toLowerCase()]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid login credentials' });
    }

    const user = userRes.rows[0];
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid login credentials' });
    }

    // Verify staff profile
    const profileRes = await pool.query('SELECT id, name, role, active FROM public.staff_profiles WHERE id = $1', [user.id]);
    if (profileRes.rows.length === 0) {
      return res.status(403).json({ error: 'Staff profile not found' });
    }

    const profile = profileRes.rows[0];
    if (!profile.active) {
      return res.status(403).json({ error: 'Your staff account is inactive' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('sb_session', token, { httpOnly: true, secure: false });

    return res.json({
      session: {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400,
        user: { id: user.id, email: user.email }
      },
      profile
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sb_session');
  res.json({ success: true });
});

app.get('/api/auth/profile', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const profileRes = await pool.query('SELECT id, name, role, active, created_at, updated_at FROM public.staff_profiles WHERE id = $1', [req.user.id]);
    if (profileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    res.json({
      user: req.user,
      profile: profileRes.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Error fetching profile' });
  }
});

// ─────────────────────────────── QUERY API ───────────────────────────────────

app.post('/api/query', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { table, method, columns, filters, orderBy, limit, offset, data, countOption } = req.body;

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
      if (rows.length === 0) {
        return res.status(400).json({ error: 'No data to insert' });
      }
      const keys = Object.keys(rows[0]);
      const rowsPlaceholder = [];
      for (const row of rows) {
        const rowPlaceholders = [];
        for (const key of keys) {
          params.push(row[key]);
          rowPlaceholders.push(`$${params.length}`);
        }
        rowsPlaceholder.push(`(${rowPlaceholders.join(', ')})`);
      }
      sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${rowsPlaceholder.join(', ')} RETURNING *`;
    } else if (method === 'update') {
      const keys = Object.keys(data);
      const values = Object.values(data);
      const sets = keys.map((k, i) => `${k} = $${params.length + i + 1}`);
      params.push(...values);
      sql = `UPDATE ${table} SET ${sets.join(', ')}`;
    } else if (method === 'delete') {
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
              let cleanVal = val;
              // Clean leading/trailing % if it has one (like %debouncedSearch%)
              if (cleanVal.startsWith('%') && cleanVal.endsWith('%')) {
                // it is already formatted for ilike
              }
              if (op === 'ilike') {
                params.push(cleanVal);
                orSQLs.push(`${col} ILIKE $${params.length}`);
              } else if (op === 'eq') {
                params.push(cleanVal);
                orSQLs.push(`${col} = $${params.length}`);
              }
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
    if (countOption === 'exact' && method === 'select') {
      if (result.rows.length > 0 && result.rows[0].total_count !== undefined) {
        count = parseInt(result.rows[0].total_count, 10);
        for (const row of result.rows) {
          delete row.total_count;
        }
      } else {
        count = 0;
      }
    }

    res.json({ data: result.rows, count });
  } catch (err) {
    console.error('SQL Query Error:', err.message, 'SQL:', sql, 'Params:', params);
    res.status(400).json({ error: err.message });
  }
});

// ───────────────────────────────── RPC API ───────────────────────────────────

app.post('/api/rpc', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { name, args } = req.body;

  try {
    let sql = '';
    const params = [];

    if (args) {
      const keys = Object.keys(args);
      const values = Object.values(args);
      const placeHolders = keys.map((k, i) => {
        params.push(values[i]);
        return `${k} => $${params.length}`;
      });
      sql = `SELECT * FROM ${name}(${placeHolders.join(', ')})`;
    } else {
      sql = `SELECT * FROM ${name}()`;
    }

    const result = await executeQueryInTransaction(req.user.id, sql, params);
    
    let responseData = result.rows;
    // Unwrap scalar / single-JSONB-object return values (like get_reports_totals returning jsonb)
    if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1 && result.rows[0][name] !== undefined) {
      responseData = result.rows[0][name];
    }
    
    res.json({ data: responseData });
  } catch (err) {
    console.error('RPC Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ────────────────────────── EDGE FUNCTION MOCK ───────────────────────────────

app.post('/functions/v1/staff-admin/create', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, email, role, password } = req.body;

  try {
    // Verify caller role
    const callerRes = await pool.query('SELECT role, active FROM public.staff_profiles WHERE id = $1', [req.user.id]);
    if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin' || !callerRes.rows[0].active) {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    const newUserId = crypto.randomUUID();
    const tempPassword = password || 'tempPassword123';
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(tempPassword, salt);

    await executeQueryInTransaction(req.user.id, `
      INSERT INTO auth.users (id, email, password_hash)
      VALUES ($1, $2, $3)
    `, [newUserId, email.toLowerCase(), passwordHash]);

    await executeQueryInTransaction(req.user.id, `
      INSERT INTO public.staff_profiles (id, name, role, active)
      VALUES ($1, $2, $3, true)
    `, [newUserId, name, role]);

    await executeQueryInTransaction(req.user.id, `
      INSERT INTO public.audit_events (actor_id, action, target_type, target_id, details)
      VALUES ($1, 'staff_created', 'staff', $2, $3)
    `, [req.user.id, newUserId, JSON.stringify({ name, email, role, active: true })]);

    res.json({ id: newUserId, name, email, role, active: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/functions/v1/staff-admin/update/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  const { name, role, active } = req.body;

  try {
    // Verify caller role
    const callerRes = await pool.query('SELECT role, active FROM public.staff_profiles WHERE id = $1', [req.user.id]);
    if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin' || !callerRes.rows[0].active) {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    const currentRes = await pool.query('SELECT id, name, role, active FROM public.staff_profiles WHERE id = $1', [targetId]);
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const current = currentRes.rows[0];

    const patch = {};
    if (name !== undefined) patch.name = name;
    if (role !== undefined) patch.role = role;
    if (active !== undefined) patch.active = active;

    const keys = Object.keys(patch);
    if (keys.length > 0) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      const vals = keys.map(k => patch[k]);
      await executeQueryInTransaction(req.user.id, `
        UPDATE public.staff_profiles
        SET ${sets.join(', ')}
        WHERE id = $1
      `, [targetId, ...vals]);
    }

    let auditAction = 'staff_updated';
    if (role !== undefined && role !== current.role) auditAction = 'staff_role_changed';
    else if (active === true && !current.active) auditAction = 'staff_activated';
    else if (active === false && current.active) auditAction = 'staff_deactivated';

    await executeQueryInTransaction(req.user.id, `
      INSERT INTO public.audit_events (actor_id, action, target_type, target_id, details)
      VALUES ($1, $2, 'staff', $3, $4)
    `, [req.user.id, auditAction, targetId, JSON.stringify(patch)]);

    res.json({ id: targetId, updated: patch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/functions/v1/staff-admin/reset/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;

  try {
    // Verify caller role
    const callerRes = await pool.query('SELECT role, active FROM public.staff_profiles WHERE id = $1', [req.user.id]);
    if (callerRes.rows.length === 0 || callerRes.rows[0].role !== 'admin' || !callerRes.rows[0].active) {
      return res.status(403).json({ error: 'Administrator access required' });
    }

    const uRes = await pool.query('SELECT email FROM auth.users WHERE id = $1', [targetId]);
    if (uRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    // Simulate reset by generating new random password
    const newPass = 'reset_' + crypto.randomBytes(4).toString('hex');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPass, salt);

    await executeQueryInTransaction(req.user.id, `
      UPDATE auth.users SET password_hash = $2 WHERE id = $1
    `, [targetId, passwordHash]);

    await executeQueryInTransaction(req.user.id, `
      INSERT INTO public.audit_events (actor_id, action, target_type, target_id, details)
      VALUES ($1, 'staff_password_reset_sent', 'staff', $2, $3)
    `, [req.user.id, targetId, JSON.stringify({ email: uRes.rows[0].email, newTempPassword: newPass })]);

    console.log(`Password reset for ${uRes.rows[0].email}: temporary password is ${newPass}`);

    res.json({ sent: true, temporaryPassword: newPass });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express server conditionally (skip when running as serverless function on Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
}

export default app;
