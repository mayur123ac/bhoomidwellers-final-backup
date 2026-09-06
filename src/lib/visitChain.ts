// lib/visitChain.ts
//
// Server-side visit-chain utilities. Callers must pre-authenticate and
// pre-authorise before calling these helpers — no auth is performed here.
//
// The chain is derived entirely from walkin_enquiries.returning_from_lead_id.
// No new tables, no manually maintained counters.
//
// Safety guarantees on every traversal:
//   - Cycle detection: visited_ids array prevents infinite loops
//   - Cross-org guard:  organization_id predicate on every recursive step
//   - Depth cap:        maxDepth (default 50) hard-limits recursion
//   - Missing parent:   CTE naturally stops when the join finds no row
import { query } from "@/lib/db";

export interface VisitChainEntry {
  leadId: number;
  srNo: number | null;
  visitNumber: number;
  createdAt: string;
  assignedTo: string | null;
  status: string | null;
  leadClassification: string;
}

export interface VisitChainResult {
  totalVisits: number;
  revisitCount: number;
  currentVisitNumber: number;
  visits: VisitChainEntry[];   // ordered: oldest (visit 1) first
}

/**
 * Walk backward from a single lead through returning_from_lead_id to build
 * the full visit chain. Returns entries sorted oldest → newest.
 *
 * The queried lead is always the LAST entry (currentVisitNumber = totalVisits).
 *
 * If zero rows are returned (lead not found or chain broken at the first step),
 * returns a minimal single-visit result with an empty visits array — the caller
 * should treat the queried lead itself as visit 1.
 */
export async function getLeadVisitChain(
  leadId: number,
  orgId: string,
  maxDepth = 50
): Promise<VisitChainResult> {
  // Walk BACKWARD from the queried lead.
  // depth=1 means the queried lead itself. Larger depth = older ancestor.
  // ORDER BY depth DESC → root (highest depth) comes first → visitNumber 1.
  const rows = await query<{
    chain_lead_id: number;
    sr_no: number | null;
    created_at: string;
    assigned_to: string | null;
    status: string | null;
    lead_classification: string;
    returning_from_lead_id: number | null;
    depth: number;
  }>(
    `WITH RECURSIVE visit_chain AS (
       -- Anchor: the queried lead itself
       SELECT
         id                      AS chain_lead_id,
         sr_no,
         created_at,
         assigned_to,
         status,
         lead_classification,
         returning_from_lead_id,
         1                       AS depth,
         ARRAY[id]               AS visited_ids
       FROM walkin_enquiries
       WHERE id = $1 AND organization_id = $2

       UNION ALL

       -- Recursive: follow returning_from_lead_id toward the root
       SELECT
         parent.id,
         parent.sr_no,
         parent.created_at,
         parent.assigned_to,
         parent.status,
         parent.lead_classification,
         parent.returning_from_lead_id,
         vc.depth + 1,
         vc.visited_ids || parent.id
       FROM walkin_enquiries parent
       JOIN visit_chain vc ON parent.id = vc.returning_from_lead_id
       WHERE parent.organization_id = $2        -- cross-org guard
         AND vc.depth < $3                      -- depth cap
         AND NOT parent.id = ANY(vc.visited_ids) -- cycle guard
     )
     SELECT * FROM visit_chain ORDER BY depth DESC`,
    [leadId, orgId, maxDepth]
  );

  if (rows.length === 0) {
    // Lead not found in this org, or anchor query returned nothing.
    return {
      totalVisits: 1,
      revisitCount: 0,
      currentVisitNumber: 1,
      visits: [],
    };
  }

  // After ORDER BY depth DESC:
  //   rows[0]             = root ancestor (depth = highest) → visitNumber 1
  //   rows[rows.length-1] = the queried lead (depth = 1)    → visitNumber N
  //
  // Truncation check: if the root-most row still has a returning_from_lead_id
  // it means we stopped because of the depth cap, not because we reached the
  // real root. Log a warning — callers still get a valid partial chain.
  const rootRow = rows[0];
  if (rootRow.returning_from_lead_id !== null) {
    console.warn(
      `[visitChain] Chain truncated at maxDepth=${maxDepth} for lead ${leadId}. ` +
        `Root entry (id=${rootRow.chain_lead_id}) still has parent ${rootRow.returning_from_lead_id}.`
    );
  }

  const totalVisits = rows.length;
  const visits: VisitChainEntry[] = rows.map((row, idx) => ({
    leadId: row.chain_lead_id,
    srNo: row.sr_no ?? null,
    visitNumber: idx + 1,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date(row.created_at).toISOString(),
    assignedTo: row.assigned_to ?? null,
    status: row.status ?? null,
    leadClassification: row.lead_classification ?? "UNIQUE",
  }));

  const revisitCount = visits.filter(
    (v) => v.leadClassification === "RETURNING_LEAD"
  ).length;

  return {
    totalVisits,
    revisitCount,
    currentVisitNumber: totalVisits,
    visits,
  };
}

/**
 * Batch-compute visit depths for a list of lead IDs in a SINGLE recursive CTE
 * query. Returns Map<leadId, visitNumber>.
 *
 * visitNumber for a lead = how many hops back from that lead to the chain root
 * + 1 (so root = 1, its first revisit = 2, etc.).
 *
 * Leads absent from the result were not found in the org; callers should
 * default them to visitNumber = 1.
 */
export async function batchGetVisitDepths(
  leadIds: number[],
  orgId: string,
  maxDepth = 50
): Promise<Map<number, number>> {
  if (leadIds.length === 0) return new Map();

  const rows = await query<{ lead_id: number; visit_number: number }>(
    `WITH RECURSIVE visit_chain AS (
       -- Anchors: all requested leads
       SELECT
         id        AS anchor_id,
         id        AS cur_id,
         returning_from_lead_id,
         1         AS depth,
         ARRAY[id] AS visited
       FROM walkin_enquiries
       WHERE id = ANY($1) AND organization_id = $2

       UNION ALL

       -- Walk toward the root for each anchor simultaneously
       SELECT
         vc.anchor_id,
         parent.id,
         parent.returning_from_lead_id,
         vc.depth + 1,
         vc.visited || parent.id
       FROM walkin_enquiries parent
       JOIN visit_chain vc ON parent.id = vc.returning_from_lead_id
       WHERE parent.organization_id = $2        -- cross-org guard
         AND vc.depth < $3                      -- depth cap
         AND NOT parent.id = ANY(vc.visited)    -- cycle guard
     )
     SELECT anchor_id AS lead_id, MAX(depth) AS visit_number
     FROM visit_chain
     GROUP BY anchor_id`,
    [leadIds, orgId, maxDepth]
  );

  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(Number(row.lead_id), Number(row.visit_number));
  }
  return map;
}
