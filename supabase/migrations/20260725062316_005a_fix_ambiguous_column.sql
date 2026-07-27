/*
# Migration 005a – Fix ambiguous column reference in create_spot_registration

## Summary
The create_spot_registration function had an ambiguous column reference
"attendee_id" that could resolve to either the PL/pgSQL variable
v_existing_id's assignment target or the spot_registration_keys.attendee_id
column. Qualifies the column explicitly to resolve the error.
*/

CREATE OR REPLACE FUNCTION create_spot_registration(
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name        text;
  v_phone       text;
  v_email       text;
  v_counter_key text;
  v_counter     registration_counters%ROWTYPE;
  v_reg_no      text;
  v_exists      boolean;
  v_qr_token    text;
  v_attendee_id uuid;
  v_existing_id uuid;
BEGIN
  IF NOT is_active_staff('registration') AND NOT is_active_staff('admin') THEN
    RAISE EXCEPTION 'Permission denied: only registration or admin staff can create spot registrations';
  END IF;

  -- Idempotency: serialise on the key, return existing result if present
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));
    SELECT spot_registration_keys.attendee_id INTO v_existing_id
    FROM spot_registration_keys
    WHERE spot_registration_keys.idempotency_key = p_idempotency_key
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT a.registration_number, a.qr_token, a.id
      FROM attendees a WHERE a.id = v_existing_id;
      RETURN;
    END IF;
  END IF;

  v_name := btrim(p_name);
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Delegate name is required';
  END IF;
  IF length(v_name) > 200 THEN
    RAISE EXCEPTION 'Delegate name is too long (maximum 200 characters)';
  END IF;

  IF p_category NOT IN ('Delegates','Faculty','Post Graduates','Under Graduates','Exhibitors') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  IF p_food_preference NOT IN ('Vegetarian','Non-Vegetarian','Not Specified') THEN
    RAISE EXCEPTION 'Invalid food preference';
  END IF;

  IF p_payment_status NOT IN ('Paid','Pending','Complimentary') THEN
    RAISE EXCEPTION 'Invalid payment status';
  END IF;

  v_email := NULL;
  IF p_email IS NOT NULL AND btrim(p_email) != '' THEN
    v_email := lower(btrim(p_email));
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Invalid email format';
    END IF;
  END IF;

  v_phone := NULL;
  IF p_phone_number IS NOT NULL AND btrim(p_phone_number) != '' THEN
    v_phone := btrim(p_phone_number);
    IF regexp_replace(v_phone, '\s', '', 'g') !~ '^(\+91)?[0-9]{10}$' THEN
      RAISE EXCEPTION 'Invalid phone number format';
    END IF;
  END IF;

  IF p_gender IS NOT NULL AND p_gender NOT IN ('Male','Female','Other','Prefer not to say') THEN
    RAISE EXCEPTION 'Invalid gender value';
  END IF;

  v_counter_key := CASE p_category
    WHEN 'Faculty'         THEN 'faculty_counter'
    WHEN 'Delegates'       THEN 'delegate_counter'
    WHEN 'Post Graduates'  THEN 'student_counter'
    WHEN 'Under Graduates' THEN 'student_counter'
    WHEN 'Exhibitors'      THEN 'exhibitor_counter'
  END;

  SELECT * INTO v_counter
  FROM registration_counters
  WHERE counter_key = v_counter_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration counter not found for category: %', p_category;
  END IF;

  IF v_counter.next_value IS NULL OR v_counter.start_value IS NULL THEN
    RAISE EXCEPTION 'Registration is not yet configured for category %. Please contact an administrator to set the starting registration number.', p_category;
  END IF;

  LOOP
    v_reg_no := v_counter.prefix || '-' || lpad(v_counter.next_value::text, v_counter.padding, '0');
    SELECT EXISTS(SELECT 1 FROM attendees WHERE registration_number = v_reg_no) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_counter.next_value := v_counter.next_value + 1;
  END LOOP;

  v_qr_token := gen_random_uuid()::text;

  INSERT INTO attendees (
    registration_number, name, category, phone_number, email, gender,
    food_preference, payment_status, registration_type, qr_token,
    attendance_status, created_by
  )
  VALUES (
    v_reg_no, v_name, p_category, v_phone, v_email, p_gender,
    p_food_preference, p_payment_status, 'spot', v_qr_token,
    'not_checked_in', auth.uid()
  )
  RETURNING id INTO v_attendee_id;

  UPDATE registration_counters
  SET next_value      = v_counter.next_value + 1,
      last_used_value = v_counter.next_value,
      updated_at      = now()
  WHERE counter_key = v_counter_key;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO spot_registration_keys (idempotency_key, attendee_id, created_by)
    VALUES (p_idempotency_key, v_attendee_id, auth.uid());
  END IF;

  INSERT INTO audit_events (actor_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'spot_registration_created', 'attendee', v_attendee_id,
    jsonb_build_object(
      'registration_number', v_reg_no,
      'category', p_category,
      'name', v_name
    ));

  RETURN QUERY SELECT v_reg_no, v_qr_token, v_attendee_id;
END;
$$;

REVOKE ALL ON FUNCTION create_spot_registration(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_spot_registration(text,text,text,text,text,text,text,text) TO authenticated;
