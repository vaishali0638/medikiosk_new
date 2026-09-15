-- 0025 — tell the doctor console that the worklist changed, without telling it anything else.
--
-- The console polled. A doctor watching for their next patient either refreshed by hand or
-- waited out the interval, and in an OPD where the queue turns over every few minutes that
-- is the difference between a screen you trust and one you re-check.
--
-- THE PAYLOAD CARRIES NO PATIENT DATA, deliberately. A NOTIFY payload is readable by any
-- session that can LISTEN on the channel — it is not access-controlled, and it appears in
-- the wire protocol. So this says only "something changed in this department", and the
-- console re-fetches through the normal authenticated, department-scoped endpoint. The
-- notification is a nudge; the authorisation stays exactly where it already is.
--
-- Postgres caps a payload at 8000 bytes and drops the notification if a transaction rolls
-- back, which is the behaviour wanted here: a change that did not commit is not a change.

-- Up Migration

CREATE OR REPLACE FUNCTION notify_worklist_changed() RETURNS trigger AS $$
DECLARE
  payload text;
BEGIN
  -- Department and branch only. Enough for a listener to decide whether it cares, and
  -- nothing that identifies a patient.
  SELECT json_build_object(
           'departmentId', COALESCE(NEW.department_id, OLD.department_id),
           'hospitalId', b.hospital_id
         )::text
    INTO payload
    FROM department d
    JOIN branch b ON b.id = d.branch_id
   WHERE d.id = COALESCE(NEW.department_id, OLD.department_id);

  IF payload IS NOT NULL THEN
    PERFORM pg_notify('medikiosk_worklist', payload);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- AFTER, and FOR EACH ROW: the notification must describe something that happened, and a
-- statement-level trigger cannot name the department.
CREATE TRIGGER encounter_worklist_changed
  AFTER INSERT OR UPDATE OR DELETE ON encounter
  FOR EACH ROW EXECUTE FUNCTION notify_worklist_changed();

-- Down Migration

DROP TRIGGER IF EXISTS encounter_worklist_changed ON encounter;
DROP FUNCTION IF EXISTS notify_worklist_changed();
