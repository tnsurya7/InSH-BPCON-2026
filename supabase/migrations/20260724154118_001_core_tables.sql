
/*
# Migration 001 – Core Tables

## Summary
Creates the four foundational tables for InSH-BPCON 2026 registration.

## New Tables

### staff_profiles
Stores one profile per Supabase auth user. Login is only permitted when a
matching profile exists and active = true.
- id: matches auth.users(id) exactly (no separate PK sequence)
- role: one of admin | registration | scanner
- active: false immediately blocks the user from all app data

### registration_counters
Single row used for atomic spot-registration number generation.
- Seeded with ('spot_registration', 'BPCON2026-S', 1, 3)
- SELECT ... FOR UPDATE on this row serialises concurrent spot registrations
  so BPCON2026-S001, BPCON2026-S002 ... are never duplicated.

### import_batches
One row per Excel import session. Every successfully imported attendee is
associated with the batch via attendees.import_batch_id.

### attendees
Master attendee table.
- registration_number: unique; spot rows use BPCON2026-Snnn format
- qr_token: random UUID string, used ONLY for QR code scanning – never
  encodes personal information
- category: constrained to the five approved values
- food_preference: constrained to Vegetarian | Non-Vegetarian | Not Specified
- gender: constrained to four approved values (nullable)
- registration_type: pre_registered | spot
- attendance_status: not_checked_in | checked_in | checked_out
- payment_status: free text (Paid / Unpaid / Pending / Complimentary typical)

## Security
RLS enabled on all four tables. Policies are applied in migration 003.

## Notes
1. ON DELETE RESTRICT on scan_events → attendees prevents silent attendee
   deletion once any scan has been recorded. Added in migration 002.
2. updated_at triggers are applied in migration 004.
3. No default passwords, no real attendee records are inserted.
*/

-- ───────────────────────────── staff_profiles ──────────────────────────────

CREATE TABLE IF NOT EXISTS staff_profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin','registration','scanner')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS staff_profiles_role_idx   ON staff_profiles (role);
CREATE INDEX IF NOT EXISTS staff_profiles_active_idx ON staff_profiles (active);

-- ─────────────────────────── registration_counters ─────────────────────────

CREATE TABLE IF NOT EXISTS registration_counters (
  counter_key text PRIMARY KEY,
  prefix      text NOT NULL,
  next_value  int  NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  padding     int  NOT NULL DEFAULT 3,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE registration_counters ENABLE ROW LEVEL SECURITY;

-- Seed the spot-registration counter (idempotent)
INSERT INTO registration_counters (counter_key, prefix, next_value, padding)
VALUES ('spot_registration', 'BPCON2026-S', 1, 3)
ON CONFLICT (counter_key) DO NOTHING;

-- ──────────────────────────── import_batches ───────────────────────────────

CREATE TABLE IF NOT EXISTS import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name        text NOT NULL,
  row_count        int  NOT NULL DEFAULT 0,
  imported_count   int  NOT NULL DEFAULT 0,
  rejected_count   int  NOT NULL DEFAULT 0,
  rejection_summary jsonb,
  created_by       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS import_batches_created_by_idx  ON import_batches (created_by);
CREATE INDEX IF NOT EXISTS import_batches_created_at_idx  ON import_batches (created_at DESC);

-- ────────────────────────────── attendees ──────────────────────────────────

CREATE TABLE IF NOT EXISTS attendees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text NOT NULL,
  name                text NOT NULL,
  category            text NOT NULL CHECK (category IN (
                          'Delegates','Faculty','Post Graduates',
                          'Under Graduates','Exhibitors')),
  phone_number        text,
  email               text,
  gender              text CHECK (gender IS NULL OR gender IN (
                          'Male','Female','Other','Prefer not to say')),
  food_preference     text NOT NULL CHECK (food_preference IN (
                          'Vegetarian','Non-Vegetarian','Not Specified')),
  payment_status      text NOT NULL,
  registration_type   text NOT NULL CHECK (registration_type IN (
                          'pre_registered','spot')),
  qr_token            text NOT NULL DEFAULT gen_random_uuid()::text,
  import_batch_id     uuid REFERENCES import_batches(id) ON DELETE SET NULL,
  attendance_status   text NOT NULL DEFAULT 'not_checked_in' CHECK (attendance_status IN (
                          'not_checked_in','checked_in','checked_out')),
  created_by          uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attendees_registration_number_unique UNIQUE (registration_number),
  CONSTRAINT attendees_qr_token_unique            UNIQUE (qr_token)
);

ALTER TABLE attendees ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS attendees_registration_number_idx ON attendees (registration_number);
CREATE INDEX IF NOT EXISTS attendees_qr_token_idx            ON attendees (qr_token);
CREATE INDEX IF NOT EXISTS attendees_import_batch_id_idx     ON attendees (import_batch_id);
CREATE INDEX IF NOT EXISTS attendees_registration_type_idx   ON attendees (registration_type);
CREATE INDEX IF NOT EXISTS attendees_category_idx            ON attendees (category);
CREATE INDEX IF NOT EXISTS attendees_payment_status_idx      ON attendees (payment_status);
CREATE INDEX IF NOT EXISTS attendees_attendance_status_idx   ON attendees (attendance_status);
CREATE INDEX IF NOT EXISTS attendees_created_by_idx          ON attendees (created_by);
CREATE INDEX IF NOT EXISTS attendees_created_at_idx          ON attendees (created_at DESC);
