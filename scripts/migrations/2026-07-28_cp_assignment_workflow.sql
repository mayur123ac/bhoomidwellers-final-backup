-- Channel Partner assignment workflow.
-- Idempotent: safe to run more than once.

BEGIN;

ALTER TABLE channel_partners
  ADD COLUMN IF NOT EXISTS office_address TEXT,
  ADD COLUMN IF NOT EXISTS owner_contact_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100);

ALTER TABLE walkin_enquiries
  ADD COLUMN IF NOT EXISTS channel_partner_id INT,
  ADD COLUMN IF NOT EXISTS pin_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS preferred_location VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sourcing_manager_id INT,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sourcing_manager_assigned_by VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'channel_partner_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_channel_partner
      FOREIGN KEY (channel_partner_id) REFERENCES channel_partners(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'walkin_enquiries'::regclass
      AND c.contype = 'f'
      AND a.attname = 'sourcing_manager_id'
  ) THEN
    ALTER TABLE walkin_enquiries
      ADD CONSTRAINT fk_walkin_enquiries_sourcing_manager
      FOREIGN KEY (sourcing_manager_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_channel_partner
  ON walkin_enquiries(channel_partner_id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp_sourcing_manager
  ON walkin_enquiries(sourcing_manager_id)
  WHERE source IN ('CP', 'Channel Partner');

CREATE TABLE IF NOT EXISTS cp_assignment_history (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES walkin_enquiries(id) ON DELETE CASCADE,
  previous_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  new_sourcing_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name VARCHAR(255) NOT NULL,
  assigned_by_role VARCHAR(100),
  action VARCHAR(30) NOT NULL CHECK (action IN ('assigned', 'reassigned', 'cleared')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_lead
  ON cp_assignment_history(lead_id, assigned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_cp_assignment_history_new_manager
  ON cp_assignment_history(new_sourcing_manager_id, assigned_at DESC);

INSERT INTO cp_assignment_history (
  lead_id,
  previous_sourcing_manager_id,
  new_sourcing_manager_id,
  assigned_by_user_id,
  assigned_by_name,
  assigned_by_role,
  action,
  assigned_at
)
SELECT
  w.id,
  NULL,
  w.sourcing_manager_id,
  NULL,
  COALESCE(NULLIF(w.sourcing_manager_assigned_by, ''), 'System'),
  NULL,
  'assigned',
  COALESCE(w.sourcing_manager_assigned_at, w.created_at::timestamptz, now())
FROM walkin_enquiries w
WHERE w.source IN ('CP', 'Channel Partner')
  AND w.sourcing_manager_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM cp_assignment_history h
    WHERE h.lead_id = w.id
  );

COMMIT;
