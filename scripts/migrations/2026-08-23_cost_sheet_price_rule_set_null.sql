-- 2026-08-23_cost_sheet_price_rule_set_null.sql
--
-- Fixes: deleting a building fails with
--
--   update or delete on table "inventory_price_rules" violates foreign key
--   constraint "inventory_cost_sheets_price_rule_id_fkey" on table
--   "inventory_cost_sheets"
--
--   node scripts/run_sql_migration.js 2026-08-23_cost_sheet_price_rule_set_null.sql
--
-- ── Why the delete could never succeed ──────────────────────────────────────
-- DELETE /api/inventory/projects/[id] deliberately does NOT purge every unit.
-- A flat that a booking ever touched is ARCHIVED instead — soft-deleted and
-- detached from project_id / tower_id — so its inventory_unit_history and its
-- issued cost sheets survive as the record of a real transaction. Purged flats
-- take their cost sheets with them (inventory_cost_sheets.unit_id is ON DELETE
-- CASCADE); archived flats keep theirs.
--
-- Deleting the project then cascades inventory_price_rules away
-- (inventory_price_rules.project_id is ON DELETE CASCADE). Every surviving cost
-- sheet of an archived flat still points at one of those rules through
-- price_rule_id — and that FK was NO ACTION. So the cascade tried to remove a
-- rule a live cost sheet still referenced, and the whole delete aborted.
--
-- The two halves of the design are in direct conflict: deleting the project
-- REQUIRES its price rules to go, and archiving REQUIRES the cost sheets to
-- stay. Only one column can give, and it is the pointer between them.
--
-- Observed on production (ep-long-cloud) as exactly one row: cost sheet #2 on
-- unit #92 (flat B-1206, source 'booking_sync') pinning price rule #9 of
-- project #1 "Bhoomi dwellers". One archived flat with one issued quote was
-- enough to make a 118-unit building permanently undeletable.
--
-- ── Why SET NULL loses nothing ──────────────────────────────────────────────
-- Nothing reads through price_rule_id. Every number is stored on the sheet
-- itself — carpet area, base rate, floor rise, each premium and charge, both
-- tax rates — plus the full rendered line-item `breakdown` JSONB, precisely so
-- an issued sheet can explain its own arithmetic without consulting its rule.
-- app/api/inventory/[id]/cost-sheet/route.ts writes the column and never reads
-- it back, and no query in the codebase joins on it. It is provenance, and once
-- the rule is cascaded away the provenance is gone whatever the column says.
-- Clearing it keeps the quote intact and honest about what it can still cite.
--
-- The alternative — blocking the building delete whenever any archived flat
-- ever had a cost sheet issued — would trade a recoverable pointer for an
-- unusable feature.
--
-- Idempotent and safe to re-run.

BEGIN;

ALTER TABLE public.inventory_cost_sheets
    DROP CONSTRAINT IF EXISTS inventory_cost_sheets_price_rule_id_fkey;

ALTER TABLE public.inventory_cost_sheets
    ADD CONSTRAINT inventory_cost_sheets_price_rule_id_fkey
    FOREIGN KEY (price_rule_id)
    REFERENCES public.inventory_price_rules (id)
    ON DELETE SET NULL;

-- Fail loudly rather than reporting OK on a constraint that did not change.
-- confdeltype: 'n' = SET NULL, 'a' = NO ACTION, 'c' = CASCADE.
DO $$
DECLARE d "char";
BEGIN
    SELECT confdeltype INTO d FROM pg_constraint
     WHERE conname = 'inventory_cost_sheets_price_rule_id_fkey'
       AND conrelid = 'public.inventory_cost_sheets'::regclass;
    IF d IS DISTINCT FROM 'n' THEN
        RAISE EXCEPTION 'price_rule_id FK is %, expected n (SET NULL)', COALESCE(d::text, 'missing');
    END IF;
END $$;

COMMIT;
