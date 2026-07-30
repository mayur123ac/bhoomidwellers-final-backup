-- Pincode-driven auto-fill on the Channel Partner form.
--
-- Two lookups, deliberately two tables — they change for different reasons and
-- are maintained by different people:
--
--   pincodes                   pincode -> city. Reference data, effectively fixed.
--   sourcing_manager_pincodes  pincode -> Sourcing Manager. Territory ownership,
--                              edited whenever someone's patch changes.
--
-- Both are OPTIONAL inputs: a pincode with no row in either table simply means the
-- form auto-fills nothing and the operator types it themselves. Nothing breaks,
-- and nothing is blocked — the auto-fill is a convenience, not a validation.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ── 1. Pincode → City ──────────────────────────────────────────────────────
-- Only the columns the form actually consumes plus state/district for humans
-- reading the table later. Seeded below with the areas already in use; add rows
-- as new ones come up.
CREATE TABLE IF NOT EXISTS pincodes (
  pincode    VARCHAR(6) PRIMARY KEY,
  city       VARCHAR(100) NOT NULL,
  district   VARCHAR(100),
  state      VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Pincode → Sourcing Manager ──────────────────────────────────────────
-- UNIQUE on pincode, NOT on (pincode, user_id): the form needs one unambiguous
-- answer to "who owns 400097?". Allowing two managers per pincode would make the
-- auto-assign arbitrary, which is worse than forcing the decision here.
--
-- ON DELETE CASCADE because a territory row is meaningless once the employee is
-- gone — unlike channel_partners.assigned_sourcing_manager_id, which is SET NULL
-- so the partner survives.
CREATE TABLE IF NOT EXISTS sourcing_manager_pincodes (
  id         SERIAL PRIMARY KEY,
  pincode    VARCHAR(6) NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sourcing_manager_pincode UNIQUE (pincode)
);

-- "Which pincodes does this manager cover?" — the reverse lookup, for the day
-- someone builds a territory admin screen.
CREATE INDEX IF NOT EXISTS idx_smp_user ON sourcing_manager_pincodes(user_id);

-- ── 3. Seed: pincodes already appearing in this CRM ─────────────────────────
INSERT INTO pincodes (pincode, city, district, state) VALUES
  ('400097', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400064', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400095', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400101', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400063', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400092', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('400068', 'Mumbai', 'Mumbai Suburban', 'Maharashtra'),
  ('401107', 'Mira Road', 'Thane',           'Maharashtra'),
  ('400601', 'Thane',    'Thane',            'Maharashtra'),
  ('400607', 'Thane',    'Thane',            'Maharashtra'),
  ('411045', 'Pune',     'Pune',             'Maharashtra'),
  ('411057', 'Pune',     'Pune',             'Maharashtra')
ON CONFLICT (pincode) DO NOTHING;

-- ── 4. Territory assignments ───────────────────────────────────────────────
-- Left empty on purpose: who covers which pincode is a business decision, and a
-- guessed mapping would silently route partners to the wrong desk. Add rows like:
--
--   INSERT INTO sourcing_manager_pincodes (pincode, user_id, created_by)
--   VALUES ('400097', 7, 'admin')
--   ON CONFLICT (pincode) DO UPDATE
--     SET user_id = EXCLUDED.user_id, created_by = EXCLUDED.created_by;
--
-- user_id must be an ACTIVE user whose role is Sourcing Manager — the lookup
-- endpoint re-checks both, so a row pointing at anyone else is simply ignored.
-- Current Sourcing Managers:  SELECT id, name FROM users
--   WHERE is_active AND REPLACE(LOWER(TRIM(role)),'_',' ') = 'sourcing manager';

COMMIT;
