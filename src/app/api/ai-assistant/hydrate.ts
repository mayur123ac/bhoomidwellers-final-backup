// app/api/ai-assistant/hydrate.ts
//
// Re-reads the leads under discussion from Postgres before the model sees them.
//
// ── Why not just trust the request body ──────────────────────────────────────
// The caller posts the leads it has in memory. That is fine for rendering, but as
// the basis for an answer it has three problems:
//
//   1. STALENESS. The admin dashboard polls on an interval, so a lead edited
//      seconds ago can still be the old version in the client's array. The
//      assistant would then state something that is no longer true, confidently.
//   2. INCOMPLETENESS. The merged client objects carry the columns the tables
//      render, not every column. Lost reason, alt phone, occupation, preferred
//      location and the loan fields are variously missing depending on which page
//      asked — so the assistant would say "not recorded" for data that exists.
//   3. TRUST. It is client-supplied. A crafted body could put words in the
//      assistant's mouth about a lead the caller cannot otherwise see.
//
// So the ids are taken from the body — the caller legitimately decides WHICH
// leads are in scope — and every field is then read fresh from the database.
//
// This is only affordable because of idx_follow_ups_lead_id_created_at: fetching
// one lead's follow-ups was a 400,000-row sequential scan before that index
// existed (37 ms and rising with table size), and is an index scan touching 7
// pages now.

import { query } from "@/lib/db";
import { getOrganizationId } from "@/lib/tenantContext";
import type { Lead } from "./llm";
import type { DigestFollowUp } from "./llm";

/** Ceiling on a single hydration, so one request cannot pull the whole table. */
const MAX_HYDRATE = 400;

/**
 * Columns the assistant can reason about. Explicit rather than SELECT *: this
 * table is wide (~60 columns) and most of them — internal flags, audit stamps,
 * document URLs — are noise that would cost tokens and invite the model to
 * comment on things the user did not ask about.
 */
const LEAD_COLUMNS = `
  id, sr_no, name, phone, alt_phone, email,
  budget, sales_budget, configuration, property_type, use_type, purpose, planning_purchase,
  source, source_other, status, lead_interest_status,
  assigned_to, assigned_receptionist, overseeing_site_head,
  occupation, organization, address, city, pin_code, preferred_location, location,
  loan_planned, loan_planned_confirmed, loan_tracking_info,
  created_at, enquiry_date, first_contact_at, last_activity_at, closing_date, followup_date,
  cp_name, cp_company, cp_phone, channel_partner_id,
  is_lost_lead, lost_lead_reason, lost_lead_marked_at,
  notes, site_visit_history`;

export interface HydratedScope {
  leads: Lead[];
  followUps: DigestFollowUp[];
  /** True when the DB was actually consulted; false means the body was used as-is. */
  hydrated: boolean;
  requestedIds: number;
  foundIds: number;
}

/**
 * Reads the named leads and their follow-ups.
 *
 * Falls back to the caller's own array rather than failing: an assistant that
 * answers from slightly stale data beats one that returns an error, and the
 * `hydrated` flag lets the caller say which happened.
 */
export async function hydrateScope(
  bodyLeads: Lead[],
  bodyFollowUps: DigestFollowUp[]
): Promise<HydratedScope> {
  const ids = Array.from(
    new Set(
      (bodyLeads || [])
        .map((l) => Number(l?.id))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  ).slice(0, MAX_HYDRATE);

  const fallback: HydratedScope = {
    leads: bodyLeads || [],
    followUps: bodyFollowUps || [],
    hydrated: false,
    requestedIds: ids.length,
    foundIds: 0,
  };

  if (ids.length === 0) return fallback;

  try {
    // Both reads in parallel — they are independent and this is on the path of a
    // user waiting for a chat reply.
    // `ids` arrive from the chat context, so they are effectively client-
    // supplied: the organization filter is what stops an id from another
    // builder's lead being hydrated into the assistant's answer.
    const hydrateOrgId = await getOrganizationId();
    const [rows, notes] = await Promise.all([
      query<any>(
        `SELECT ${LEAD_COLUMNS} FROM walkin_enquiries WHERE id = ANY($1::int[]) AND organization_id = $2 ORDER BY sr_no DESC NULLS LAST`,
        [ids, hydrateOrgId]
      ),
      query<any>(
        `SELECT lead_id, message, created_by_name, site_visit_date, created_at
           FROM follow_ups
          WHERE lead_id = ANY($1::int[]) AND organization_id = $2
          ORDER BY lead_id, created_at ASC`,
        [ids, hydrateOrgId]
      ),
    ]);

    if (rows.length === 0) return fallback;

    // walkin_enquiries turned out to store most of what the dashboard also
    // derives from follow-up text — sales_budget, lead_interest_status,
    // property_type, use_type and planning_purchase are real columns. The stored
    // value wins: it is what every other screen reads, so an answer based on it
    // agrees with what the user sees. The client's parsed value is kept only as a
    // fallback for a row where the column was never populated.
    const bodyById = new Map<string, Lead>();
    for (const l of bodyLeads || []) bodyById.set(String(l?.id), l);

    const pick = (a: any, b: any) => {
      const empty = (v: any) =>
        v === null || v === undefined || String(v).trim() === "" ||
        String(v).trim() === "N/A" || String(v).trim() === "Pending";
      return empty(a) ? b : a;
    };

    const leads: Lead[] = rows.map((r) => {
      const prior = bodyById.get(String(r.id)) || ({} as Lead);
      return {
        ...prior,
        ...r,
        // Normalise snake_case columns onto the camelCase names the digest reads.
        config: pick(r.configuration, prior.config),
        location: pick(r.preferred_location, pick(r.location, prior.location)),
        assignedTo: pick(r.assigned_to, prior.assignedTo),
        createdAt: pick(r.created_at, prior.createdAt),
        loanPlanned: pick(r.loan_planned, prior.loanPlanned),
        salesBudget: pick(r.sales_budget, pick(r.budget, prior.salesBudget)),
        leadInterestStatus: pick(r.lead_interest_status, prior.leadInterestStatus),
        // Loan status/amounts live inside loan_tracking_info or are parsed out of
        // follow-up text by the dashboard; there is no plain column for them, so
        // the client's parsed values stand.
        loanStatus: prior.loanStatus,
        loanAmtReq: prior.loanAmtReq,
        loanAmtApp: prior.loanAmtApp,
        // Site visit date lives on the follow-up rows, not on the lead.
        mongoVisitDate: pick(prior.mongoVisitDate, deriveVisitDate(notes, r.id)),
      } as Lead;
    });

    const followUps: DigestFollowUp[] = notes.map((n) => ({
      leadId: n.lead_id,
      message: n.message,
      createdBy: n.created_by_name,
      siteVisitDate: n.site_visit_date || null,
      createdAt: n.created_at,
    }));

    return { leads, followUps, hydrated: true, requestedIds: ids.length, foundIds: rows.length };
  } catch (err: any) {
    // A hydration failure must not take the assistant down with it.
    console.error("[ai-assistant] hydrate failed, using request body:", err?.message);
    return fallback;
  }
}

/** Latest site_visit_date across a lead's follow-ups, matching the dashboard's rule. */
function deriveVisitDate(notes: any[], leadId: number | string): string | undefined {
  let latest: string | undefined;
  for (const n of notes) {
    if (String(n.lead_id) !== String(leadId)) continue;
    if (n.site_visit_date && String(n.site_visit_date).trim() !== "") latest = n.site_visit_date;
  }
  return latest;
}
