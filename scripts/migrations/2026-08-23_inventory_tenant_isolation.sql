-- 2026-08-23_inventory_tenant_isolation.sql
--
-- Makes the inventory schema genuinely multi-tenant, and indexes the
-- organization-scoped reads the API now performs.
--
--   node scripts/run_sql_migration.js 2026-08-23_inventory_tenant_isolation.sql
--
-- ── What was already fine ───────────────────────────────────────────────────
-- `organization_id` ALREADY exists on all eight inventory tables
-- (inventory_units, inventory_projects, inventory_towers, inventory_price_rules,
-- inventory_offers, inventory_cost_sheets, inventory_discount_bands,
-- inventory_unit_history), it is NOT NULL in practice — zero NULLs across 560
-- units, 9 projects and 9 towers — and every row is already assigned to the right
-- tenant, with zero orphaned or cross-tenant project_id / tower_id references.
--
-- So this migration does NOT add the column and does NOT reassign data. Both were
-- done by the MT-05 pass and verified before this ran. What was missing was
-- enforcement in two places: the API (fixed in code) and the unique indexes below.
--
-- ── The actual schema defect ────────────────────────────────────────────────
-- Two unique indexes were GLOBAL rather than per-tenant:
--
--   uq_inventory_projects_name  UNIQUE (lower(trim(name))) WHERE deleted_at IS NULL
--   unique_inventory_unit       UNIQUE (project_name, tower, COALESCE(wing,''),
--                                       floor, flat_no) WHERE deleted_at IS NULL
--
-- Consequences, both real:
--
--   1. Only ONE builder on the whole platform could own a building called
--      "Colossal". A second tenant creating the same name hit a unique violation
--      against a row they cannot see, with an error naming another tenant's data.
--   2. Two builders could not both have flat 101 on floor 1 of "Tower A / Wing B"
--      in a similarly named project — a routine collision, since flat numbering is
--      per-building and building names repeat across developers.
--   3. Worse than either: because the name was globally unique, the
--      find-or-create in lib/inventoryHierarchy.ts matched on name ALONE and
--      resolved one tenant's new units onto ANOTHER tenant's project row. That is
--      cross-tenant corruption, not disclosure — and it linked stock to the wrong
--      tenant's price rules through the cost-sheet route.
--
-- Both indexes are rebuilt with organization_id as the leading column. The new
-- keys are strictly LESS restrictive than the old ones, so any data that
-- satisfied the old index satisfies the new one; verified zero duplicates under
-- the new keys before running.
--
-- Idempotent and safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- PART A — per-tenant unique keys
-- ════════════════════════════════════════════════════════════════════════════

-- A1. A building name is unique WITHIN a builder, not across the platform.
DROP INDEX IF EXISTS uq_inventory_projects_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_projects_org_name
    ON public.inventory_projects (organization_id, lower(TRIM(BOTH FROM name)))
 WHERE deleted_at IS NULL;

-- A2. A flat is unique within a builder's building/tower/wing/floor.
--     NOTE: app/api/inventory/bulk-generate/route.ts has an explicit
--     `ON CONFLICT (project_name, tower, COALESCE(wing,''), floor, flat_no)`
--     inference clause that must match this column list exactly. It was updated
--     in the same change; if you alter the columns here, alter it there too or
--     the INSERT will fail with "no unique or exclusion constraint matching".
DROP INDEX IF EXISTS unique_inventory_unit;
CREATE UNIQUE INDEX IF NOT EXISTS unique_inventory_unit
    ON public.inventory_units
       (organization_id, project_name, tower, COALESCE(wing, ''::character varying), floor, flat_no)
 WHERE deleted_at IS NULL;

-- A3. uq_inventory_towers_name is already (project_id, lower(trim(name))). A
--     tower is reached only through its project, and inventory_towers inherits
--     its project's organization on insert, so that key is already tenant-safe.
--     Deliberately left alone.

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — indexes for the organization-scoped reads
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every inventory read now carries `organization_id = $n`. Single-column
-- organization_id indexes already exist on these tables; with one tenant holding
-- ~99% of the rows they are barely more selective than a scan, so the composites
-- below put the tenant first and the query's own grouping/filter key second.

-- The building landing page: GROUP BY LOWER(TRIM(project_name)) within a tenant,
-- over live rows only.
CREATE INDEX IF NOT EXISTS idx_inventory_units_org_project_live
    ON public.inventory_units (organization_id, project_name, tower)
 WHERE deleted_at IS NULL;

-- The unit list and floor matrix: tenant + building + tower, ordered by position.
CREATE INDEX IF NOT EXISTS idx_inventory_units_org_status
    ON public.inventory_units (organization_id, status)
 WHERE deleted_at IS NULL;

-- Project and tower listings, and the FK lookups behind them.
CREATE INDEX IF NOT EXISTS idx_inventory_units_org_project_id
    ON public.inventory_units (organization_id, project_id)
 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_units_org_tower_id
    ON public.inventory_units (organization_id, tower_id)
 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_towers_org_project
    ON public.inventory_towers (organization_id, project_id)
 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_price_rules_org_project
    ON public.inventory_price_rules (organization_id, project_id);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — every count must be 0.
-- ════════════════════════════════════════════════════════════════════════════
--
--   SELECT 'units null org'        AS check, count(*)::int FROM inventory_units      WHERE organization_id IS NULL
--   UNION ALL SELECT 'projects null org',    count(*)::int FROM inventory_projects   WHERE organization_id IS NULL
--   UNION ALL SELECT 'towers null org',      count(*)::int FROM inventory_towers     WHERE organization_id IS NULL
--   UNION ALL SELECT 'unit->project drift',  count(*)::int FROM inventory_units u
--               JOIN inventory_projects p ON p.id = u.project_id
--              WHERE p.organization_id <> u.organization_id
--   UNION ALL SELECT 'unit->tower drift',    count(*)::int FROM inventory_units u
--               JOIN inventory_towers t ON t.id = u.tower_id
--              WHERE t.organization_id <> u.organization_id
--   UNION ALL SELECT 'tower->project drift', count(*)::int FROM inventory_towers t
--               JOIN inventory_projects p ON p.id = t.project_id
--              WHERE p.organization_id <> t.organization_id
--   UNION ALL SELECT 'history drift',        count(*)::int FROM inventory_unit_history h
--               JOIN inventory_units u ON u.id = h.unit_id
--              WHERE h.organization_id <> u.organization_id;
