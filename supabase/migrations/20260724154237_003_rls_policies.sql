
/*
# Migration 003 – Row Level Security Policies

## Summary
Applies the full RLS policy set to all eight application tables and creates
the two SECURITY DEFINER helper functions that every policy depends on.

## Helper Functions (SECURITY DEFINER)

### current_staff_role()
Returns the caller's role text ('admin' | 'registration' | 'scanner') or NULL
if the caller has no staff_profiles row. Owned by postgres so it can read
staff_profiles regardless of RLS.

### is_active_staff(p_role text DEFAULT NULL)
Returns true when the caller:
  - has an authenticated session (auth.uid() IS NOT NULL)
  - has a matching staff_profiles row
  - that row has active = true
  - AND (if p_role is provided) the role matches p_role.
This is the single gate used by every table policy. An inactive or
non-existent profile sees zero rows everywhere, enforcing the login
requirement (valid user + matching profile + active = true) at the
database level.

## Policy Matrix

| Table                    | SELECT            | INSERT             | UPDATE             | DELETE             |
|--------------------------|-------------------|--------------------|--------------------|--------------------|
| staff_profiles           | self OR admin     | none (edge fn only)| admin              | admin              |
| attendees                | admin, registration| admin, registration| admin, registration| admin (RESTRICT on scans) |
| import_batches           | admin, registration| admin, registration| admin, registration| admin              |
| scan_events              | all active staff  | none (process_scan)| none (immutable)   | none (immutable)   |
| badge_print_events       | all active staff  | admin, registration| none (immutable)   | none (immutable)   |
| audit_events             | admin only        | all active staff  | none (immutable)   | none (immutable)   |
| application_settings     | all active staff  | admin              | admin              | admin              |
| registration_counters    | admin only        | none (function)   | none (function)    | none (function)    |

## Scanner Column Restriction (enforced in DB, not just UI)
Scanners have NO SELECT policy on attendees, so they cannot read phone,
email, gender, or payment_status directly. The only data path available to
a scanner is the process_scan RPC (migration 004), which is SECURITY DEFINER
and returns only name, registration_number, category, and attendance_status.

## Notes
1. Policies are dropped first (DROP POLICY IF EXISTS) before re-creating,
   making this migration safe to re-run.
2. All policies use auth.uid() — never current_user.
3. Separate policies per CRUD verb — no FOR ALL shortcuts.
4. The functions are marked SECURITY DEFINER and owned by postgres so they
   bypass RLS to read staff_profiles; the policies themselves run as the
   calling role and remain subject to RLS.
*/

-- ─────────────────────── Helper functions ──────────────────────────────────

CREATE OR REPLACE FUNCTION current_staff_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM staff_profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION current_staff_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_staff_role() TO authenticated;

CREATE OR REPLACE FUNCTION is_active_staff(p_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE id = auth.uid()
      AND active = true
      AND (p_role IS NULL OR role = p_role)
  );
$$;

REVOKE ALL ON FUNCTION is_active_staff(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_active_staff(text) TO authenticated;

-- ──────────────────────────── staff_profiles ───────────────────────────────

DROP POLICY IF EXISTS "sp_select" ON staff_profiles;
CREATE POLICY "sp_select"
ON staff_profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR is_active_staff('admin')
);

DROP POLICY IF EXISTS "sp_update" ON staff_profiles;
CREATE POLICY "sp_update"
ON staff_profiles FOR UPDATE TO authenticated
USING (is_active_staff('admin'))
WITH CHECK (is_active_staff('admin'));

DROP POLICY IF EXISTS "sp_delete" ON staff_profiles;
CREATE POLICY "sp_delete"
ON staff_profiles FOR DELETE TO authenticated
USING (is_active_staff('admin'));

-- No INSERT policy: staff_profiles rows are created only by the
-- staff-admin edge function using the service-role key.

-- ─────────────────────────────── attendees ─────────────────────────────────

DROP POLICY IF EXISTS "att_select" ON attendees;
CREATE POLICY "att_select"
ON attendees FOR SELECT TO authenticated
USING (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "att_insert" ON attendees;
CREATE POLICY "att_insert"
ON attendees FOR INSERT TO authenticated
WITH CHECK (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "att_update" ON attendees;
CREATE POLICY "att_update"
ON attendees FOR UPDATE TO authenticated
USING (
  is_active_staff('admin')
  OR is_active_staff('registration')
)
WITH CHECK (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "att_delete" ON attendees;
CREATE POLICY "att_delete"
ON attendees FOR DELETE TO authenticated
USING (is_active_staff('admin'));

-- ──────────────────────────── import_batches ───────────────────────────────

DROP POLICY IF EXISTS "ib_select" ON import_batches;
CREATE POLICY "ib_select"
ON import_batches FOR SELECT TO authenticated
USING (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "ib_insert" ON import_batches;
CREATE POLICY "ib_insert"
ON import_batches FOR INSERT TO authenticated
WITH CHECK (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "ib_update" ON import_batches;
CREATE POLICY "ib_update"
ON import_batches FOR UPDATE TO authenticated
USING (
  is_active_staff('admin')
  OR is_active_staff('registration')
)
WITH CHECK (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

DROP POLICY IF EXISTS "ib_delete" ON import_batches;
CREATE POLICY "ib_delete"
ON import_batches FOR DELETE TO authenticated
USING (is_active_staff('admin'));

-- ─────────────────────────────── scan_events ───────────────────────────────
-- Immutable: SELECT only for all staff; INSERT only via process_scan RPC.
-- Scanner can see scan history (contains no PII beyond attendee id + action).

DROP POLICY IF EXISTS "se_select" ON scan_events;
CREATE POLICY "se_select"
ON scan_events FOR SELECT TO authenticated
USING (is_active_staff());

-- No INSERT policy: scan_events rows are created only by process_scan()
-- (SECURITY DEFINER), never directly by the client.

-- ──────────────────────────── badge_print_events ───────────────────────────
-- Immutable. Admin + registration can log prints; all staff can view history.

DROP POLICY IF EXISTS "bpe_select" ON badge_print_events;
CREATE POLICY "bpe_select"
ON badge_print_events FOR SELECT TO authenticated
USING (is_active_staff());

DROP POLICY IF EXISTS "bpe_insert" ON badge_print_events;
CREATE POLICY "bpe_insert"
ON badge_print_events FOR INSERT TO authenticated
WITH CHECK (
  is_active_staff('admin')
  OR is_active_staff('registration')
);

-- ─────────────────────────────── audit_events ──────────────────────────────
-- Immutable. All staff insert; only admin reads.

DROP POLICY IF EXISTS "ae_select" ON audit_events;
CREATE POLICY "ae_select"
ON audit_events FOR SELECT TO authenticated
USING (is_active_staff('admin'));

DROP POLICY IF EXISTS "ae_insert" ON audit_events;
CREATE POLICY "ae_insert"
ON audit_events FOR INSERT TO authenticated
WITH CHECK (is_active_staff());

-- ─────────────────────────── application_settings ──────────────────────────

DROP POLICY IF EXISTS "as_select" ON application_settings;
CREATE POLICY "as_select"
ON application_settings FOR SELECT TO authenticated
USING (is_active_staff());

DROP POLICY IF EXISTS "as_insert" ON application_settings;
CREATE POLICY "as_insert"
ON application_settings FOR INSERT TO authenticated
WITH CHECK (is_active_staff('admin'));

DROP POLICY IF EXISTS "as_update" ON application_settings;
CREATE POLICY "as_update"
ON application_settings FOR UPDATE TO authenticated
USING (is_active_staff('admin'))
WITH CHECK (is_active_staff('admin'));

DROP POLICY IF EXISTS "as_delete" ON application_settings;
CREATE POLICY "as_delete"
ON application_settings FOR DELETE TO authenticated
USING (is_active_staff('admin'));

-- ────────────────────────── registration_counters ──────────────────────────
-- Admin read only. All mutations happen inside create_spot_registration()
-- (SECURITY DEFINER), so no INSERT/UPDATE/DELETE policies.

DROP POLICY IF EXISTS "rc_select" ON registration_counters;
CREATE POLICY "rc_select"
ON registration_counters FOR SELECT TO authenticated
USING (is_active_staff('admin'));
