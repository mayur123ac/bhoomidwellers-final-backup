-- Migration: Phase 1b — allow channel_partners to exist before a rate is negotiated
-- Date: 2026-07-25
--
-- REQUIRED for Phase 1b. findOrCreateChannelPartner inserts partners discovered
-- from enquiry intake, where the form captures no commission rate at all. Phase 1
-- made default_commission_rate NOT NULL, so those inserts fail without this.
--
-- Making it nullable rather than defaulting to 0 is deliberate: a CP entity can
-- legitimately exist before their commercial rate is negotiated, and a stored 0
-- would be indistinguishable from a real negotiated zero. Phase 2's
-- computeCPCommission must hard-reject a NULL rate at booking time rather than
-- coercing it.
--
-- The existing range CHECK (>= 0 AND <= 100) needs no change: a CHECK passes on
-- NULL, so nullability and the range constraint coexist correctly.

BEGIN;

ALTER TABLE channel_partners
    ALTER COLUMN default_commission_rate DROP NOT NULL;

-- Supports the phone-matching branch of findOrCreateChannelPartner. Expression
-- index only — the phone column itself is left exactly as Phase 1 defined it, so
-- no stored data is rewritten and no normalization pass is needed.
CREATE INDEX IF NOT EXISTS idx_channel_partners_phone_norm
    ON channel_partners (right(regexp_replace(COALESCE(phone, ''), '\D', '', 'g'), 10));

-- Supports the normalized-name matching branch (the bulk-import path).
CREATE INDEX IF NOT EXISTS idx_channel_partners_name_norm
    ON channel_partners (
        btrim(
            regexp_replace(
                lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
                '[[:punct:]]+$', ''
            )
        )
    );

COMMIT;
