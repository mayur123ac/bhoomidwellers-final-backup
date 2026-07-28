-- ═══════════════════════════════════════════════════════════════════════════
-- NEON SYNC — Channel Partner commission layer (Phases 1, 1b, 2, 2b)
-- Date: 2026-07-25
--
-- Brings Neon to parity with local `bhoomiBackup_crm`. Run top to bottom.
-- Every statement is idempotent: safe to re-run, safe if objects already exist.
--
-- PART A  schema      (safe, additive, no data touched)
-- PART B  data        (creates partners + attributes leads/bookings)
-- PART C  verification
--
-- Written as the FINAL state, not as a replay of local's migration history:
-- cp_commissions is created with the partial unique index directly rather than
-- creating a blanket UNIQUE and dropping it again.
--
-- Does not touch disbursement_tranches or any existing column on
-- booking_applications / walkin_enquiries. Additive only.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART A — SCHEMA                                                         ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ── A1. shared updated_at trigger function ────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── A2. channel partner master ────────────────────────────────────────────
-- default_commission_rate is NULLABLE by design: a partner discovered from lead
-- intake legitimately exists before their commercial rate is negotiated.
-- computeCPCommission hard-rejects a NULL rate rather than defaulting to 0.
CREATE TABLE IF NOT EXISTS channel_partners (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    rera_registration_no VARCHAR(100),
    pan_number VARCHAR(20),
    phone VARCHAR(20),
    email VARCHAR(255),
    bank_account_details JSONB,
    default_commission_rate NUMERIC(5,2)
        CHECK (default_commission_rate >= 0 AND default_commission_rate <= 100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- If an earlier partial apply created this NOT NULL, relax it.
ALTER TABLE channel_partners ALTER COLUMN default_commission_rate DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_channel_partners_status
    ON channel_partners(status);

-- Expression indexes backing find-or-create. The phone/name columns themselves
-- are untouched — no stored data is rewritten and no normalization pass is needed.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
    ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_channel_partners_name_norm
    ON channel_partners (
        btrim(regexp_replace(
            lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
            '[[:punct:]]+$', ''))
    );

DROP TRIGGER IF EXISTS trg_channel_partners_updated_at ON channel_partners;
CREATE TRIGGER trg_channel_partners_updated_at
BEFORE UPDATE ON channel_partners
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── A3. CP attribution on leads and bookings ──────────────────────────────
-- Both nullable: most leads/bookings are direct, with no CP involved.
ALTER TABLE walkin_enquiries
    ADD COLUMN IF NOT EXISTS channel_partner_id INT REFERENCES channel_partners(id);

CREATE INDEX IF NOT EXISTS idx_walkin_enquiries_cp
    ON walkin_enquiries(channel_partner_id);

ALTER TABLE booking_applications
    ADD COLUMN IF NOT EXISTS sourced_by_channel_partner_id INT REFERENCES channel_partners(id);

CREATE INDEX IF NOT EXISTS idx_booking_applications_cp
    ON booking_applications(sourced_by_channel_partner_id);


-- ── A4. commission ledger ─────────────────────────────────────────────────
-- NOTE: booking_id is deliberately NOT declared UNIQUE here. Uniqueness is
-- enforced by the partial index below, which applies only to non-reversed rows,
-- so a booking can keep a full history of reversed commissions plus at most one
-- active one. A blanket UNIQUE would make reversal terminal — a booking reversed
-- for a wrong rate could never be recomputed.
CREATE TABLE IF NOT EXISTS cp_commissions (
    id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL REFERENCES booking_applications(id),
    channel_partner_id INT NOT NULL REFERENCES channel_partners(id),

    agreement_value NUMERIC(14,2) NOT NULL,
    commission_rate_percent NUMERIC(5,2) NOT NULL,
    gross_commission_amount NUMERIC(14,2) NOT NULL,

    tds_percent NUMERIC(5,2) NOT NULL DEFAULT 2,
    tds_amount NUMERIC(14,2) NOT NULL,
    net_payable_amount NUMERIC(14,2) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'accrued'
        CHECK (status IN ('accrued', 'due', 'paid', 'reversed')),

    due_date DATE,
    paid_date DATE,
    payment_reference VARCHAR(255),

    reversal_reason TEXT,
    reversed_at TIMESTAMP,

    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),

    -- Enforces the gross -> TDS -> net chain at the DB level so a bad
    -- application-layer calculation cannot silently corrupt the payable amount.
    CONSTRAINT chk_cp_commission_math CHECK (
        tds_amount = ROUND(gross_commission_amount * tds_percent / 100, 2)
        AND net_payable_amount = gross_commission_amount - tds_amount
    )
);

-- Drops the blanket constraint if a previous run created it.
ALTER TABLE cp_commissions DROP CONSTRAINT IF EXISTS cp_commissions_booking_id_key;

-- One ACTIVE commission per booking; unlimited reversed history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_commissions_booking_active
    ON cp_commissions(booking_id)
    WHERE status <> 'reversed';

CREATE INDEX IF NOT EXISTS idx_cp_commissions_channel_partner ON cp_commissions(channel_partner_id);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_status          ON cp_commissions(status);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_booking         ON cp_commissions(booking_id);

DROP TRIGGER IF EXISTS trg_cp_commissions_updated_at ON cp_commissions;
CREATE TRIGGER trg_cp_commissions_updated_at
BEFORE UPDATE ON cp_commissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART B — DATA                                                           ║
-- ║                                                                         ║
-- ║ Mirrors findOrCreateChannelPartner exactly:                             ║
-- ║   • only source 'CP' and 'Channel Partner' are CP sources. Every other   ║
-- ║     source also populates cp_name, but with sub-source labels            ║
-- ║     ("Hoarding", "Social Media") that must never become partners.        ║
-- ║   • a usable phone (>= 10 digits) is the identity and takes priority;    ║
-- ║     it never falls back to name matching.                               ║
-- ║   • otherwise match on normalized name (lowercased, whitespace           ║
-- ║     collapsed, trailing punctuation stripped).                          ║
-- ║   • label values like "Channel Partner" / "CP" / "N/A" are not           ║
-- ║     identities and are left unattributed.                               ║
-- ║   • never overwrites name/company on an existing match.                 ║
-- ║                                                                         ║
-- ║ Re-runnable: rows already attributed are skipped, not duplicated.        ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

BEGIN;

-- ── B1. create partners for phone-bearing CP leads (high confidence) ──────
INSERT INTO channel_partners (name, company_name, phone, default_commission_rate, created_by, updated_by)
SELECT DISTINCT ON (right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10))
       CASE
         WHEN btrim(regexp_replace(lower(regexp_replace(btrim(COALESCE(w.cp_name,'')), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
              IN ('channel partner','cp','n/a','na','none','nil','-','--')
           THEN COALESCE(NULLIF(btrim(w.cp_company), ''), 'Unnamed CP')
         ELSE COALESCE(NULLIF(btrim(w.cp_name), ''), NULLIF(btrim(w.cp_company), ''), 'Unnamed CP')
       END,
       NULLIF(btrim(w.cp_company), ''),
       btrim(w.cp_phone),
       NULL,
       'neon-sync', 'neon-sync'
  FROM walkin_enquiries w
 WHERE w.source IN ('CP', 'Channel Partner')
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) >= 10
   AND NOT EXISTS (
        SELECT 1 FROM channel_partners cp
         WHERE right(regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g'), 10)
             = right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10)
       )
 ORDER BY right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10), w.id ASC;


-- ── B2. create partners for phone-less CP leads (name-keyed) ──────────────
-- Runs after B1 so name matching can also see the phone-created partners.
INSERT INTO channel_partners (name, company_name, phone, default_commission_rate, created_by, updated_by)
SELECT DISTINCT ON (btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$','')))
       btrim(w.cp_name),
       NULLIF(btrim(w.cp_company), ''),
       NULL,
       NULL,
       'neon-sync', 'neon-sync'
  FROM walkin_enquiries w
 WHERE w.source IN ('CP', 'Channel Partner')
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) < 10
   AND btrim(COALESCE(w.cp_name, '')) <> ''
   AND btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       NOT IN ('channel partner','cp','n/a','na','none','nil','-','--')
   AND NOT EXISTS (
        SELECT 1 FROM channel_partners cp
         WHERE btrim(regexp_replace(lower(regexp_replace(btrim(cp.name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
             = btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       )
 ORDER BY btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$','')), w.id ASC;


-- ── B3. attribute leads — phone branch (takes priority) ───────────────────
UPDATE walkin_enquiries w
   SET channel_partner_id = cp.id
  FROM channel_partners cp
 WHERE w.source IN ('CP', 'Channel Partner')
   AND w.channel_partner_id IS NULL
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) >= 10
   AND right(regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g'), 10)
     = right(regexp_replace(w.cp_phone, '\D', '', 'g'), 10);


-- ── B4. attribute leads — name branch (phone-less only) ───────────────────
UPDATE walkin_enquiries w
   SET channel_partner_id = cp.id
  FROM channel_partners cp
 WHERE w.source IN ('CP', 'Channel Partner')
   AND w.channel_partner_id IS NULL
   AND length(regexp_replace(COALESCE(w.cp_phone, ''), '\D', '', 'g')) < 10
   AND btrim(COALESCE(w.cp_name, '')) <> ''
   AND btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
       NOT IN ('channel partner','cp','n/a','na','none','nil','-','--')
   AND btrim(regexp_replace(lower(regexp_replace(btrim(cp.name), '\s+', ' ', 'g')), '[[:punct:]]+$',''))
     = btrim(regexp_replace(lower(regexp_replace(btrim(w.cp_name), '\s+', ' ', 'g')), '[[:punct:]]+$',''));


-- ── B5. backfill bookings from their source lead ──────────────────────────
-- Gap-fill only: never clobbers attribution already set some other way.
UPDATE booking_applications b
   SET sourced_by_channel_partner_id = w.channel_partner_id
  FROM walkin_enquiries w
 WHERE b.lead_id = w.id
   AND w.channel_partner_id IS NOT NULL
   AND b.sourced_by_channel_partner_id IS NULL;

COMMIT;


-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ PART C — VERIFICATION (read-only, run and eyeball)                      ║
-- ╚═════════════════════════════════════════════════════════════════════════╝

-- C1. Partners created, with how many leads each absorbed.
SELECT cp.id, cp.name, cp.phone, cp.company_name, cp.default_commission_rate AS rate,
       COUNT(w.id) AS leads
  FROM channel_partners cp
  LEFT JOIN walkin_enquiries w ON w.channel_partner_id = cp.id
 GROUP BY cp.id, cp.name, cp.phone, cp.company_name, cp.default_commission_rate
 ORDER BY cp.id;

-- C2. Totals.
SELECT (SELECT COUNT(*) FROM channel_partners)                                              AS partners,
       (SELECT COUNT(*) FROM channel_partners WHERE default_commission_rate IS NULL)         AS needing_rate,
       (SELECT COUNT(*) FROM walkin_enquiries WHERE source IN ('CP','Channel Partner'))      AS cp_leads,
       (SELECT COUNT(*) FROM walkin_enquiries WHERE channel_partner_id IS NOT NULL)          AS leads_attributed,
       (SELECT COUNT(*) FROM booking_applications WHERE sourced_by_channel_partner_id IS NOT NULL) AS bookings_attributed;

-- C3. CP leads left unattributed — expected only where cp_name is a label
--     ("Channel Partner", "CP") or blank. Anything else here is a surprise.
SELECT id, name, phone, source, cp_name, cp_phone
  FROM walkin_enquiries
 WHERE source IN ('CP','Channel Partner')
   AND channel_partner_id IS NULL
 ORDER BY id;

-- C4. Leak check — MUST return zero rows. Non-CP sources must never be attributed.
SELECT id, source, cp_name, channel_partner_id
  FROM walkin_enquiries
 WHERE source NOT IN ('CP','Channel Partner')
   AND channel_partner_id IS NOT NULL;

-- C5. Backfilled bookings vs the booking form's own CP text — cross-check that
--     the attribution looks right before trusting it.
SELECT b.id AS booking, b.booking_number, b.lead_id,
       cp.name AS attributed_cp,
       b.channel_partner_name AS booking_form_says,
       b.booking_source
  FROM booking_applications b
  JOIN channel_partners cp ON cp.id = b.sourced_by_channel_partner_id
 ORDER BY b.id;

-- C6. Schema confirmation.
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename IN ('channel_partners','cp_commissions','walkin_enquiries','booking_applications')
   AND (indexname LIKE '%cp%' OR indexname LIKE '%channel_partner%')
 ORDER BY indexname;

-- Expect exactly one row: YES.
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'channel_partners'
   AND column_name = 'default_commission_rate';

-- Expect the partial index, and NO constraint named cp_commissions_booking_id_key.
SELECT indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_cp_commissions_booking_active';
