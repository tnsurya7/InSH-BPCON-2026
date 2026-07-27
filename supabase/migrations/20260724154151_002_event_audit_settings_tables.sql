
/*
# Migration 002 – Event, Audit, and Settings Tables

## Summary
Creates the four immutable log/settings tables that support audit, badge
printing, QR scanning, and application configuration.

## New Tables

### scan_events  (immutable)
One row per QR scan action. Never updated or deleted after insert.
- attendee_id → attendees(id) ON DELETE RESTRICT: scanning history is
  preserved even if an attendee record is later marked inactive.
- action: check_in | check_out
- device_info + session_id: browser user-agent and a client-generated
  session UUID to help identify concurrent scan attempts.
- An immutability trigger (migration 004) blocks UPDATE and DELETE.

### badge_print_events  (immutable)
One row per badge printed. Supports print history and reprint tracking.
- print_type: single | reprint | batch | group_25 | group_50 | selected
- reason: required when print_type = 'reprint'; nullable otherwise.
- An immutability trigger (migration 004) blocks UPDATE and DELETE.

### audit_events  (immutable)
Generic application-level audit trail. Records staff logins, attendee
edits, settings changes, staff management actions, etc.
- actor_id: the staff user who triggered the event (nullable for system).
- target_type / target_id: the record that was affected.
- details: arbitrary JSON payload (old/new values, etc.).
- An immutability trigger (migration 004) blocks UPDATE and DELETE.

### application_settings  (key/value)
Admin-managed global settings (conference name, venue, dates, etc.).
- key: plain text primary key (e.g. 'conference_name').
- value: JSONB so both strings and structured data can be stored.
- updated_by → auth.users(id): tracks who last changed each setting.

## Security
RLS enabled on all four tables. Policies are applied in migration 003.

## Notes
1. Immutability triggers for scan_events, badge_print_events, and
   audit_events are added in migration 004 to keep that logic together.
2. No real data inserted.
*/

-- ───────────────────────────── scan_events ─────────────────────────────────

CREATE TABLE IF NOT EXISTS scan_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id  uuid NOT NULL REFERENCES attendees(id) ON DELETE RESTRICT,
  action       text NOT NULL CHECK (action IN ('check_in','check_out')),
  scanned_at   timestamptz NOT NULL DEFAULT now(),
  staff_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_info  text,
  session_id   text
);

ALTER TABLE scan_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS scan_events_attendee_id_idx  ON scan_events (attendee_id);
CREATE INDEX IF NOT EXISTS scan_events_staff_id_idx     ON scan_events (staff_id);
CREATE INDEX IF NOT EXISTS scan_events_scanned_at_idx   ON scan_events (scanned_at DESC);
CREATE INDEX IF NOT EXISTS scan_events_action_idx       ON scan_events (action);

-- ─────────────────────────── badge_print_events ────────────────────────────

CREATE TABLE IF NOT EXISTS badge_print_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id  uuid NOT NULL REFERENCES attendees(id) ON DELETE CASCADE,
  print_type   text NOT NULL CHECK (print_type IN (
                    'single','reprint','batch','group_25','group_50','selected')),
  reason       text,
  staff_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  printed_at   timestamptz NOT NULL DEFAULT now(),
  device_info  text
);

ALTER TABLE badge_print_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS badge_print_events_attendee_id_idx ON badge_print_events (attendee_id);
CREATE INDEX IF NOT EXISTS badge_print_events_staff_id_idx    ON badge_print_events (staff_id);
CREATE INDEX IF NOT EXISTS badge_print_events_printed_at_idx  ON badge_print_events (printed_at DESC);

-- ────────────────────────────── audit_events ───────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    uuid,
  details      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx    ON audit_events (actor_id);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx  ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_target_type_idx ON audit_events (target_type);
CREATE INDEX IF NOT EXISTS audit_events_action_idx      ON audit_events (action);

-- ────────────────────────── application_settings ───────────────────────────

CREATE TABLE IF NOT EXISTS application_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE application_settings ENABLE ROW LEVEL SECURITY;

-- Seed default settings (idempotent)
INSERT INTO application_settings (key, value) VALUES
  ('conference_name',  '"InSH-BPCON 2026"'),
  ('conference_year',  '2026'),
  ('venue',            '"Chennai"'),
  ('conference_dates', '"TBD"')
ON CONFLICT (key) DO NOTHING;
