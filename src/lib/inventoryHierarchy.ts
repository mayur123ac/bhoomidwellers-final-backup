// lib/inventoryHierarchy.ts
// Resolve (or create) the inventory_projects / inventory_towers rows for a unit.
//
// WHY THIS EXISTS
// The Sell.Do-parity migration backfilled project_id / tower_id onto every unit
// that existed when it ran. But the three code paths that CREATE units —
// POST /api/inventory, bulk-generate, and syncBookingUnit — all insert only the
// free-text project_name/tower. Without this helper every new unit would land
// with project_id NULL, and the cost-sheet route (which resolves a price rule via
// project_id) would refuse it with "not linked to a project". The backfill would
// have looked like a success while the feature quietly died on new stock.
//
// The name strings remain authoritative for the booking↔unit match in
// inventorySync.ts. This adds the FK alongside; it never rewrites the strings.
import type { PoolClient } from "pg";

export interface HierarchyIds {
  projectId: number | null;
  towerId: number | null;
}

/**
 * Find, or create, the project/tower pair for a (project_name, tower) string
 * pair. Runs on the caller's client so it commits or rolls back with the unit
 * insert — a unit must never reference a project that got rolled back.
 *
 * Matching is case/space-insensitive, mirroring the unique indexes, so "Malad "
 * and "malad" resolve to the existing "Malad" rather than forking a third row.
 *
 * `allowCreate: false` is for callers that should only ever attach to a project
 * a human already defined (the UI's dropdown path). Booking sync passes true —
 * it has to be able to absorb a flat for a project nobody set up yet, exactly as
 * it already auto-creates the unit itself.
 */
export async function resolveHierarchy(
  client: PoolClient,
  projectName: string | null | undefined,
  towerName: string | null | undefined,
  actor: string | null,
  opts?: { allowCreate?: boolean },
): Promise<HierarchyIds> {
  const allowCreate = opts?.allowCreate !== false;
  const project = String(projectName ?? "").trim();
  const tower = String(towerName ?? "").trim();

  if (!project) return { projectId: null, towerId: null };

  let projectId: number | null = null;

  const foundProject = await client.query(
    `SELECT id FROM inventory_projects
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND deleted_at IS NULL
      LIMIT 1`,
    [project],
  );
  if (foundProject.rows.length) {
    projectId = foundProject.rows[0].id;
  } else if (allowCreate) {
    // ON CONFLICT DO NOTHING + re-select rather than a bare INSERT: two units in
    // the same batch (or two concurrent requests) can race to create the same
    // project, and the unique index would turn the loser into a 23505 that
    // aborts an otherwise valid bulk generate.
    const ins = await client.query(
      `INSERT INTO inventory_projects (name, created_by, updated_by)
       VALUES ($1, $2, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [project, actor || "system"],
    );
    if (ins.rows.length) {
      projectId = ins.rows[0].id;
    } else {
      const again = await client.query(
        `SELECT id FROM inventory_projects
          WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND deleted_at IS NULL LIMIT 1`,
        [project],
      );
      projectId = again.rows[0]?.id ?? null;
    }
  }

  if (!projectId || !tower) return { projectId, towerId: null };

  let towerId: number | null = null;

  const foundTower = await client.query(
    `SELECT id FROM inventory_towers
      WHERE project_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND deleted_at IS NULL
      LIMIT 1`,
    [projectId, tower],
  );
  if (foundTower.rows.length) {
    towerId = foundTower.rows[0].id;
  } else if (allowCreate) {
    const ins = await client.query(
      `INSERT INTO inventory_towers (project_id, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [projectId, tower, actor || "system"],
    );
    if (ins.rows.length) {
      towerId = ins.rows[0].id;
    } else {
      const again = await client.query(
        `SELECT id FROM inventory_towers
          WHERE project_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND deleted_at IS NULL LIMIT 1`,
        [projectId, tower],
      );
      towerId = again.rows[0]?.id ?? null;
    }
  }

  return { projectId, towerId };
}
