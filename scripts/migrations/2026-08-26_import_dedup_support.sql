-- ============================================================================
-- Phase 3: Dedup + Merge support for the staged import pipeline
-- Adds dedup metadata columns to import_rows and performance indexes on
-- walkin_enquiries for candidate matching.
-- ============================================================================

-- 1. Dedup metadata on import_rows
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS match_confidence INTEGER;
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS match_reason VARCHAR(50);
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS user_override_action VARCHAR(20);
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS pre_update_snapshot JSONB;

-- user_override_action must be one of the valid proposed actions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'import_rows_user_override_action_check'
  ) THEN
    ALTER TABLE import_rows ADD CONSTRAINT import_rows_user_override_action_check
      CHECK (user_override_action IS NULL OR user_override_action IN ('create','update','skip','manual_review','error'));
  END IF;
END $$;

-- 2. Indexes on walkin_enquiries for dedup lookups
CREATE INDEX IF NOT EXISTS idx_walkin_phone_org
  ON walkin_enquiries (phone, organization_id)
  WHERE phone IS NOT NULL AND phone != '';

CREATE INDEX IF NOT EXISTS idx_walkin_extref_org
  ON walkin_enquiries (external_ref, organization_id)
  WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_walkin_alt_phone_org
  ON walkin_enquiries (alt_phone, organization_id)
  WHERE alt_phone IS NOT NULL AND alt_phone != '';
