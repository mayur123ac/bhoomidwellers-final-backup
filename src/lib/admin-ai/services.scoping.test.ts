// @vitest-environment node
//
// Integration tests for Bhoomi AI's data scoping, run against a REAL Postgres
// database through the actual tool handlers.
//
// These exist because the thing being tested cannot be checked by reading the
// code: every handler assembles SQL with a variable number of bound parameters,
// and the ownership predicate is appended AFTER each handler's own params, at an
// index computed by hand. An off-by-one there does not fail the type checker and
// does not fail a mocked test — it either throws at runtime or, far worse, binds
// the employee's name into the wrong placeholder and silently returns the wrong
// rows. Only executing the real SQL against a real schema catches that.
//
// What is asserted, per handler:
//   1. it executes at all (parameter indexes line up)
//   2. an admin scope sees the tenant's data and ONLY the tenant's data
//   3. a restricted scope sees strictly its own subset
//   4. cross-tenant rows never appear for either
//
// Requires INVENTORY_TEST_DATABASE_URL (shared with the inventory suite — the
// same throwaway database). Skipped entirely when unset.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AiScope } from "./rbac";
import { wipeAll } from "@/test/dbWipe";

const TEST_DB = process.env.INVENTORY_TEST_DATABASE_URL;
const describeIfDb = TEST_DB ? describe : describe.skip;

if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

/** Admin of org A — reads the whole tenant, nothing beyond it. */
const adminScope: AiScope = {
  userId: 1,
  userName: "Admin",
  role: "admin",
  organizationId: ORG_A,
  canReadAllRecords: true,
  ownershipColumns: [],
};

/** Receptionist of org A — owns leads via assigned_to / assigned_receptionist. */
const receptionistScope: AiScope = {
  userId: 2,
  userName: "Priya",
  role: "receptionist",
  organizationId: ORG_A,
  canReadAllRecords: false,
  ownershipColumns: ["assigned_to", "assigned_receptionist"],
};

/** Site Head of org A — owns leads via assigned_to / overseeing_site_head. */
const siteHeadScope: AiScope = {
  userId: 3,
  userName: "Rakesh",
  role: "site head",
  organizationId: ORG_A,
  canReadAllRecords: false,
  ownershipColumns: ["assigned_to", "overseeing_site_head"],
};

/**
 * Two tenants, three owners, and a lead belonging to none of them.
 *
 * The "Nobody" lead is the control: it is org A's, so an Admin must count it,
 * and it belongs to no one, so neither restricted scope may.
 */
async function seed(db: import("pg").Pool) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await wipeAll(c);

    await c.query(
      `INSERT INTO organizations (id, name, slug, status)
       VALUES ($1,'Bhoomi Test','bhoomi-test','active'), ($2,'Viraj Test','viraj-test','active')`,
      [ORG_A, ORG_B],
    );

    const lead = async (o: {
      name: string; assignedTo?: string | null; recep?: string | null;
      siteHead?: string | null; org: string; source?: string; status?: string;
    }) => (await c.query(
      `INSERT INTO walkin_enquiries
         (name, phone, assigned_to, assigned_receptionist, overseeing_site_head,
          source, status, organization_id, created_at)
       VALUES ($1,'9990000000',$2,$3,$4,$5,$6,$7, NOW()) RETURNING id`,
      [o.name, o.assignedTo ?? null, o.recep ?? null, o.siteHead ?? null,
       o.source ?? "Walk-in", o.status ?? "ASSIGNED", o.org],
    )).rows[0].id as number;

    // Org A
    const lPriyaAssigned = await lead({ name: "Priya's lead A", assignedTo: "Priya", org: ORG_A });
    const lPriyaRecep = await lead({ name: "Priya's lead B", recep: "Priya", org: ORG_A, source: "Referral" });
    const lRakeshAssigned = await lead({ name: "Rakesh's lead", assignedTo: "Rakesh", org: ORG_A });
    const lRakeshOversee = await lead({ name: "Rakesh oversees", siteHead: "Rakesh", org: ORG_A });
    const lNobody = await lead({ name: "Nobody's lead", org: ORG_A });
    // Org B — must never appear for anyone above.
    const lOther = await lead({ name: "Other tenant lead", assignedTo: "Priya", recep: "Priya", org: ORG_B });

    const booking = async (leadId: number, num: string, org: string, agreement: number) => {
      const id = (await c.query(
        `INSERT INTO booking_applications
           (lead_id, booking_number, booking_status, agreement_value, primary_name,
            flat_number, organization_id, booking_date)
         VALUES ($1,$2,'Confirmed',$3,$4,'A-101',$5, CURRENT_DATE) RETURNING id`,
        [leadId, num, agreement, `Cust ${num}`, org],
      )).rows[0].id as number;
      await c.query(
        `INSERT INTO booking_financials (booking_id, ocr_amount) VALUES ($1, $2)`,
        [id, agreement * 0.1],
      );
      await c.query(
        `INSERT INTO booking_loan_details
           (booking_id, loan_required, loan_status, loan_amount, sanction_amount, disbursement_amount)
         VALUES ($1, TRUE, 'Sanctioned', $2, $2, $3)`,
        [id, agreement * 0.8, agreement * 0.4],
      );
      await c.query(
        `INSERT INTO booking_registration_details (booking_id, registration_status)
         VALUES ($1, 'Pending')`,
        [id],
      );
      return id;
    };

    await booking(lPriyaAssigned, "BK-P1", ORG_A, 1_000_000);
    await booking(lRakeshAssigned, "BK-R1", ORG_A, 2_000_000);
    await booking(lNobody, "BK-N1", ORG_A, 4_000_000);
    await booking(lOther, "BK-X1", ORG_B, 8_000_000);

    const note = async (leadId: number, msg: string, org: string) =>
      c.query(
        `INSERT INTO follow_ups (lead_id, message, created_by_name, organization_id)
         VALUES ($1,$2,'Staff',$3)`,
        [leadId, msg, org],
      );
    await note(lPriyaAssigned, "customer asked about loan eligibility", ORG_A);
    await note(lNobody, "customer asked about loan eligibility too", ORG_A);
    await note(lOther, "other tenant loan discussion", ORG_B);

    await c.query(
      `INSERT INTO inventory_units
         (project_name, tower, wing, unit_type, floor, flat_no, carpet_area_sqft, status, organization_id)
       VALUES ('Alpha','A','B','2BHK',1,'A-101',750,'available',$1),
              ('Alpha','A','B','2BHK',2,'A-201',750,'booked',$1),
              ('Beta','B','C','3BHK',1,'B-101',950,'available',$2)`,
      [ORG_A, ORG_B],
    );

    await c.query("COMMIT");
    return { lPriyaAssigned, lPriyaRecep, lRakeshAssigned, lRakeshOversee, lNobody, lOther };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

describeIfDb("Bhoomi AI tool scoping", () => {
  let db: import("pg").Pool;
  let S: typeof import("./services");

  beforeAll(async () => {
    const { Pool } = await import("pg");
    db = new Pool({ connectionString: TEST_DB });
    S = await import("./services");
  });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => { await seed(db); });

  /* ── Leads ─────────────────────────────────────────────────────────────── */

  it("leads: admin counts the whole tenant, and not the other tenant", async () => {
    const r: any = await S.getLeadsSummary({}, adminScope);
    // 5 leads in org A; the 6th belongs to org B.
    expect(r.total).toBe(5);
    expect(r.coverage).toBe("company-wide");
  });

  it("leads: receptionist counts only her own, by either ownership column", async () => {
    const r: any = await S.getLeadsSummary({}, receptionistScope);
    // assigned_to='Priya' + assigned_receptionist='Priya'. The org B lead names
    // her in BOTH columns and must still not count.
    expect(r.total).toBe(2);
    expect(r.coverage).toBe("your own leads only");
  });

  it("leads: site head counts assigned + overseen, not the unowned one", async () => {
    const r: any = await S.getLeadsSummary({}, siteHeadScope);
    expect(r.total).toBe(2);
  });

  it("leads: the by-source breakdown is scoped too, not just the total", async () => {
    const r: any = await S.getLeadsSummary({}, receptionistScope);
    const total = r.bySource.reduce((a: number, s: any) => a + s.leads, 0);
    expect(total).toBe(2);
    expect(r.bySource.map((s: any) => s.source).sort()).toEqual(["Referral", "Walk-in"]);
  });

  it("leads: a month filter still binds correctly alongside the ownership param", async () => {
    // The index arithmetic is at its most fragile here: month pushes two params
    // BEFORE the org and the name.
    const month = new Date().toISOString().slice(0, 7);
    const r: any = await S.getLeadsSummary({ month }, receptionistScope);
    expect(r.total).toBe(2);
    expect(r.period).toBe(month);
    const none: any = await S.getLeadsSummary({ month: "1999-01" }, receptionistScope);
    expect(none.total).toBe(0);
  });

  /* ── Revenue ───────────────────────────────────────────────────────────── */

  it("revenue: admin sums the tenant's bookings only", async () => {
    const r: any = await S.getRevenueSummary({}, adminScope);
    // 1M + 2M + 4M in org A. The 8M booking is org B's.
    expect(r.agreementValue).toBe(7_000_000);
    expect(r.bookings).toBe(3);
  });

  it("revenue: a restricted scope sums only bookings from its own leads", async () => {
    const r: any = await S.getRevenueSummary({}, receptionistScope);
    expect(r.agreementValue).toBe(1_000_000);
    expect(r.coverage).toBe("your own leads only");

    const sh: any = await S.getRevenueSummary({}, siteHeadScope);
    expect(sh.agreementValue).toBe(2_000_000);
  });

  it("revenue: the unowned booking counts for admin and for nobody else", async () => {
    const admin: any = await S.getRevenueSummary({}, adminScope);
    const recep: any = await S.getRevenueSummary({}, receptionistScope);
    const sh: any = await S.getRevenueSummary({}, siteHeadScope);
    // 4M sits in the admin total and in neither restricted one.
    expect(admin.agreementValue - recep.agreementValue - sh.agreementValue).toBe(4_000_000);
  });

  it("revenue: month filter and ownership filter coexist", async () => {
    const month = new Date().toISOString().slice(0, 7);
    const r: any = await S.getRevenueSummary({ month }, receptionistScope);
    expect(r.agreementValue).toBe(1_000_000);
  });

  /* ── Loans, disbursements, registration ────────────────────────────────── */

  it("loans: totals are tenant-scoped for admin and self-scoped otherwise", async () => {
    const admin: any = await S.getLoanSummary({}, adminScope);
    expect(admin.totals.sanctioned).toBe(7_000_000 * 0.8);

    const recep: any = await S.getLoanSummary({}, receptionistScope);
    expect(recep.totals.sanctioned).toBe(1_000_000 * 0.8);
  });

  it("disbursements: a restricted scope sees only its own customers", async () => {
    const admin: any = await S.getPendingDisbursements({}, adminScope);
    expect(admin).toHaveLength(3);

    const recep: any = await S.getPendingDisbursements({}, receptionistScope);
    expect(recep).toHaveLength(1);
    expect(recep[0].customer).toBe("Cust BK-P1");
  });

  it("registration: pending list is scoped, and never crosses tenants", async () => {
    const admin: any = await S.getRegistrationSummary({}, adminScope);
    expect(admin.pending).toBe(3);

    const recep: any = await S.getRegistrationSummary({}, receptionistScope);
    expect(recep.pending).toBe(1);
    expect(recep.pendingList.map((p: any) => p.customer)).toEqual(["Cust BK-P1"]);
  });

  /* ── Performance — the refusal ─────────────────────────────────────────── */

  it("performance: admin gets the ranking, tenant-scoped", async () => {
    const r: any = await S.getSalesManagerPerformance({}, adminScope);
    const names = r.map((x: any) => x.manager).sort();
    // Priya, Rakesh and the unassigned booking. Org B's row is absent.
    expect(names).toEqual(["Priya", "Rakesh", "Unassigned"]);
  });

  it("performance: a restricted scope is refused, not quietly narrowed", async () => {
    for (const scope of [receptionistScope, siteHeadScope]) {
      const r: any = await S.getSalesManagerPerformance({}, scope);
      expect(r.error).toBe("NOT_PERMITTED");
      // Must not leak a ranking through the refusal payload.
      expect(JSON.stringify(r)).not.toContain("Rakesh");
      expect(JSON.stringify(r)).not.toContain("agreementValue");
    }
  });

  /* ── Follow-up notes ───────────────────────────────────────────────────── */

  it("notes: admin searches the tenant's notes, not the other tenant's", async () => {
    const r: any = await S.searchKnowledgeBase({ q: "loan" }, adminScope);
    expect(r.matches).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("other tenant");
  });

  it("notes: a restricted scope only reads notes on its own leads", async () => {
    const r: any = await S.searchKnowledgeBase({ q: "loan" }, receptionistScope);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].lead).toBe("Priya's lead A");
    // The unowned lead's note is the one that must not appear.
    expect(JSON.stringify(r)).not.toContain("Nobody");
  });

  /* ── Inventory — deliberately not ownership-scoped ─────────────────────── */

  it("inventory: readable by every role, but tenant-scoped", async () => {
    for (const scope of [adminScope, receptionistScope, siteHeadScope]) {
      const r: any = await S.getInventorySummary({}, scope);
      const units = r.totalsByStatus.reduce((a: number, s: any) => a + s.units, 0);
      // Two units in org A. The Beta unit is org B's.
      expect(units).toBe(2);
      expect(JSON.stringify(r)).not.toContain("Beta");
    }
  });

  /* ── The blanket guarantee ─────────────────────────────────────────────── */

  it("no handler leaks another tenant's data to any scope", async () => {
    const calls: Array<[string, (a: any, s: AiScope) => Promise<unknown>, any]> = [
      ["getRevenueSummary", S.getRevenueSummary, {}],
      ["getLoanSummary", S.getLoanSummary, {}],
      ["getPendingDisbursements", S.getPendingDisbursements, {}],
      ["getSalesManagerPerformance", S.getSalesManagerPerformance, {}],
      ["getLeadsSummary", S.getLeadsSummary, {}],
      ["getInventorySummary", S.getInventorySummary, {}],
      ["getRegistrationSummary", S.getRegistrationSummary, {}],
      ["searchKnowledgeBase", S.searchKnowledgeBase, { q: "loan" }],
    ];
    for (const [name, fn, args] of calls) {
      for (const scope of [adminScope, receptionistScope, siteHeadScope]) {
        const out = JSON.stringify(await fn(args, scope));
        // Every org B fixture is named distinctively.
        expect(out, `${name} / ${scope.role}`).not.toContain("BK-X1");
        expect(out, `${name} / ${scope.role}`).not.toContain("Other tenant");
        expect(out, `${name} / ${scope.role}`).not.toContain("Beta");
      }
    }
  });
});
