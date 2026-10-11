import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import pg from 'pg';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is missing.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const schemaSql = `
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Auth schema for Neon
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Active auth sessions table in Neon DB
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth.sessions(token);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth.sessions(user_id);

-- Auth UID mock function for Neon DB sessions
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Staff profiles
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'registration', 'scanner', 'staff')),
  active boolean NOT NULL DEFAULT true,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Helper function to check if active staff
CREATE OR REPLACE FUNCTION public.is_active_staff(p_role text DEFAULT NULL)
RETURNS boolean AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN true; -- fallback if not in sub context
  END IF;

  IF p_role IS NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM public.staff_profiles
      WHERE id = auth.uid() AND active = true
    );
  ELSE
    RETURN EXISTS (
      SELECT 1 FROM public.staff_profiles
      WHERE id = auth.uid() AND active = true AND (role = p_role OR role = 'admin')
    );
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Registration counters
CREATE TABLE IF NOT EXISTS public.registration_counters (
  counter_key text PRIMARY KEY,
  display_name text,
  prefix text NOT NULL,
  start_value int,
  next_value int CHECK (next_value IS NULL OR next_value >= 1),
  padding int NOT NULL DEFAULT 4,
  last_used_value int,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Import batches
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  row_count int NOT NULL DEFAULT 0,
  imported_count int NOT NULL DEFAULT 0,
  rejected_count int NOT NULL DEFAULT 0,
  rejection_summary jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Master attendees table
CREATE TABLE IF NOT EXISTS public.attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  phone_number text,
  email text,
  gender text,
  food_preference text NOT NULL DEFAULT 'Not Specified',
  payment_status text NOT NULL DEFAULT 'Paid',
  registration_type text NOT NULL DEFAULT 'pre_registered',
  qr_token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  attendance_status text NOT NULL DEFAULT 'not_checked_in' CHECK (attendance_status IN ('not_checked_in', 'checked_in', 'checked_out')),
  medical_council_number text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.attendees ADD COLUMN IF NOT EXISTS medical_council_number text;

-- Scan events (history log)
CREATE TABLE IF NOT EXISTS public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('check_in', 'check_out')),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  staff_id uuid,
  device_info text,
  session_id text
);

-- Scan logs alias table for scanner screen
CREATE TABLE IF NOT EXISTS public.scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid REFERENCES public.attendees(id) ON DELETE CASCADE,
  scanner_id uuid,
  scan_type text,
  registration_number text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  sync_status text DEFAULT 'synced'
);

-- Badge print events
CREATE TABLE IF NOT EXISTS public.badge_print_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  print_type text NOT NULL DEFAULT 'single',
  reason text,
  staff_id uuid,
  printed_at timestamptz NOT NULL DEFAULT now(),
  device_info text
);

-- Audit events
CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Application settings
CREATE TABLE IF NOT EXISTS public.application_settings (
  id uuid DEFAULT gen_random_uuid(),
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Spot registration keys (idempotency)
CREATE TABLE IF NOT EXISTS public.spot_registration_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  attendee_id uuid NOT NULL REFERENCES public.attendees(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed category counters
INSERT INTO public.registration_counters (counter_key, display_name, prefix, next_value, padding, start_value, last_used_value)
VALUES
  ('faculty_counter', 'Faculty', 'PMCON26', 150, 4, 150, NULL),
  ('delegate_counter', 'Delegates', 'PMCON26', 350, 4, 350, NULL),
  ('student_counter', 'Post & Under Graduates', 'PMCON26', 850, 4, 850, NULL),
  ('exhibitor_counter', 'Exhibitors', 'PMCON26', 1001, 4, 1001, NULL),
  ('pmcon_counter', 'General / No Category', 'PMCON26', 2001, 4, 2001, 2000)
ON CONFLICT (counter_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  prefix = EXCLUDED.prefix;

-- Seed default settings
INSERT INTO public.application_settings (key, value) VALUES
  ('conference_name', '"InSH-BPCON 2026"'),
  ('conference_year', '2026'),
  ('venue', '"Chennai"'),
  ('conference_dates', '"TBD"')
ON CONFLICT (key) DO NOTHING;

-- Seed badge layout
INSERT INTO public.application_settings (key, value) VALUES
  ('badge_layout', '{
    "registration": { "top": 2.28, "left": 0.25, "width": 3.5, "fontSize": 0.20, "color": "#cf252b" },
    "qr": { "top": 2.65, "left": 1.275, "size": 1.45 },
    "name": { "top": 4.20, "left": 0.25, "width": 3.5, "fontSize": 0.25, "color": "#17251f" }
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- RPC: get_dashboard_totals
CREATE OR REPLACE FUNCTION public.get_dashboard_totals()
RETURNS TABLE(
  total_attendees  bigint,
  checked_in       bigint,
  checked_out      bigint,
  not_checked_in   bigint,
  spot             bigint,
  pre_registered   bigint
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE attendance_status = 'checked_in')::bigint,
    COUNT(*) FILTER (WHERE attendance_status = 'checked_out')::bigint,
    COUNT(*) FILTER (WHERE attendance_status = 'not_checked_in')::bigint,
    COUNT(*) FILTER (WHERE registration_type = 'spot')::bigint,
    COUNT(*) FILTER (WHERE registration_type = 'pre_registered')::bigint
  FROM public.attendees;
END;
$$;

-- RPC: get_counter_status
CREATE OR REPLACE FUNCTION public.get_counter_status()
RETURNS TABLE(
  counter_key        text,
  display_name       text,
  prefix             text,
  start_value        int,
  next_value         int,
  last_used_value    int,
  highest_used_in_db int,
  configured         boolean
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.counter_key,
    COALESCE(rc.display_name, rc.counter_key),
    rc.prefix,
    rc.start_value,
    rc.next_value,
    rc.last_used_value,
    COALESCE((
      SELECT MAX(substring(a.registration_number FROM '([0-9]+)$')::int)
      FROM public.attendees a
      WHERE
        (rc.counter_key = 'faculty_counter'   AND a.category = 'Faculty')
        OR (rc.counter_key = 'delegate_counter'  AND a.category = 'Delegates')
        OR (rc.counter_key = 'student_counter'   AND a.category IN ('Post Graduates','Under Graduates'))
        OR (rc.counter_key = 'exhibitor_counter' AND a.category = 'Exhibitors')
    ), 0),
    rc.start_value IS NOT NULL
  FROM public.registration_counters rc
  ORDER BY rc.counter_key;
END;
$$;

-- RPC: lookup_attendee_by_reg_no
CREATE OR REPLACE FUNCTION public.lookup_attendee_by_reg_no(p_registration_number text)
RETURNS TABLE(
  attendee_id         uuid,
  name                text,
  registration_number text,
  category            text,
  attendance_status   text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_att public.attendees%ROWTYPE;
BEGIN
  SELECT * INTO v_att FROM public.attendees WHERE public.attendees.registration_number = p_registration_number;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_att.id, v_att.name, v_att.registration_number,
                      v_att.category, v_att.attendance_status;
END;
$$;

-- RPC: process_scan_by_reg_no
CREATE OR REPLACE FUNCTION public.process_scan_by_reg_no(
  p_registration_number text,
  p_action      text,
  p_device_info text DEFAULT NULL,
  p_session_id  text DEFAULT NULL
)
RETURNS TABLE(
  result            text,
  attendee_id       uuid,
  name              text,
  registration_number text,
  category          text,
  attendance_status text,
  action            text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_att          public.attendees%ROWTYPE;
  v_result       text;
  v_new_status   text;
  v_scan_action  text;
BEGIN
  IF p_action NOT IN ('check_in','check_out') THEN
    RAISE EXCEPTION 'Invalid action: must be check_in or check_out';
  END IF;

  SELECT * INTO v_att
  FROM public.attendees
  WHERE public.attendees.registration_number = p_registration_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_qr'::text, NULL::uuid, NULL::text,
                       NULL::text, NULL::text, NULL::text, p_action::text;
    RETURN;
  END IF;

  IF p_action = 'check_in' THEN
    IF v_att.attendance_status = 'checked_in' THEN
      v_result := 'already_checked_in';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSE
      v_result := 'success_check_in';
      v_new_status := 'checked_in';
      v_scan_action := 'check_in';
    END IF;
  ELSE
    IF v_att.attendance_status = 'not_checked_in' THEN
      v_result := 'not_checked_in';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSIF v_att.attendance_status = 'checked_out' THEN
      v_result := 'already_checked_out';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSE
      v_result := 'success_check_out';
      v_new_status := 'checked_out';
      v_scan_action := 'check_out';
    END IF;
  END IF;

  IF v_scan_action IS NOT NULL THEN
    UPDATE public.attendees
    SET attendance_status = v_new_status, updated_at = now()
    WHERE id = v_att.id;

    INSERT INTO public.scan_events (attendee_id, action, staff_id, device_info, session_id)
    VALUES (v_att.id, v_scan_action, auth.uid(), p_device_info, p_session_id);

    INSERT INTO public.scan_logs (attendee_id, scanner_id, scan_type, registration_number, scanned_at, sync_status)
    VALUES (v_att.id, auth.uid(), v_scan_action, v_att.registration_number, now(), 'synced');
  END IF;

  RETURN QUERY SELECT v_result, v_att.id, v_att.name, v_att.registration_number,
                    v_att.category, v_new_status, p_action::text;
END;
$$;

-- RPC: process_scan (by qr_token)
CREATE OR REPLACE FUNCTION public.process_scan(
  p_qr_token    text,
  p_action      text,
  p_device_info text DEFAULT NULL,
  p_session_id  text DEFAULT NULL
)
RETURNS TABLE(
  result            text,
  attendee_id       uuid,
  name              text,
  registration_number text,
  category          text,
  attendance_status text,
  action            text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_att          public.attendees%ROWTYPE;
  v_result       text;
  v_new_status   text;
  v_scan_action  text;
BEGIN
  IF p_action NOT IN ('check_in','check_out') THEN
    RAISE EXCEPTION 'Invalid action: must be check_in or check_out';
  END IF;

  SELECT * INTO v_att
  FROM public.attendees
  WHERE public.attendees.qr_token = p_qr_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid_qr'::text, NULL::uuid, NULL::text,
                       NULL::text, NULL::text, NULL::text, p_action::text;
    RETURN;
  END IF;

  IF p_action = 'check_in' THEN
    IF v_att.attendance_status = 'checked_in' THEN
      v_result := 'already_checked_in';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSE
      v_result := 'success_check_in';
      v_new_status := 'checked_in';
      v_scan_action := 'check_in';
    END IF;
  ELSE
    IF v_att.attendance_status = 'not_checked_in' THEN
      v_result := 'not_checked_in';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSIF v_att.attendance_status = 'checked_out' THEN
      v_result := 'already_checked_out';
      v_new_status := v_att.attendance_status;
      v_scan_action := NULL;
    ELSE
      v_result := 'success_check_out';
      v_new_status := 'checked_out';
      v_scan_action := 'check_out';
    END IF;
  END IF;

  IF v_scan_action IS NOT NULL THEN
    UPDATE public.attendees
    SET attendance_status = v_new_status, updated_at = now()
    WHERE id = v_att.id;

    INSERT INTO public.scan_events (attendee_id, action, staff_id, device_info, session_id)
    VALUES (v_att.id, v_scan_action, auth.uid(), p_device_info, p_session_id);

    INSERT INTO public.scan_logs (attendee_id, scanner_id, scan_type, registration_number, scanned_at, sync_status)
    VALUES (v_att.id, auth.uid(), v_scan_action, v_att.registration_number, now(), 'synced');
  END IF;

  RETURN QUERY SELECT v_result, v_att.id, v_att.name, v_att.registration_number,
                    v_att.category, v_new_status, p_action::text;
END;
$$;

-- RPC: create_spot_registration
CREATE OR REPLACE FUNCTION public.create_spot_registration(
  p_name                   text,
  p_category               text,
  p_food_preference        text,
  p_payment_status         text,
  p_phone_number           text DEFAULT NULL,
  p_email                  text DEFAULT NULL,
  p_gender                 text DEFAULT NULL,
  p_medical_council_number text DEFAULT NULL,
  p_idempotency_key        text DEFAULT NULL
)
RETURNS TABLE(
  registration_number text,
  qr_token            text,
  attendee_id         uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_name        text;
  v_phone       text;
  v_email       text;
  v_counter_key text;
  v_counter     public.registration_counters%ROWTYPE;
  v_reg_no      text;
  v_exists      boolean;
  v_qr_token    text;
  v_attendee_id uuid;
  v_existing_id uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT spot_registration_keys.attendee_id INTO v_existing_id
    FROM public.spot_registration_keys
    WHERE spot_registration_keys.idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT a.registration_number, a.qr_token, a.id
      FROM public.attendees a WHERE a.id = v_existing_id;
      RETURN;
    END IF;
  END IF;

  v_name := btrim(p_name);
  v_email := NULLIF(lower(btrim(p_email)), '');
  v_phone := NULLIF(btrim(p_phone_number), '');

  v_counter_key := CASE p_category
    WHEN 'Faculty'         THEN 'faculty_counter'
    WHEN 'Delegates'       THEN 'delegate_counter'
    WHEN 'Post Graduates'  THEN 'student_counter'
    WHEN 'Under Graduates' THEN 'student_counter'
    WHEN 'Exhibitors'      THEN 'exhibitor_counter'
    ELSE 'pmcon_counter'
  END;

  SELECT * INTO v_counter
  FROM public.registration_counters
  WHERE counter_key = v_counter_key
  FOR UPDATE;

  IF NOT FOUND THEN
    v_counter.prefix := 'PMCON26';
    v_counter.next_value := 500;
    v_counter.padding := 4;
  END IF;

  IF v_counter.next_value IS NULL THEN
    v_counter.next_value := 1000;
  END IF;

  LOOP
    v_reg_no := v_counter.prefix || '-' || lpad(v_counter.next_value::text, COALESCE(v_counter.padding, 4), '0');
    SELECT EXISTS(SELECT 1 FROM public.attendees WHERE public.attendees.registration_number = v_reg_no) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_counter.next_value := v_counter.next_value + 1;
  END LOOP;

  v_qr_token := gen_random_uuid()::text;

  INSERT INTO public.attendees (
    registration_number, name, category, phone_number, email, gender,
    food_preference, payment_status, registration_type, qr_token,
    attendance_status, medical_council_number, created_by
  )
  VALUES (
    v_reg_no, v_name, COALESCE(p_category, 'General'), v_phone, v_email, p_gender,
    COALESCE(p_food_preference, 'Not Specified'), COALESCE(p_payment_status, 'Paid'), 'spot', v_qr_token,
    'not_checked_in', p_medical_council_number, auth.uid()
  )
  RETURNING id INTO v_attendee_id;

  UPDATE public.registration_counters
  SET next_value      = v_counter.next_value + 1,
      last_used_value = v_counter.next_value,
      updated_at      = now()
  WHERE counter_key = v_counter_key;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO public.spot_registration_keys (idempotency_key, attendee_id, created_by)
    VALUES (p_idempotency_key, v_attendee_id, auth.uid());
  END IF;

  INSERT INTO public.audit_events (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'spot_registration_created', 'attendee', v_attendee_id,
    jsonb_build_object(
      'registration_number', v_reg_no,
      'category', p_category,
      'name', v_name
    ));

  RETURN QUERY SELECT v_reg_no, v_qr_token, v_attendee_id;
END;
$$;

-- 8-parameter overload without medical council number
CREATE OR REPLACE FUNCTION public.create_spot_registration(
  p_name            text,
  p_category        text,
  p_food_preference text,
  p_payment_status  text,
  p_phone_number    text DEFAULT NULL,
  p_email           text DEFAULT NULL,
  p_gender          text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE(
  registration_number text,
  qr_token            text,
  attendee_id         uuid
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.create_spot_registration(
    p_name, p_category, p_food_preference, p_payment_status,
    p_phone_number, p_email, p_gender, NULL::text, p_idempotency_key
  );
END;
$$;

-- RPC: list_staff_with_emails
CREATE OR REPLACE FUNCTION public.list_staff_with_emails()
RETURNS TABLE(
  id          uuid,
  name        text,
  email       text,
  role        text,
  active      boolean,
  created_at  timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT sp.id, sp.name, COALESCE(au.email, sp.email) as email, sp.role, sp.active, sp.created_at
  FROM public.staff_profiles sp
  LEFT JOIN auth.users au ON au.id = sp.id
  ORDER BY sp.name;
END;
$$;

-- RPC: get_reports_totals
CREATE OR REPLACE FUNCTION public.get_reports_totals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_attendees',   (SELECT COUNT(*) FROM public.attendees),
    'pre_registered',    (SELECT COUNT(*) FROM public.attendees WHERE registration_type = 'pre_registered'),
    'spot',              (SELECT COUNT(*) FROM public.attendees WHERE registration_type = 'spot'),
    'checked_in',        (SELECT COUNT(*) FROM public.attendees WHERE attendance_status = 'checked_in'),
    'checked_out',       (SELECT COUNT(*) FROM public.attendees WHERE attendance_status = 'checked_out'),
    'not_checked_in',    (SELECT COUNT(*) FROM public.attendees WHERE attendance_status = 'not_checked_in'),
    'by_category',       COALESCE((SELECT jsonb_object_agg(COALESCE(category, 'General'), cnt) FROM (SELECT category, COUNT(*) cnt FROM public.attendees GROUP BY category) c), '{}'::jsonb),
    'by_food',           COALESCE((SELECT jsonb_object_agg(COALESCE(food_preference, 'Not Specified'), cnt) FROM (SELECT food_preference, COUNT(*) cnt FROM public.attendees GROUP BY food_preference) f), '{}'::jsonb),
    'by_payment',        COALESCE((SELECT jsonb_object_agg(COALESCE(payment_status, 'Paid'), cnt) FROM (SELECT payment_status, COUNT(*) cnt FROM public.attendees GROUP BY payment_status) p), '{}'::jsonb),
    'badge_prints',      (SELECT COUNT(*) FROM public.badge_print_events),
    'check_ins',         (SELECT COUNT(*) FROM public.scan_events WHERE action = 'check_in'),
    'check_outs',        (SELECT COUNT(*) FROM public.scan_events WHERE action = 'check_out')
  ) INTO result;
  RETURN result;
END;
$$;

-- RPC: get_audit_log
CREATE OR REPLACE FUNCTION public.get_audit_log(
  p_offset      int  DEFAULT 0,
  p_limit       int  DEFAULT 25,
  p_actor       uuid DEFAULT NULL,
  p_action      text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
)
RETURNS TABLE(
  id           uuid,
  created_at   timestamptz,
  actor_id     uuid,
  actor_name   text,
  action       text,
  target_type  text,
  target_id    uuid,
  details      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit > 200 THEN p_limit := 200; END IF;
  RETURN QUERY
  SELECT
    ae.id,
    ae.created_at,
    ae.actor_id,
    sp.name,
    ae.action,
    ae.target_type,
    ae.target_id,
    ae.details
  FROM public.audit_events ae
  LEFT JOIN public.staff_profiles sp ON sp.id = ae.actor_id
  WHERE (p_actor IS NULL OR ae.actor_id = p_actor)
    AND (p_action IS NULL OR ae.action = p_action)
    AND (p_target_type IS NULL OR ae.target_type = p_target_type)
    AND (p_from IS NULL OR ae.created_at >= p_from)
    AND (p_to   IS NULL OR ae.created_at <= p_to)
  ORDER BY ae.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- RPC: get_audit_log_count
CREATE OR REPLACE FUNCTION public.get_audit_log_count(
  p_actor       uuid DEFAULT NULL,
  p_action      text DEFAULT NULL,
  p_target_type text DEFAULT NULL,
  p_from        timestamptz DEFAULT NULL,
  p_to          timestamptz DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.audit_events ae
  WHERE (p_actor IS NULL OR ae.actor_id = p_actor)
    AND (p_action IS NULL OR ae.action = p_action)
    AND (p_target_type IS NULL OR ae.target_type = p_target_type)
    AND (p_from IS NULL OR ae.created_at >= p_from)
    AND (p_to   IS NULL OR ae.created_at <= p_to);
  RETURN v_count;
END;
$$;
`;

async function initNeonDb() {
  console.log('Connecting to Neon PostgreSQL to initialize schema...');
  const client = await pool.connect();
  try {
    console.log('Applying tables, functions, and seed constraints...');
    await client.query(schemaSql);
    console.log('Schema created successfully!');

    // Check and seed default admin/staff from environment variables
    const usersToSeed = [
      {
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
        name: 'Surya (System Administrator)',
        role: 'admin'
      },
      {
        email: process.env.ADMIN_EMAIL_2,
        password: process.env.ADMIN_PASSWORD_2,
        name: 'Mukesh (Admin)',
        role: 'admin'
      },
      {
        email: process.env.STAFF_EMAIL,
        password: process.env.STAFF_PASSWORD,
        name: 'Conference Staff',
        role: 'staff'
      },
      {
        email: process.env.SCANNER_EMAIL,
        password: process.env.SCANNER_PASSWORD,
        name: 'Scanner Operator',
        role: 'scanner'
      }
    ].filter((u) => u.email && u.password);

    for (const u of usersToSeed) {
      const emailLower = u.email.toLowerCase().trim();
      const existingUser = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = $1', [emailLower]);
      
      let userId;
      const hash = bcrypt.hashSync(u.password, 10);

      if (existingUser.rows.length === 0) {
        const insertUser = await client.query(
          'INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id',
          [emailLower, hash]
        );
        userId = insertUser.rows[0].id;
        console.log(`Created user: ${emailLower}`);
      } else {
        userId = existingUser.rows[0].id;
        await client.query(
          'UPDATE auth.users SET password_hash = $1 WHERE id = $2',
          [hash, userId]
        );
        console.log(`Updated user password: ${emailLower}`);
      }

      await client.query(`
        INSERT INTO public.staff_profiles (id, name, role, active, email)
        VALUES ($1, $2, $3, true, $4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          active = true,
          email = EXCLUDED.email
      `, [userId, u.name, u.role, emailLower]);
    }

    console.log('Seeding completed successfully!');
  } catch (err) {
    console.error('Error initializing Neon DB:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initNeonDb().catch(err => {
  console.error(err);
  process.exit(1);
});
