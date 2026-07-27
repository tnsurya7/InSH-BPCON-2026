/*
# Migration 008 – Reports, Staff Listing, and Audit Log Functions

## Summary
Adds the read-side database functions that power the Reports, Audit Log,
and Staff Management screens. No new tables are created — all functions are
SECURITY DEFINER, owned by postgres, and enforce role checks internally so
the results are correct even if a client with the anon key somehow reaches
them.

## Functions

### get_reports_totals()
SECURITY DEFINER. Returns a single JSON row with every aggregate the
Reports screen needs: attendee totals by type, attendance status, category,
food preference, payment status, and badge-print / scan-event counts.
Callable by admin and registration only. Scanners receive an error.

### list_staff_with_emails()
SECURITY DEFINER. Returns id, name, role, active, created_at for every
staff profile joined to auth.users(email). Admin only. Passwords,
encrypted passwords, and any auth metadata are never returned.

### get_audit_log(p_offset, p_limit, p_actor, p_action, p_target_type, p_from, p_to)
SECURITY DEFINER. Returns audit_events rows newest-first, joined to
staff_profiles for the actor's name, with optional filters. Admin only.
Never exposes any secret — audit_events.details is user-controlled JSON
that the application layer constructs and screens for sensitive data before
insert.

### get_audit_log_count(p_actor, p_action, p_target_type, p_from, p_to)
Companion count for pagination. Admin only.

## Security
- All four functions REVOKE PUBLIC and GRANT only authenticated.
- Each function re-checks is_active_staff() with the required role, so RLS
  alone is not relied upon.
- No function returns qr_token, password, or auth metadata.
- audit_events remains append-only (immutability trigger from migration 004).
*/

-- ─────────────────────── get_reports_totals ─────────────────────────────────

CREATE OR REPLACE FUNCTION get_reports_totals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT is_active_staff('admin') AND NOT is_active_staff('registration') THEN
    RAISE EXCEPTION 'Permission denied: admin or registration role required';
  END IF;

  SELECT jsonb_build_object(
    'total_attendees',   (SELECT COUNT(*) FROM attendees),
    'pre_registered',    (SELECT COUNT(*) FROM attendees WHERE registration_type = 'pre_registered'),
    'spot',              (SELECT COUNT(*) FROM attendees WHERE registration_type = 'spot'),
    'checked_in',        (SELECT COUNT(*) FROM attendees WHERE attendance_status = 'checked_in'),
    'checked_out',       (SELECT COUNT(*) FROM attendees WHERE attendance_status = 'checked_out'),
    'not_checked_in',    (SELECT COUNT(*) FROM attendees WHERE attendance_status = 'not_checked_in'),
    'by_category',       COALESCE((SELECT jsonb_object_agg(category, cnt) FROM (SELECT category, COUNT(*) cnt FROM attendees GROUP BY category) c), '{}'::jsonb),
    'by_food',           COALESCE((SELECT jsonb_object_agg(food_preference, cnt) FROM (SELECT food_preference, COUNT(*) cnt FROM attendees GROUP BY food_preference) f), '{}'::jsonb),
    'by_payment',        COALESCE((SELECT jsonb_object_agg(payment_status, cnt) FROM (SELECT payment_status, COUNT(*) cnt FROM attendees GROUP BY payment_status) p), '{}'::jsonb),
    'badge_prints',      (SELECT COUNT(*) FROM badge_print_events),
    'check_ins',         (SELECT COUNT(*) FROM scan_events WHERE action = 'check_in'),
    'check_outs',        (SELECT COUNT(*) FROM scan_events WHERE action = 'check_out')
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION get_reports_totals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_reports_totals() TO authenticated;

-- ──────────────────── list_staff_with_emails ────────────────────────────────

CREATE OR REPLACE FUNCTION list_staff_with_emails()
RETURNS TABLE(
  id          uuid,
  name        text,
  email       text,
  role        text,
  active      boolean,
  created_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active_staff('admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.name, au.email, sp.role, sp.active, sp.created_at
  FROM staff_profiles sp
  LEFT JOIN auth.users au ON au.id = sp.id
  ORDER BY sp.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION list_staff_with_emails() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_staff_with_emails() TO authenticated;

-- ─────────────────────────── get_audit_log ──────────────────────────────────

CREATE OR REPLACE FUNCTION get_audit_log(
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
  IF NOT is_active_staff('admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  IF p_limit > 200 THEN
    p_limit := 200;
  END IF;

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
  FROM audit_events ae
  LEFT JOIN staff_profiles sp ON sp.id = ae.actor_id
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

REVOKE ALL ON FUNCTION get_audit_log(int,int,uuid,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audit_log(int,int,uuid,text,text,timestamptz,timestamptz) TO authenticated;

-- ──────────────────────── get_audit_log_count ───────────────────────────────

CREATE OR REPLACE FUNCTION get_audit_log_count(
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
  IF NOT is_active_staff('admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM audit_events ae
  WHERE (p_actor IS NULL OR ae.actor_id = p_actor)
    AND (p_action IS NULL OR ae.action = p_action)
    AND (p_target_type IS NULL OR ae.target_type = p_target_type)
    AND (p_from IS NULL OR ae.created_at >= p_from)
    AND (p_to   IS NULL OR ae.created_at <= p_to);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION get_audit_log_count(uuid,text,text,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_audit_log_count(uuid,text,text,timestamptz,timestamptz) TO authenticated;
