-- Migration: Channel Partner (CP) master + commission ledger — Phase 1 (schema only)
-- Date: 2026-07-25
-- Purpose: Adds the CP commission tracking layer scoped to booking_applications.
--          Mirrors disbursement_tranches conventions: created_by/updated_by as
--          VARCHAR usernames (no FK), audit trail via reversal rather than delete,
--          and DB-level enforcement of the gross -> TDS -> net math so a bad
--          application-layer calculation cannot silently corrupt the payable amount.
--
-- Additive only. Does not touch disbursement_tranches or any existing
-- booking_applications column.
--
-- Written idempotent so it can be run safely against a database where an earlier
-- partial apply already created some objects.

BEGIN;

-- 1. Channel partner master ---------------------------------------------------

CREATE TABLE IF NOT EXISTS channel_partners (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    rera_registration_no VARCHAR(100),
    pan_number VARCHAR(20),
    phone VARCHAR(20),
    email VARCHAR(255),
    bank_account_details JSONB,
    default_commission_rate NUMERIC(5,2) NOT NULL
        CHECK (default_commission_rate >= 0 AND default_commission_rate <= 100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_partners_status ON channel_partners(status);

-- 2. CP attribution on bookings ------------------------------------------------
-- Nullable: most bookings are direct / no CP involved.

ALTER TABLE booking_applications
    ADD COLUMN IF NOT EXISTS sourced_by_channel_partner_id INT REFERENCES channel_partners(id);

CREATE INDEX IF NOT EXISTS idx_booking_applications_cp
    ON booking_applications(sourced_by_channel_partner_id);

-- 3. Commission ledger ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS cp_commissions (
    id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL UNIQUE REFERENCES booking_applications(id),
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

    CONSTRAINT chk_cp_commission_math CHECK (
        tds_amount = ROUND(gross_commission_amount * tds_percent / 100, 2)
        AND net_payable_amount = gross_commission_amount - tds_amount
    )
);

CREATE INDEX IF NOT EXISTS idx_cp_commissions_channel_partner ON cp_commissions(channel_partner_id);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_status ON cp_commissions(status);
CREATE INDEX IF NOT EXISTS idx_cp_commissions_booking ON cp_commissions(booking_id);

-- 4. updated_at trigger --------------------------------------------------------
-- No shared set_updated_at() existed in this database (disbursement_tranches and
-- inventory_units carry no triggers), so it is created here as the shared one.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channel_partners_updated_at ON channel_partners;
CREATE TRIGGER trg_channel_partners_updated_at
BEFORE UPDATE ON channel_partners
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_cp_commissions_updated_at ON cp_commissions;
CREATE TRIGGER trg_cp_commissions_updated_at
BEFORE UPDATE ON cp_commissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
