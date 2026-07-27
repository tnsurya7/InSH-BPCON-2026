/*
# Migration 006a – Fix distinct category collection in import_attendees_batch

## Summary
The original SELECT DISTINCT ... INTO v_categories produced a scalar text
instead of an array, causing "malformed array literal". Replaced with
array_agg to properly collect distinct categories into a text[].
*/

CREATE OR REPLACE FUNCTION import_attendees_batch(
  p_file_name text,
  p_rows      jsonb
)
RETURNS TABLE(
  batch_id       uuid,
  imported_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id     uuid;
  v_row          jsonb;
  v_attendee_id  uuid;
  v_count        int := 0;
  v_categories   text[];
  v_cat          text;
BEGIN
  IF NOT is_active_staff('admin') AND NOT is_active_staff('registration') THEN
    RAISE EXCEPTION 'Permission denied: only admin or registration staff can import';
  END IF;

  INSERT INTO import_batches (file_name, row_count, imported_count, rejected_count)
  VALUES (p_file_name, jsonb_array_length(p_rows), 0, 0)
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO attendees (
      registration_number, name, category, phone_number, email, gender,
      food_preference, payment_status, registration_type,
      import_batch_id, attendance_status, created_by
    )
    VALUES (
      v_row->>'registration_number',
      v_row->>'name',
      v_row->>'category',
      NULLIF(v_row->>'phone_number', ''),
      NULLIF(v_row->>'email', ''),
      NULLIF(v_row->>'gender', ''),
      v_row->>'food_preference',
      v_row->>'payment_status',
      'pre_registered',
      v_batch_id,
      'not_checked_in',
      auth.uid()
    )
    RETURNING id INTO v_attendee_id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE import_batches
  SET imported_count = v_count,
      rejection_summary = jsonb_build_object('valid', v_count, 'rejected', 0)
  WHERE id = v_batch_id;

  -- Collect distinct categories into an array
  SELECT array_agg(DISTINCT (r->>'category'))
  INTO v_categories
  FROM jsonb_array_elements(p_rows) r;

  FOREACH v_cat IN ARRAY v_categories
  LOOP
    PERFORM advance_counter_for_category(v_cat);
  END LOOP;

  INSERT INTO audit_events (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'excel_import_completed', 'import_batch', v_batch_id,
    jsonb_build_object('file_name', p_file_name, 'imported_count', v_count));

  RETURN QUERY SELECT v_batch_id, v_count;
END;
$$;

REVOKE ALL ON FUNCTION import_attendees_batch(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_attendees_batch(text, jsonb) TO authenticated;
