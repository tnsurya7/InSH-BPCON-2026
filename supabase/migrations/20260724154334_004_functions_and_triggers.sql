
/*
# Migration 004 – Database Functions and Triggers

## Summary
Creates the atomic business-logic functions and all triggers.

## Functions (all SECURITY DEFINER, owned by postgres)

### create_spot_registration(...)
Atomically creates a spot attendee with a guaranteed-unique sequential
registration number. Uses SELECT ... FOR UPDATE on registration_counters to
serialise concurrent calls — two simultaneous requests can never receive
the same number.
Returns: (registration_number, qr_token, attendee_id).

### process_scan(p_qr_token, p_action, p_device_info, p_session_id)
Atomically records a check-in or check-out. Uses SELECT ... FOR UPDATE on
the attendee row so two devices cannot record the same transition at once.
Returns a composite with a result code:
  invalid_qr | success_check_in | already_checked_in |
  success_check_out | already_checked_out | not_checked_in
The return payload deliberately excludes phone, email, gender, and
payment_status — scanners only get name, registration_number, category,
and attendance_status.

### lookup_attendee_by_token(p_qr_token)
Optional manual search for the scanner. Returns only the minimal fields
required for confirmation (same restricted set as process_scan).

### log_audit(p_action, p_target_type, p_target_id, p_details)
Convenience insert into audit_events. SECURITY DEFINER so any authenticated
staff member can log without needing a direct INSERT policy dependency chain.

## Triggers

### set_updated_at()
Generic BEFORE UPDATE trigger that bumps updated_at to now(). Applied to:
staff_profiles, attendees, import_batches, application_settings,
registration_counters.

### prevent_modification()
BEFORE UPDATE OR DELETE trigger applied to the three immutable tables:
scan_events, badge_print_events, audit_events. Raises an exception so these
rows can never be changed once written.

## Notes
1. All functions revoke PUBLIC execute and grant only authenticated, so
   anonymous keys cannot call them.
2. process_scan validates that the caller is active staff before proceeding.
3. No real data inserted.
*/

-- ─────────────────────── updated_at trigger function ───────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ─────────────────────── immutability trigger function ─────────────────────

CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is immutable: UPDATE and DELETE are not allowed',
    TG_TABLE_NAME;
END;
$$;

-- ─────────────────── create_spot_registration function ────────────────────

CREATE OR REPLACE FUNCTION create_spot_registration(
  p_name            text,
  p_category        text,
  p_food_preference text,
  p_payment_status  text,
  p_phone_number    text DEFAULT NULL,
  p_email           text DEFAULT NULL,
  p_gender          text DEFAULT NULL
)
RETURNS TABLE(
  registration_number text,
  qr_token            text,
  attendee_id         uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter    registration_counters%ROWTYPE;
  v_reg_no     text;
  v_qr_token   text;
  v_attendee_id uuid;
BEGIN
  -- Authorise: must be active registration or admin staff
  IF NOT is_active_staff('registration') AND NOT is_active_staff('admin') THEN
    RAISE EXCEPTION 'Permission denied: only registration or admin staff can create spot registrations';
  END IF;

  -- Validate category
  IF p_category NOT IN ('Delegates','Faculty','Post Graduates','Under Graduates','Exhibitors') THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  -- Validate food preference
  IF p_food_preference NOT IN ('Vegetarian','Non-Vegetarian','Not Specified') THEN
    RAISE EXCEPTION 'Invalid food preference: %', p_food_preference;
  END IF;

  -- Validate gender if provided
  IF p_gender IS NOT NULL AND p_gender NOT IN ('Male','Female','Other','Prefer not to say') THEN
    RAISE EXCEPTION 'Invalid gender: %', p_gender;
  END IF;

  -- Lock the counter row serially → no duplicate numbers under concurrency
  SELECT * INTO v_counter
  FROM registration_counters
  WHERE counter_key = 'spot_registration'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Spot registration counter not found';
  END IF;

  v_reg_no := v_counter.prefix || lpad(v_counter.next_value::text, v_counter.padding, '0');

  -- Advance the counter
  UPDATE registration_counters
  SET next_value = next_value + 1
  WHERE counter_key = 'spot_registration';

  -- Generate a fresh random QR token
  v_qr_token := gen_random_uuid()::text;

  -- Insert the attendee (registration_type = 'spot')
  INSERT INTO attendees (
    registration_number, name, category, phone_number, email, gender,
    food_preference, payment_status, registration_type, qr_token,
    attendance_status, created_by
  )
  VALUES (
    v_reg_no, p_name, p_category, p_phone_number, p_email, p_gender,
    p_food_preference, p_payment_status, 'spot', v_qr_token,
    'not_checked_in', auth.uid()
  )
  RETURNING id INTO v_attendee_id;

  -- Return the generated values
  RETURN QUERY SELECT v_reg_no, v_qr_token, v_attendee_id;
END;
$$;

REVOKE ALL ON FUNCTION create_spot_registration(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_spot_registration(text,text,text,text,text,text,text) TO authenticated;

-- ─────────────────────── process_scan function ─────────────────────────────

CREATE OR REPLACE FUNCTION process_scan(
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att          attendees%ROWTYPE;
  v_result       text;
  v_new_status   text;
  v_scan_action  text;
BEGIN
  -- Authorise: must be any active staff member
  IF NOT is_active_staff() THEN
    RAISE EXCEPTION 'Permission denied: active staff required';
  END IF;

  -- Validate action
  IF p_action NOT IN ('check_in','check_out') THEN
    RAISE EXCEPTION 'Invalid action: must be check_in or check_out';
  END IF;

  -- Look up attendee by QR token and lock the row
  SELECT * INTO v_att
  FROM attendees
  WHERE qr_token = p_qr_token
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
  ELSE  -- check_out
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

  -- Only update attendee + insert event on a real transition
  IF v_scan_action IS NOT NULL THEN
    UPDATE attendees
    SET attendance_status = v_new_status
    WHERE id = v_att.id;

    INSERT INTO scan_events (attendee_id, action, staff_id, device_info, session_id)
    VALUES (v_att.id, v_scan_action, auth.uid(), p_device_info, p_session_id);
  END IF;

  RETURN QUERY SELECT v_result, v_att.id, v_att.name, v_att.registration_number,
                      v_att.category, v_new_status, p_action::text;
END;
$$;

REVOKE ALL ON FUNCTION process_scan(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_scan(text,text,text,text) TO authenticated;

-- ───────────────── lookup_attendee_by_token function ───────────────────────

CREATE OR REPLACE FUNCTION lookup_attendee_by_token(p_qr_token text)
RETURNS TABLE(
  attendee_id         uuid,
  name                text,
  registration_number text,
  category            text,
  attendance_status   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att attendees%ROWTYPE;
BEGIN
  IF NOT is_active_staff() THEN
    RAISE EXCEPTION 'Permission denied: active staff required';
  END IF;

  SELECT * INTO v_att FROM attendees WHERE qr_token = p_qr_token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_att.id, v_att.name, v_att.registration_number,
                      v_att.category, v_att.attendance_status;
END;
$$;

REVOKE ALL ON FUNCTION lookup_attendee_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_attendee_by_token(text) TO authenticated;

-- ─────────────────────── log_audit function ────────────────────────────────

CREATE OR REPLACE FUNCTION log_audit(
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_details     jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anyone authenticated can insert; the INSERT RLS policy on audit_events
  -- requires is_active_staff(), which is checked there. This function is a
  -- convenience that fills actor_id automatically.
  INSERT INTO audit_events (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), p_action, p_target_type, p_target_id, p_details);
END;
$$;

REVOKE ALL ON FUNCTION log_audit(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_audit(text,text,uuid,jsonb) TO authenticated;

-- ──────────────────────────── Triggers ─────────────────────────────────────

-- updated_at on mutable tables
DROP TRIGGER IF EXISTS set_updated_at_staff_profiles ON staff_profiles;
CREATE TRIGGER set_updated_at_staff_profiles
  BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_attendees ON attendees;
CREATE TRIGGER set_updated_at_attendees
  BEFORE UPDATE ON attendees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_import_batches ON import_batches;
CREATE TRIGGER set_updated_at_import_batches
  BEFORE UPDATE ON import_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_application_settings ON application_settings;
CREATE TRIGGER set_updated_at_application_settings
  BEFORE UPDATE ON application_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_registration_counters ON registration_counters;
CREATE TRIGGER set_updated_at_registration_counters
  BEFORE UPDATE ON registration_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Immutability on scan_events, badge_print_events, audit_events
DROP TRIGGER IF EXISTS prevent_scan_events_mod ON scan_events;
CREATE TRIGGER prevent_scan_events_mod
  BEFORE UPDATE OR DELETE ON scan_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

DROP TRIGGER IF EXISTS prevent_badge_print_events_mod ON badge_print_events;
CREATE TRIGGER prevent_badge_print_events_mod
  BEFORE UPDATE OR DELETE ON badge_print_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

DROP TRIGGER IF EXISTS prevent_audit_events_mod ON audit_events;
CREATE TRIGGER prevent_audit_events_mod
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();
