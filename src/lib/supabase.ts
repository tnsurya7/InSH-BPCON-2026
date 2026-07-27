import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

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

export type StaffRole = 'admin' | 'registration' | 'scanner';

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
