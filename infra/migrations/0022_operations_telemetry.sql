-- 0022 — what the kiosk tells the hospital about itself.
--
-- Everything monitored so far is derivable from clinical tables: queue depth, token
-- failures, reconciliation items. The things that are not are the ones only the device
-- knows — it crashed, the printer is out of paper, the network went away mid-upload.

-- Up Migration

CREATE TABLE device_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_device_id uuid NOT NULL REFERENCES kiosk_device (id) ON DELETE CASCADE,

  -- What happened. Deliberately a closed set: a free-text kind becomes a dozen spellings
  -- of the same fault and an alert rule that matches none of them.
  kind text NOT NULL CHECK (kind IN (
    'APP_CRASH',
    'APP_STARTED',
    'NETWORK_LOST',
    'NETWORK_RESTORED',
    'UPLOAD_FAILED',
    'PRINTER_FAULT',
    'PRINTER_OK',
    'SCANNER_FAULT',
    'LOCKDOWN_DEGRADED'
  )),

  -- Operational detail only: an exception type, an HTTP status, a printer status code.
  -- Never clinical content and never an identifier — a crash report from a kiosk must not
  -- become a way to learn who was standing in front of it. `redact()` is applied by the
  -- caller before this is written.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- The session this happened during, when there was one. Nullable, because a crash on an
  -- idle kiosk is exactly the kind worth knowing about.
  kiosk_session_id uuid REFERENCES kiosk_session (id) ON DELETE SET NULL,

  occurred_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL
);

-- The query every alert rule runs: recent events of a kind, per device.
CREATE INDEX device_event_recent_idx ON device_event (kiosk_device_id, kind, occurred_at DESC);
CREATE INDEX device_event_occurred_idx ON device_event (occurred_at DESC);

-- Down Migration

DROP INDEX IF EXISTS device_event_occurred_idx;
DROP INDEX IF EXISTS device_event_recent_idx;
DROP TABLE IF EXISTS device_event;
