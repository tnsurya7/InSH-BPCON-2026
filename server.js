import express from 'express';
import pg from 'pg';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

app.use(express.json());
app.use(cookieParser());

const hasDatabase = Boolean(process.env.DATABASE_URL);
const pool = hasDatabase
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

const MOCK_DATA_FILE = path.join(process.cwd(), 'mock_data.json');

// ──────────────────────────── IN-MEMORY MOCK STORE ────────────────────────────
const defaultMockStore = {
  users: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@gmail.com',
      password: 'admin@123',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      email: 'conf',
      password: 'acess123',
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      email: 'mukesh@gmail.com',
      password: 'mukesh123',
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      email: 'surya@gmail.com',
      password: 'surya123',
    },
    {
      id: '00000000-0000-0000-0000-000000000005',
      email: 'staff@gmail.com',
      password: 'staff123',
    },
  ],
  staff_profiles: [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'System Administrator',
      role: 'admin',
      active: true,
      email: 'admin@gmail.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Conference Admin',
      role: 'admin',
      active: true,
      email: 'conf',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Mukesh (Admin)',
      role: 'admin',
      active: true,
      email: 'mukesh@gmail.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Surya (Admin)',
      role: 'admin',
      active: true,
      email: 'surya@gmail.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'Staff Member',
      role: 'staff',
      active: true,
      email: 'staff@gmail.com',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  registration_counters: [
    {
      counter_key: 'faculty_counter',
      display_name: 'Faculty',
      prefix: 'FAC',
      start_value: 1001,
      next_value: 1005,
      padding: 4,
      last_used_value: 1004,
    },
    {
      counter_key: 'delegate_counter',
      display_name: 'Delegates',
      prefix: 'DEL',
      start_value: 2001,
      next_value: 2007,
      padding: 4,
      last_used_value: 2006,
    },
    {
      counter_key: 'student_counter',
      display_name: 'Post & Under Graduates',
      prefix: 'STU',
      start_value: 3001,
      next_value: 3004,
      padding: 4,
      last_used_value: 3003,
    },
    {
      counter_key: 'exhibitor_counter',
      display_name: 'Exhibitors',
      prefix: 'EXH',
      start_value: 4001,
      next_value: 4002,
      padding: 4,
      last_used_value: 4001,
    },
    {
      counter_key: 'pmcon_counter',
      display_name: 'General / No Category',
      prefix: 'PMCON',
      start_value: 2001,
      next_value: 2005,
      padding: 4,
      last_used_value: 2004,
    },
  ],
  attendees: [
    {
      id: '11111111-1111-1111-1111-111111111101',
      registration_number: 'FAC-1001',
      name: 'Dr. Ramesh Kumar',
      category: 'Faculty',
      phone_number: '9876543210',
      email: 'ramesh.kumar@example.com',
      gender: 'Male',
      food_preference: 'Vegetarian',
      payment_status: 'Paid',
      registration_type: 'pre_registered',
      qr_token: 'qr-token-fac-1001',
      attendance_status: 'checked_in',
      checked_in_at: new Date().toISOString(),
      badge_printed: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '11111111-1111-1111-1111-111111111102',
      registration_number: 'DEL-2001',
      name: 'Priya Sharma',
      category: 'Delegates',
      phone_number: '9876543211',
      email: 'priya.sharma@example.com',
      gender: 'Female',
      food_preference: 'Non-Vegetarian',
      payment_status: 'Paid',
      registration_type: 'pre_registered',
      qr_token: 'qr-token-del-2001',
      attendance_status: 'not_checked_in',
      badge_printed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '11111111-1111-1111-1111-111111111103',
      registration_number: 'STU-3001',
      name: 'Arun Patel',
      category: 'Post Graduates',
      phone_number: '9876543212',
      email: 'arun.patel@example.com',
      gender: 'Male',
      food_preference: 'Vegetarian',
      payment_status: 'Paid',
      registration_type: 'spot',
      qr_token: 'qr-token-stu-3001',
      attendance_status: 'not_checked_in',
      badge_printed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  application_settings: [
    {
      key: 'badge_layout',
      value: {
        registration: { top: 2.10, left: 0.25, width: 3.5, fontSize: 0.22, color: '#cf252b' },
        qr: { top: 2.42, left: 1.35, size: 1.30 },
        name: { top: 3.85, left: 0.25, width: 3.5, fontSize: 0.25, color: '#0f172a' },
        pageSize: {
          preset: 'A4',
          name: 'A4 Sheet (4 Badges • 2×2)',
          width_mm: 210,
          height_mm: 297,
          columns: 2,
          rows: 2,
        },
      },
      updated_at: new Date().toISOString(),
    },
  ],
  audit_events: [],
};

const mockStore = JSON.parse(JSON.stringify(defaultMockStore));

const TMP_MOCK_DATA_FILE = path.join('/tmp', 'mock_data.json');

function saveMockStoreToDisk() {
  try {
    fs.writeFileSync(MOCK_DATA_FILE, JSON.stringify(mockStore, null, 2), 'utf-8');
  } catch (err) {
    try {
      fs.writeFileSync(TMP_MOCK_DATA_FILE, JSON.stringify(mockStore, null, 2), 'utf-8');
    } catch (e) {
      // Memory fallback if disk/tmp unavailable
    }
  }
}

function loadMockStoreFromDisk() {
  try {
    let sourcePath = null;
    if (fs.existsSync(TMP_MOCK_DATA_FILE)) {
      sourcePath = TMP_MOCK_DATA_FILE;
    } else if (fs.existsSync(MOCK_DATA_FILE)) {
      sourcePath = MOCK_DATA_FILE;
    }

    if (sourcePath) {
      const data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
      for (const key of Object.keys(data)) {
        mockStore[key] = data[key];
      }
      // Ensure seed admin and staff accounts always exist
      for (const u of defaultMockStore.users) {
        if (!mockStore.users.some((existing) => existing.email.toLowerCase() === u.email.toLowerCase())) {
          mockStore.users.push(u);
        }
      }
      for (const sp of defaultMockStore.staff_profiles) {
        if (!mockStore.staff_profiles.some((existing) => existing.email.toLowerCase() === sp.email.toLowerCase())) {
          mockStore.staff_profiles.push(sp);
        }
      }
      console.log('Loaded mock store from disk:', sourcePath);
    } else {
      saveMockStoreToDisk();
    }
  } catch (err) {
    console.error('Error loading mockStore from disk:', err.message);
  }
}

loadMockStoreFromDisk();

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

// Helper: Mock Query Processor
function executeMockQuery({ table, method, columns, filters, orderBy, limit, offset, data, countOption }) {
  const storeTable = mockStore[table] || [];

  if (method === 'select') {
    let rows = [...storeTable];

    if (filters && filters.length > 0) {
      for (const f of filters) {
        if (f.type === 'eq') {
          rows = rows.filter((r) => r[f.column] === f.value);
        } else if (f.type === 'neq') {
          rows = rows.filter((r) => r[f.column] !== f.value);
        } else if (f.type === 'ilike') {
          const needle = String(f.value).replace(/%/g, '').toLowerCase();
          rows = rows.filter((r) => String(r[f.column] || '').toLowerCase().includes(needle));
        } else if (f.type === 'in') {
          rows = rows.filter((r) => Array.isArray(f.value) && f.value.includes(r[f.column]));
        } else if (f.type === 'or') {
          const parts = (f.value || '').split(',');
          rows = rows.filter((r) => {
            return parts.some((part) => {
              const match = part.match(/^([^.]+)\.([^.]+)\.(.+)$/);
              if (!match) return false;
              const [_, col, op, val] = match;
              const cleanVal = val.replace(/%/g, '').toLowerCase();
              const itemVal = String(r[col] || '').toLowerCase();
              if (op === 'ilike') return itemVal.includes(cleanVal);
              if (op === 'eq') return itemVal === cleanVal;
              return false;
            });
          });
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

    if (offset !== undefined) {
      rows = rows.slice(offset);
    }
    if (limit !== undefined) {
      rows = rows.slice(0, limit);
    }

    return { data: rows, count: countOption === 'exact' ? totalCount : null };
  }

  if (method === 'upsert') {
    const isArray = Array.isArray(data);
    const toUpsert = isArray ? data : [data];
    const results = [];
    for (const item of toUpsert) {
      const conflictKey = 'key' in item ? 'key' : 'id';
      const existingIdx = storeTable.findIndex((r) => r[conflictKey] === item[conflictKey]);
      if (existingIdx >= 0) {
        storeTable[existingIdx] = { ...storeTable[existingIdx], ...item, updated_at: new Date().toISOString() };
        results.push(storeTable[existingIdx]);
      } else {
        const newItem = {
          id: item.id || crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...item,
        };
        storeTable.push(newItem);
        results.push(newItem);
      }
    }
    saveMockStoreToDisk();
    return { data: results, count: results.length };
  }

  if (method === 'insert') {
    const isArray = Array.isArray(data);
    const toInsert = (isArray ? data : [data]).map((d) => ({
      id: d.id || crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...d,
    }));
    storeTable.push(...toInsert);
    saveMockStoreToDisk();
    return { data: toInsert, count: toInsert.length };
  }

  if (method === 'update') {
    const affected = [];
    for (let i = 0; i < storeTable.length; i++) {
      let match = true;
      if (filters && filters.length > 0) {
        for (const f of filters) {
          if (f.type === 'eq' && storeTable[i][f.column] !== f.value) match = false;
          if (f.type === 'in' && (!Array.isArray(f.value) || !f.value.includes(storeTable[i][f.column]))) match = false;
        }
      }
      if (match) {
        storeTable[i] = { ...storeTable[i], ...data, updated_at: new Date().toISOString() };
        affected.push(storeTable[i]);
      }
    }
    saveMockStoreToDisk();
    return { data: affected, count: affected.length };
  }

  if (method === 'delete') {
    const deleted = [];
    if (filters && filters.length > 0) {
      mockStore[table] = storeTable.filter((row) => {
        const match = filters.every((f) => {
          if (f.type === 'eq') return row[f.column] === f.value;
          if (f.type === 'in') return Array.isArray(f.value) && f.value.includes(row[f.column]);
          return false;
        });
        if (match) deleted.push(row);
        return !match;
      });
    }
    saveMockStoreToDisk();
    return { data: deleted, count: deleted.length };
  }

  return { data: [], count: 0 };
}

// Helper: Mock RPC Processor
function executeMockRpc(name, args = {}) {
  if (name === 'get_dashboard_totals') {
    const total = mockStore.attendees.length;
    const checked_in = mockStore.attendees.filter((a) => a.attendance_status === 'checked_in').length;
    const checked_out = mockStore.attendees.filter((a) => a.attendance_status === 'checked_out').length;
    const not_checked_in = mockStore.attendees.filter((a) => a.attendance_status === 'not_checked_in').length;
    const spot = mockStore.attendees.filter((a) => a.registration_type === 'spot').length;
    const pre_registered = mockStore.attendees.filter((a) => a.registration_type === 'pre_registered').length;
    return [{ total_attendees: total, checked_in, checked_out, not_checked_in, spot, pre_registered }];
  }

  if (name === 'get_reports_totals') {
    const total = mockStore.attendees.length;
    return {
      total_attendees: total,
      pre_registered: mockStore.attendees.filter((a) => a.registration_type === 'pre_registered').length,
      spot: mockStore.attendees.filter((a) => a.registration_type === 'spot').length,
      checked_in: mockStore.attendees.filter((a) => a.attendance_status === 'checked_in').length,
      checked_out: mockStore.attendees.filter((a) => a.attendance_status === 'checked_out').length,
      not_checked_in: mockStore.attendees.filter((a) => a.attendance_status === 'not_checked_in').length,
      by_category: {
        Faculty: mockStore.attendees.filter((a) => a.category === 'Faculty').length,
        Delegates: mockStore.attendees.filter((a) => a.category === 'Delegates').length,
        'Post Graduates': mockStore.attendees.filter((a) => a.category === 'Post Graduates').length,
        'Under Graduates': mockStore.attendees.filter((a) => a.category === 'Under Graduates').length,
        Exhibitors: mockStore.attendees.filter((a) => a.category === 'Exhibitors').length,
      },
      by_food: {
        Vegetarian: mockStore.attendees.filter((a) => a.food_preference === 'Vegetarian').length,
        'Non-Vegetarian': mockStore.attendees.filter((a) => a.food_preference === 'Non-Vegetarian').length,
        'Not Specified': mockStore.attendees.filter((a) => a.food_preference === 'Not Specified').length,
      },
      by_payment: {
        Paid: mockStore.attendees.filter((a) => a.payment_status === 'Paid').length,
        Pending: mockStore.attendees.filter((a) => a.payment_status === 'Pending').length,
        Complimentary: mockStore.attendees.filter((a) => a.payment_status === 'Complimentary').length,
      },
      badge_prints: mockStore.attendees.filter((a) => a.badge_printed).length,
      check_ins: mockStore.attendees.filter((a) => a.attendance_status === 'checked_in').length,
      check_outs: mockStore.attendees.filter((a) => a.attendance_status === 'checked_out').length,
    };
  }

  if (name === 'get_counter_statuses') {
    return mockStore.registration_counters.map((c) => ({
      ...c,
      configured: true,
      highest_used_in_db: (c.next_value || 1000) - 1,
    }));
  }

  if (name === 'lookup_attendee_by_reg_no') {
    const regNo = (args.p_reg_no || '').trim().toUpperCase();
    const att = mockStore.attendees.find(
      (a) => a.registration_number.toUpperCase() === regNo || a.qr_token === args.p_reg_no,
    );
    return att ? [att] : [];
  }

  if (name === 'process_scan' || name === 'process_scan_by_reg_no') {
    const qrToken = args.p_qr_token;
    const regNo = (args.p_registration_number || args.p_reg_no || '').trim().toUpperCase();
    const action = args.p_action || 'check_in';
    const att = mockStore.attendees.find((a) => {
      if (qrToken && (a.qr_token === qrToken || a.registration_number.toUpperCase() === qrToken.toUpperCase())) return true;
      if (regNo && (a.registration_number.toUpperCase() === regNo || a.qr_token.toUpperCase() === regNo)) return true;
      return false;
    });
    if (!att) {
      return [{
        result: 'invalid_qr',
        name: null,
        registration_number: null,
        category: null,
        attendance_status: null,
      }];
    }
    const already = (action === 'check_in' && att.attendance_status === 'checked_in') ||
                    (action === 'check_out' && att.attendance_status === 'checked_out');
    if (already) {
      return [{
        result: action === 'check_in' ? 'already_checked_in' : 'already_checked_out',
        name: att.name,
        registration_number: att.registration_number,
        category: att.category,
        attendance_status: att.attendance_status,
      }];
    }
    att.attendance_status = action === 'check_in' ? 'checked_in' : 'checked_out';
    if (action === 'check_in') att.checked_in_at = new Date().toISOString();
    else att.checked_out_at = new Date().toISOString();
    return [{
      result: action === 'check_in' ? 'success_check_in' : 'success_check_out',
      name: att.name,
      registration_number: att.registration_number,
      category: att.category,
      attendance_status: att.attendance_status,
    }];
  }

  if (name === 'create_spot_registration') {
    const { p_name, p_category, p_food_preference, p_payment_status, p_phone_number, p_email, p_gender, p_medical_council_number } = args;
    const hasCategory = Boolean(p_category && p_category.trim() && p_category !== 'No Category');
    const finalCategory = hasCategory ? p_category.trim() : 'Delegates';
    
    // Dedicated spot registration counter starting at PMCON-5001 so it never clashes with pre-registered attendees
    let counter = mockStore.registration_counters.find((c) => c.counter_key === 'spot_counter');
    if (!counter) {
      counter = {
        counter_key: 'spot_counter',
        display_name: 'Spot Registration',
        prefix: 'PMCON',
        start_value: 5001,
        next_value: 5002,
        padding: 4,
        last_used_value: 5001,
      };
      mockStore.registration_counters.push(counter);
    }
    const num = counter ? counter.next_value : 5002;
    if (counter) {
      counter.last_used_value = counter.next_value;
      counter.next_value += 1;
    }
    const regNo = `PMCON-${String(num).padStart(4, '0')}`;
    const newId = crypto.randomUUID();
    const qrToken = `qr-spot-pmcon-${num}-${Date.now()}`;
    const newAtt = {
      id: newId,
      registration_number: regNo,
      name: p_name,
      category: finalCategory,
      medical_council_number: p_medical_council_number || args.medical_council_number || null,
      food_preference: p_food_preference || 'Not Specified',
      payment_status: p_payment_status || 'Paid',
      phone_number: p_phone_number || '',
      email: p_email || '',
      gender: p_gender || 'Prefer not to say',
      registration_type: 'spot',
      qr_token: qrToken,
      attendance_status: 'not_checked_in',
      badge_printed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockStore.attendees.push(newAtt);
    saveMockStoreToDisk();
    return [{ registration_number: regNo, qr_token: qrToken, attendee_id: newId }];
  }

  if (name === 'list_staff_with_emails' || name === 'get_staff_members') {
    return mockStore.staff_profiles.map((p) => {
      const u = mockStore.users.find((user) => user.id === p.id);
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        active: p.active !== false,
        email: p.email || u?.email || '',
        created_at: p.created_at || new Date().toISOString(),
      };
    });
  }

  if (name === 'get_audit_log') {
    return mockStore.audit_events;
  }

  if (name === 'get_badge_layout_settings') {
    return mockStore.application_settings.find((s) => s.key === 'badge_layout')?.value || null;
  }

  if (name === 'save_badge_layout_settings') {
    let setting = mockStore.application_settings.find((s) => s.key === 'badge_layout');
    if (!setting) {
      setting = { key: 'badge_layout', value: args.p_layout, updated_at: new Date().toISOString() };
      mockStore.application_settings.push(setting);
    } else {
      setting.value = args.p_layout;
      setting.updated_at = new Date().toISOString();
    }
    saveMockStoreToDisk();
    return { success: true };
  }

  if (name === 'import_attendees_batch') {
    const { p_file_name, p_rows } = args;
    const batchId = crypto.randomUUID();
    const batch = {
      id: batchId,
      file_name: p_file_name || 'bulk_import',
      total_rows: (p_rows || []).length,
      imported_count: (p_rows || []).length,
      rejected_count: 0,
      created_by: null,
      created_at: new Date().toISOString(),
    };
    if (!mockStore.import_batches) mockStore.import_batches = [];
    mockStore.import_batches.unshift(batch);

    let count = 0;
    for (const r of p_rows || []) {
      const regNo = (r.registration_number || `PMCON-${2000 + mockStore.attendees.length + 1}`).trim();
      const qrToken = `qr-${regNo.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newAtt = {
        id: crypto.randomUUID(),
        registration_number: regNo,
        name: r.name,
        category: r.category || 'Delegates',
        food_preference: r.food_preference || 'Not Specified',
        payment_status: r.payment_status || 'Paid',
        phone_number: r.phone_number || null,
        email: r.email || null,
        gender: r.gender || null,
        medical_council_number: r.medical_council_number || null,
        registration_type: 'pre_registered',
        qr_token: qrToken,
        attendance_status: 'not_checked_in',
        badge_printed: false,
        import_batch_id: batchId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const existingIdx = mockStore.attendees.findIndex(
        (a) => a.registration_number.toUpperCase() === regNo.toUpperCase(),
      );
      if (existingIdx >= 0) {
        mockStore.attendees[existingIdx] = { ...mockStore.attendees[existingIdx], ...newAtt };
      } else {
        mockStore.attendees.push(newAtt);
      }
      count++;
    }
    saveMockStoreToDisk();
    return [{ batch_id: batchId, imported_count: count }];
  }

  return [];
}

// ──────────────────────────────── AUTH ROUTES ────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const normEmail = (email || '').trim().toLowerCase();

  // Mock authentication check: supports mukesh@gmail.com, surya@gmail.com, staff@gmail.com, admin@gmail.com, conf
  const matchedMockUser = mockStore.users.find(
    (u) =>
      (u.email.toLowerCase() === normEmail ||
        (u.email === 'admin@gmail.com' && (normEmail === 'admin' || normEmail === 'admin@gmail.com')) ||
        (u.email === 'conf' && (normEmail === 'conf' || normEmail === 'conf@conference.org')) ||
        (u.email === 'mukesh@gmail.com' && (normEmail === 'mukesh' || normEmail === 'mukesh@gmail.com')) ||
        (u.email === 'surya@gmail.com' && (normEmail === 'surya' || normEmail === 'surya@gmail.com')) ||
        (u.email === 'staff@gmail.com' && (normEmail === 'staff' || normEmail === 'staff@gmail.com'))) &&
      (u.password === password || (u.password === 'acess123' && password === 'access123')),
  );

  if (matchedMockUser) {
    const profile =
      mockStore.staff_profiles.find(
        (p) => p.id === matchedMockUser.id || (p.email && p.email.toLowerCase() === matchedMockUser.email.toLowerCase()),
      ) || mockStore.staff_profiles[0];
    const token = jwt.sign({ id: matchedMockUser.id, email: matchedMockUser.email }, JWT_SECRET, {
      expiresIn: '24h',
    });
    res.cookie('sb_session', token, { httpOnly: true, secure: false });

    return res.json({
      session: {
        access_token: token,
        token_type: 'bearer',
        expires_in: 86400,
        user: { id: matchedMockUser.id, email: matchedMockUser.email },
      },
      profile,
    });
  }

  // If DB pool is configured, attempt DB auth
  if (pool) {
    try {
      const userRes = await pool.query('SELECT id, email, password_hash FROM auth.users WHERE email = $1', [
        normEmail,
      ]);
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
        [user.id],
      );
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
          user: { id: user.id, email: user.email },
        },
        profile,
      });
    } catch (err) {
      console.error('Database login error:', err.message);
      return res.status(500).json({ error: 'Internal server error during login' });
    }
  }

  return res.status(400).json({ error: 'Invalid login credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sb_session');
  res.json({ success: true });
});

app.get('/api/auth/profile', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Check mock store first
  const mockProfile = mockStore.staff_profiles.find((p) => p.id === req.user.id);
  if (mockProfile) {
    return res.json({
      user: req.user,
      profile: mockProfile,
    });
  }

  if (pool) {
    try {
      const profileRes = await pool.query(
        'SELECT id, name, role, active, created_at, updated_at FROM public.staff_profiles WHERE id = $1',
        [req.user.id],
      );
      if (profileRes.rows.length === 0) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      return res.json({
        user: req.user,
        profile: profileRes.rows[0],
      });
    } catch (err) {
      console.error('Database profile error:', err.message);
    }
  }

  // Fallback to default mock admin profile
  res.json({
    user: req.user,
    profile: mockStore.staff_profiles[0],
  });
});

// ─────────────────────────────── QUERY API ───────────────────────────────────

app.post('/api/query', async (req, res) => {
  if (!req.user) {
    if (!pool) {
      req.user = {
        id: 'mock-admin-id',
        email: 'admin@gmail.com',
        user_metadata: { role: 'admin' },
        app_metadata: {},
      };
    } else {
      return res.status(401).json({ error: 'Not authenticated' });
    }
  }

  const { table, method, columns, filters, orderBy, limit, offset, data, countOption } = req.body;

  // Use mock store if no database configured
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
    } else if (method === 'upsert') {
      const isArray = Array.isArray(data);
      const rows = isArray ? data : [data];
      if (rows.length === 0) return res.status(400).json({ error: 'No data to upsert' });
      const keys = Object.keys(rows[0]);
      const conflictKey = keys.includes('key') ? 'key' : 'id';
      const updateSets = keys.filter(k => k !== conflictKey).map(k => `${k} = EXCLUDED.${k}`);
      const rowsPlaceholder = [];
      for (const row of rows) {
        const rowPlaceholders = [];
        for (const key of keys) {
          params.push(row[key]);
          rowPlaceholders.push(`$${params.length}`);
        }
        rowsPlaceholder.push(`(${rowPlaceholders.join(', ')})`);
      }
      sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${rowsPlaceholder.join(', ')} ON CONFLICT (${conflictKey}) DO UPDATE SET ${updateSets.join(', ')} RETURNING *`;
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
              if (cleanVal.startsWith('%') && cleanVal.endsWith('%')) {
                // formatted for ilike
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
    console.error('SQL Query Error (falling back to mock):', err.message);
    const fallbackResult = executeMockQuery({
      table,
      method,
      columns,
      filters,
      orderBy,
      limit,
      offset,
      data,
      countOption,
    });
    res.json(fallbackResult);
  }
});

// ───────────────────────────────── RPC API ───────────────────────────────────

app.post('/api/rpc', async (req, res) => {
  if (!req.user) {
    if (!pool) {
      const adminUser = mockStore.staff_profiles.find((p) => p.role === 'admin') || {
        id: '00000000-0000-0000-0000-000000000001',
        email: 'admin@gmail.com',
      };
      req.user = { id: adminUser.id, email: adminUser.email };
    } else {
      return res.status(401).json({ error: 'Not authenticated' });
    }
  }

  const { name, args } = req.body;

  if (!pool) {
    try {
      const mockResult = executeMockRpc(name, args);
      return res.json({ data: mockResult });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

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
    if (result.rows.length === 1 && Object.keys(result.rows[0]).length === 1 && result.rows[0][name] !== undefined) {
      responseData = result.rows[0][name];
    }

    res.json({ data: responseData });
  } catch (err) {
    console.error('RPC Error (falling back to mock):', err.message);
    try {
      const mockResult = executeMockRpc(name, args);
      return res.json({ data: mockResult });
    } catch (mockErr) {
      res.status(400).json({ error: mockErr.message });
    }
  }
});

// ────────────────────────── EDGE FUNCTION MOCK ───────────────────────────────

app.post('/functions/v1/staff-admin/create', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const { name, email, role, password } = req.body;

  const newUserId = crypto.randomUUID();
  const newStaff = {
    id: newUserId,
    name,
    email: (email || '').toLowerCase(),
    role: role || 'registration',
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  mockStore.staff_profiles.push(newStaff);
  mockStore.users.push({
    id: newUserId,
    email: newStaff.email,
    password: password || 'tempPassword123',
  });
  saveMockStoreToDisk();

  res.json({ id: newUserId, name, email, role, active: true });
});

app.put('/functions/v1/staff-admin/update/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  const { name, role, active } = req.body;

  const staff = mockStore.staff_profiles.find((s) => s.id === targetId);
  if (!staff) {
    return res.status(404).json({ error: 'Staff member not found' });
  }

  if (name !== undefined) staff.name = name;
  if (role !== undefined) staff.role = role;
  if (active !== undefined) staff.active = active;
  staff.updated_at = new Date().toISOString();
  saveMockStoreToDisk();

  res.json({ id: targetId, updated: { name, role, active } });
});

app.delete('/functions/v1/staff-admin/delete/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  mockStore.staff_profiles = mockStore.staff_profiles.filter((s) => s.id !== targetId);
  mockStore.users = mockStore.users.filter((u) => u.id !== targetId);
  saveMockStoreToDisk();

  res.json({ success: true, deletedId: targetId });
});

app.post('/functions/v1/staff-admin/reset/:id', async (req, res) => {
  if (!req.user && pool) return res.status(401).json({ error: 'Not authenticated' });
  const targetId = req.params.id;
  const newPass = 'reset_' + crypto.randomBytes(4).toString('hex');

  const user = mockStore.users.find((u) => u.id === targetId);
  if (user) {
    user.password = newPass;
    saveMockStoreToDisk();
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
