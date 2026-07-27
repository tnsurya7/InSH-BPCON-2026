/*
# Migration 007a – Process Scan by Registration Number

## Summary
Adds process_scan_by_reg_no(), a companion to process_scan() for manual
registration-number lookup fallback. Same atomic transition logic but looks
up the attendee by registration_number instead of qr_token. Returns the
same restricted column set (no phone, email, gender, payment).
*/

CREATE OR REPLACE FUNCTION process_scan_by_reg_no(
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att          attendees%ROWTYPE;
  v_result       text;
  v_new_status   text;
  v_scan_action  text;
BEGIN
  IF NOT is_active_staff() THEN
    RAISE EXCEPTION 'Permission denied: active staff required';
  END IF;

  IF p_action NOT IN ('check_in','check_out') THEN
    RAISE EXCEPTION 'Invalid action: must be check_in or check_out';
  END IF;

  SELECT * INTO v_att
  FROM attendees
  WHERE attendees.registration_number = p_registration_number
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

REVOKE ALL ON FUNCTION process_scan_by_reg_no(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_scan_by_reg_no(text,text,text,text) TO authenticated;
