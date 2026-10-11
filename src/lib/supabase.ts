function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = (currentSession as any)?.access_token;
    if (token && token !== 'mock-token' && token !== 'undefined') {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

// Custom chainable client builder that translates Supabase JS queries to Express API requests
class SupabaseQueryBuilder {
  private table: string;
  private method: string = 'select';
  private columns: string = '*';
  private filters: { type: string; column?: string; value: unknown }[] = [];
  private orderByObj: { column: string; ascending: boolean } | null = null;
  private limitVal: number | undefined;
  private offsetVal: number | undefined;
  private dataVal: unknown = null;
  private isSingle: boolean = false;
  private countOption: string | undefined = undefined;

  constructor(table: string) {
    this.table = table;
  }

  select(columns: string = '*', options?: { count?: string }) {
    this.columns = columns;
    this.method = 'select';
    this.countOption = options?.count;
    return this;
  }

  insert(data: unknown) {
    this.dataVal = data;
    this.method = 'insert';
    return this;
  }

  upsert(data: unknown, _options?: { onConflict?: string }) {
    this.dataVal = data;
    this.method = 'insert';
    return this;
  }

  update(data: unknown) {
    this.dataVal = data;
    this.method = 'update';
    return this;
  }

  delete() {
    this.method = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: 'neq', column, value });
    return this;
  }

  ilike(column: string, value: unknown) {
    this.filters.push({ type: 'ilike', column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: 'in', column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: 'gte', column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ type: 'lte', column, value });
    return this;
  }

  or(filtersStr: string) {
    this.filters.push({ type: 'or', value: filtersStr });
    return this;
  }

  order(column: string, { ascending = true } = {}) {
    this.orderByObj = { column, ascending };
    return this;
  }

  limit(limit: number) {
    this.limitVal = limit;
    return this;
  }

  range(from: number, to: number) {
    this.limitVal = to - from + 1;
    this.offsetVal = from;
    return this;
  }

  maybeSingle() {
    this.isSingle = true;
    return this;
  }

  single() {
    this.isSingle = true;
    return this;
  }

  async then(onfulfilled?: (value: { data: any; error: { message: string } | null; count?: number | null }) => any) {
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          table: this.table,
          method: this.method,
          columns: this.columns,
          filters: this.filters,
          orderBy: this.orderByObj,
          limit: this.limitVal,
          offset: this.offsetVal,
          data: this.dataVal,
          countOption: this.countOption
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Query failed');
      }

      const { data, count } = await response.json();
      let result = data;
      if (this.isSingle) {
        result = data && data.length > 0 ? data[0] : null;
      }
      const val = { data: result, error: null, count: count !== undefined ? count : null };
      if (onfulfilled) return onfulfilled(val);
      return val;
    } catch (err: unknown) {
      const val = { data: null, error: { message: err instanceof Error ? err.message : 'Unknown query error' }, count: null };
      if (onfulfilled) return onfulfilled(val);
      return val;
    }
  }
}

class SupabaseRpcBuilder {
  private name: string;
  private args: unknown;

  constructor(name: string, args?: unknown) {
    this.name = name;
    this.args = args;
  }

  async then(onfulfilled?: (value: { data: unknown; error: { message: string } | null }) => void) {
    try {
      const response = await fetch('/api/rpc', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          name: this.name,
          args: this.args
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'RPC failed');
      }

      const { data } = await response.json();
      const val = { data, error: null };
      if (onfulfilled) return onfulfilled(val);
      return val;
    } catch (err: unknown) {
      const val = { data: null, error: { message: err instanceof Error ? err.message : 'Unknown RPC error' } };
      if (onfulfilled) return onfulfilled(val);
      return val;
    }
  }
}

const authCallbacks: ((event: string, session: unknown) => void)[] = [];
const triggerAuthChange = (event: string, session: unknown) => {
  authCallbacks.forEach(cb => cb(event, session));
};

let currentSession: unknown = null;

const mockAuth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        const err = await response.json();
        return { data: { session: null, user: null }, error: { message: err.error || 'Login failed' } };
      }
      const data = await response.json();
      currentSession = data.session;
      triggerAuthChange('SIGNED_IN', currentSession);
      return { data, error: null };
    } catch (err: unknown) {
      return { data: { session: null, user: null }, error: { message: err instanceof Error ? err.message : 'Login failed' } };
    }
  },

  async signOut() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include'
      });
    } catch {}
    currentSession = null;
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    triggerAuthChange('SIGNED_OUT', null);
    return { error: null };
  },

  async getSession() {
    if (currentSession) {
      return { data: { session: currentSession }, error: null };
    }
    try {
      const response = await fetch('/api/auth/profile', {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        currentSession = null;
        return { data: { session: null }, error: null };
      }
      const data = await response.json();
      const token = (data as any)?.token || '';
      currentSession = {
        access_token: token,
        user: data.user
      };
      return { data: { session: currentSession }, error: null };
    } catch {
      currentSession = null;
      return { data: { session: null }, error: null };
    }
  },

  async getUser() {
    const { data: { session } } = await this.getSession() as { data: { session: { user: unknown } | null } };
    return { data: { user: session ? session.user : null }, error: null };
  },

  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    authCallbacks.push(callback);
    this.getSession().then(({ data: { session } }) => {
      callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
    });
    return {
      data: {
        subscription: {
          unsubscribe() {
            const idx = authCallbacks.indexOf(callback);
            if (idx !== -1) authCallbacks.splice(idx, 1);
          }
        }
      }
    };
  }
};

export const supabase = {
  from(table: string) {
    return new SupabaseQueryBuilder(table);
  },
  rpc(name: string, args?: unknown) {
    return new SupabaseRpcBuilder(name, args);
  },
  auth: mockAuth
};

export const CATEGORIES = [
  'Delegates',
  'Faculty',
  'Post Graduates',
  'Under Graduates',
  'Exhibitors',
] as const;

export const FOOD_PREFERENCES = [
  'Vegetarian',
  'Non-Vegetarian',
  'Not Specified',
] as const;

export const GENDER_OPTIONS = [
  'Male',
  'Female',
  'Other',
  'Prefer not to say',
] as const;

export const REGISTRATION_TYPES = ['pre_registered', 'spot'] as const;

export const ATTENDANCE_STATUSES = [
  'not_checked_in',
  'checked_in',
  'checked_out',
] as const;

export const PAYMENT_STATUSES = ['Paid', 'Pending', 'Complimentary'] as const;

export const CATEGORY_COUNTER_KEYS = {
  Faculty: 'faculty_counter',
  Delegates: 'delegate_counter',
  'Post Graduates': 'student_counter',
  'Under Graduates': 'student_counter',
  Exhibitors: 'exhibitor_counter',
} as const;

export type StaffRole = 'admin' | 'registration' | 'scanner' | 'staff';

export type DashboardTotals = {
  total_attendees: number;
  checked_in: number;
  checked_out: number;
  not_checked_in: number;
  spot: number;
  pre_registered: number;
};

export type CounterStatus = {
  counter_key: string;
  display_name: string;
  prefix: string;
  start_value: number | null;
  next_value: number | null;
  last_used_value: number | null;
  highest_used_in_db: number;
  configured: boolean;
};

export type SpotRegistrationResult = {
  registration_number: string;
  qr_token: string;
  attendee_id: string;
};

export type StaffProfile = {
  id: string;
  name: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Attendee = {
  id: string;
  registration_number: string;
  name: string;
  category: string;
  phone_number: string | null;
  email: string | null;
  gender: string | null;
  medical_council_number?: string | null;
  food_preference: string;
  payment_status: string;
  registration_type: string;
  qr_token: string;
  import_batch_id: string | null;
  attendance_status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ScanEvent = {
  id: string;
  attendee_id: string;
  action: 'check_in' | 'check_out';
  scanned_at: string;
  staff_id: string;
  device_info: string | null;
  session_id: string | null;
};

export type BadgePrintEvent = {
  id: string;
  attendee_id: string;
  print_type:
    | 'single'
    | 'reprint'
    | 'batch'
    | 'group_25'
    | 'group_50'
    | 'selected';
  reason: string | null;
  staff_id: string;
  printed_at: string;
  device_info: string | null;
};

export type ImportBatch = {
  id: string;
  file_name: string;
  row_count: number;
  imported_count: number;
  rejected_count: number;
  rejection_summary: Record<string, number> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type ApplicationSetting = {
  key: string;
  value: unknown;
  updated_at: string;
  updated_by: string | null;
};

export type ReportTotals = {
  total_attendees: number;
  pre_registered: number;
  spot: number;
  checked_in: number;
  checked_out: number;
  not_checked_in: number;
  by_category: Record<string, number>;
  by_food: Record<string, number>;
  by_payment: Record<string, number>;
  badge_prints: number;
  check_ins: number;
  check_outs: number;
};

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
};

export type AuditLogEntry = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
};
