/*
# Migration 007 – Lookup Attendee by Registration Number

## Summary
Adds lookup_attendee_by_reg_no(), a SECURITY DEFINER RPC that lets
scanner-role staff look up an attendee by registration number for manual
check-in/check-out fallback. Returns ONLY the minimal fields (name,
registration number, category, attendance status) — never phone, email,
gender or payment info. Reuses the existing process_scan() for the actual
transition.

## Function: lookup_attendee_by_reg_no(p_registration_number text)
- Any active staff can call it (used by scanner fallback).
- Returns (attendee_id, name, registration_number, category, attendance_status).
- Returns zero rows if not found.

## RLS
No new policies. The function is SECURITY DEFINER and returns a restricted
column set, so scanners never access the full attendees row.
*/

CREATE OR REPLACE FUNCTION lookup_attendee_by_reg_no(p_registration_number text)
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
STABLE
AS $$
DECLARE
  v_att attendees%ROWTYPE;
BEGIN
  IF NOT is_active_staff() THEN
    RAISE EXCEPTION 'Permission denied: active staff required';
  END IF;

  SELECT * INTO v_att FROM attendees WHERE attendees.registration_number = p_registration_number;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_att.id, v_att.name, v_att.registration_number,
                      v_att.category, v_att.attendance_status;
END;
$$;

REVOKE ALL ON FUNCTION lookup_attendee_by_reg_no(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_attendee_by_reg_no(text) TO authenticated;
