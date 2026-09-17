// @vitest-environment node
//
// Tests for GET /api/monitoring/employee-performance
//
// Covers: RBAC, tenant isolation, employee filtering, contacted-lead dedup,
// call without recording, confirmed-only bookings, revisit counting,
// lead-level pagination, search, expectation filter, follow-up-today,
// IST date boundary, and period consistency.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockSession: any = null;
let mockOrgId: string = "org-test-1";

// queryLog tracks every SQL call for assertion; queryResultMap lets tests
// configure per-query return values by matching a substring of the SQL.
let queryLog: { sql: string; params: any[] }[] = [];
let queryResultMap: { match: string; result: any[] }[] = [];

vi.mock("@/lib/serverAuth", () => ({
  requireSession: vi.fn(async () => {
    if (!mockSession) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({ success: false, message: "Not signed in.", code: "UNAUTHORIZED" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      };
    }
    return { ok: true, session: mockSession };
  }),
}));

vi.mock("@/lib/tenantContext", () => ({
  getOrganizationId: vi.fn(async () => mockOrgId),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string, params: any[]) => {
    queryLog.push({ sql, params });
    // Find the first matching result by substring
    for (const entry of queryResultMap) {
      if (sql.includes(entry.match)) return entry.result;
    }
    return [];
  }),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { GET } from "../route";

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/monitoring/employee-performance");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "GET" }) as any;
}

async function json(res: Response) {
  return res.json();
}

// Default roster that most tests reuse
const defaultRoster = [
  { id: 10, name: "Alice", role: "Sales Manager" },
  { id: 20, name: "Bob", role: "Site Head" },
];

function setupDefaultResults() {
  queryResultMap = [
    { match: "FROM users", result: defaultRoster },
    { match: "FROM walkin_enquiries w\n        WHERE", result: [] },
    { match: "FROM follow_ups f", result: [] },
    { match: "FROM site_visits sv\n        WHERE", result: [] },
    { match: "FROM booking_applications ba", result: [] },
    { match: "FROM lead_reminders lr", result: [] },
    { match: "JOIN site_visits sv ON sv.lead_id", result: [] },
    { match: "FROM call_sessions cs", result: [] },
    { match: "recurring_visits", result: [] },
    { match: "w.last_activity_at IS NULL OR w.last_activity_at <", result: [] },
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSession = null;
  mockOrgId = "org-test-1";
  queryLog = [];
  queryResultMap = [];
  vi.clearAllMocks();
});

describe("RBAC & Auth", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("rejects non-admin role with 403", async () => {
    mockSession = { _id: 1, name: "User", role: "Sales Manager" };
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("allows admin role", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it("allows site head role", async () => {
    mockSession = { _id: 1, name: "SH", role: "Site Head" };
    setupDefaultResults();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });

  it("allows super admin role", async () => {
    mockSession = { _id: 1, name: "SA", role: "super_admin" };
    setupDefaultResults();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });
});

describe("Organization isolation", () => {
  it("passes orgId to every query", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    mockOrgId = "org-xyz";
    setupDefaultResults();
    await GET(makeRequest());
    // Every query should receive org-xyz as first param
    for (const log of queryLog) {
      expect(log.params[0]).toBe("org-xyz");
    }
  });
});

describe("Contacted leads (call_sessions)", () => {
  it("counts distinct leads with recordings, not total calls", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    // Alice (id=10) called lead 1 three times but only two have recordings
    // Still only 1 unique contacted lead
    queryResultMap.find(e => e.match === "FROM call_sessions cs")!.result = [
      { user_id: 10, contacted_leads: "1" },
    ];
    queryResultMap.find(e => e.match.includes("FROM walkin_enquiries w\n        WHERE"))!.result = [
      { user_id: 10, total_leads: "5", lost_leads: "0", closing_leads: "0", active_leads: "5",
        contacted_leads_legacy: "1", avg_first_action_hours: null, data_quality_leads: "0",
        active_last_7d: "3", stagnant_leads: "2" },
    ];

    const res = await GET(makeRequest());
    const body = await json(res);
    const alice = body.data.employees.find((e: any) => e.id === 10);
    expect(alice.contactedLeads).toBe(1);
    // contactRate = 1/5 * 100 = 20
    expect(alice.contactRate).toBe(20);
  });

  it("call without recording does not count as contacted", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    // No call_sessions results (recording_r2_key IS NOT NULL filters them out)
    queryResultMap.find(e => e.match === "FROM call_sessions cs")!.result = [];
    queryResultMap.find(e => e.match.includes("FROM walkin_enquiries w\n        WHERE"))!.result = [
      { user_id: 10, total_leads: "3", lost_leads: "0", closing_leads: "0", active_leads: "3",
        contacted_leads_legacy: "0", avg_first_action_hours: null, data_quality_leads: "0",
        active_last_7d: "1", stagnant_leads: "2" },
    ];
    const res = await GET(makeRequest());
    const body = await json(res);
    const alice = body.data.employees.find((e: any) => e.id === 10);
    expect(alice.contactedLeads).toBe(0);
    // contactRate = 0/3 * 100 = 0 (not null — null only when totalLeads is 0)
    expect(alice.contactRate).toBe(0);
  });

  it("recording_r2_key IS NOT NULL appears in the call_sessions query", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const csQuery = queryLog.find(q => q.sql.includes("call_sessions"));
    expect(csQuery).toBeTruthy();
    expect(csQuery!.sql).toContain("recording_r2_key IS NOT NULL");
  });
});

describe("Bookings — confirmed only", () => {
  it("counts only Confirmed bookings, not Pending or Cancelled", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    queryResultMap.find(e => e.match === "FROM booking_applications ba")!.result = [
      { user_id: 10, total_bookings: "5", confirmed_bookings: "2", total_agreement_value: "5000000" },
    ];
    queryResultMap.find(e => e.match.includes("FROM walkin_enquiries w\n        WHERE"))!.result = [
      { user_id: 10, total_leads: "10", lost_leads: "0", closing_leads: "2", active_leads: "8",
        contacted_leads_legacy: "0", avg_first_action_hours: null, data_quality_leads: "0",
        active_last_7d: "5", stagnant_leads: "3" },
    ];

    const res = await GET(makeRequest());
    const body = await json(res);
    const alice = body.data.employees.find((e: any) => e.id === 10);
    expect(alice.confirmedBookings).toBe(2);
    expect(alice.activeBookings).toBe(2); // backward compat alias
    expect(alice.totalBookings).toBe(5);
    // bookingRate = 2/10 * 100 = 20
    expect(alice.bookingRate).toBe(20);
  });

  it("booking query uses booking_status = Confirmed", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const bq = queryLog.find(q => q.sql.includes("booking_applications"));
    expect(bq!.sql).toContain("booking_status = 'Confirmed'");
    expect(bq!.sql).not.toContain("!= 'Cancelled'");
  });
});

describe("Site visits — recurring/revisits", () => {
  it("recurring_visits counts extra completed visits per lead", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    // Alice: lead 1 had 3 completed visits (2 revisits), lead 2 had 1 (0 revisits)
    queryResultMap.find(e => e.match === "recurring_visits")!.result = [
      { user_id: 10, recurring_visits: "2" },
    ];
    queryResultMap.find(e => e.match.includes("FROM walkin_enquiries w\n        WHERE"))!.result = [
      { user_id: 10, total_leads: "5", lost_leads: "0", closing_leads: "0", active_leads: "5",
        contacted_leads_legacy: "0", avg_first_action_hours: null, data_quality_leads: "0",
        active_last_7d: "3", stagnant_leads: "2" },
    ];
    queryResultMap.find(e => e.match.includes("FROM site_visits sv\n        WHERE"))!.result = [
      { user_id: 10, visits_scheduled: "4", visits_completed: "4", leads_with_completed_visits: "2" },
    ];

    const res = await GET(makeRequest());
    const body = await json(res);
    const alice = body.data.employees.find((e: any) => e.id === 10);
    expect(alice.recurringVisits).toBe(2);
    expect(alice.visitsCompleted).toBe(4);
    expect(alice.leadsWithVisits).toBe(2);
  });
});

describe("Employee filter", () => {
  it("scopes all queries to a single employee", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    // When employee_id=10, roster should filter
    queryResultMap = [
      { match: "FROM users", result: [{ id: 10, name: "Alice", role: "Sales Manager" }] },
      { match: "FROM walkin_enquiries w\n        WHERE", result: [] },
      { match: "FROM follow_ups f", result: [] },
      { match: "FROM site_visits sv\n        WHERE", result: [] },
      { match: "FROM booking_applications ba", result: [] },
      { match: "FROM lead_reminders lr", result: [] },
      { match: "JOIN site_visits sv ON sv.lead_id", result: [] },
      { match: "FROM call_sessions cs", result: [] },
      { match: "recurring_visits", result: [] },
      { match: "w.last_activity_at IS NULL OR w.last_activity_at <", result: [] },
    ];

    const res = await GET(makeRequest({ employee_id: "10" }));
    expect(res.status).toBe(200);

    // Verify that lead stats query includes the employee filter
    const leadQ = queryLog.find(q => q.sql.includes("assigned_to_user_id") && q.sql.includes("GROUP BY"));
    expect(leadQ).toBeTruthy();
    expect(leadQ!.sql).toContain("assigned_to_user_id = 10");

    // Verify call_sessions query includes employee filter
    const csQ = queryLog.find(q => q.sql.includes("call_sessions"));
    expect(csQ!.sql).toContain("cs.user_id = 10");
  });

  it("rejects invalid employee_id", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    const res = await GET(makeRequest({ employee_id: "abc" }));
    expect(res.status).toBe(400);
  });
});

describe("Lead-level view", () => {
  it("returns paginated leads with derived columns", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    queryResultMap = [
      { match: "COUNT(*) AS total", result: [{ total: "3" }] },
      { match: "sr_no", result: [
        { id: 1, sr_no: 101, client_name: "Kumar", phone: "9876543210",
          assigned_employee: "Alice", assigned_employee_id: 10, status: "Routed",
          expectation: "Interested", is_lost_lead: false,
          follow_up_done_today: true, contacted_lead: false, total_site_visits: "2" },
        { id: 2, sr_no: 102, client_name: "Sharma", phone: "9876543211",
          assigned_employee: "Alice", assigned_employee_id: 10, status: "Contacted",
          expectation: null, is_lost_lead: false,
          follow_up_done_today: false, contacted_lead: true, total_site_visits: "0" },
      ]},
    ];

    const res = await GET(makeRequest({ view: "leads", page: "1", limit: "10" }));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.data.leads).toHaveLength(2);
    expect(body.data.pagination.total).toBe(3);
    expect(body.data.pagination.page).toBe(1);
    expect(body.data.leads[0].follow_up_done_today).toBe(true);
    expect(body.data.leads[0].contacted_lead).toBe(false);
    expect(body.data.leads[0].total_site_visits).toBe("2");
  });

  it("search filter is applied in SQL", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    queryResultMap = [
      { match: "COUNT(*) AS total", result: [{ total: "0" }] },
      { match: "sr_no", result: [] },
    ];

    await GET(makeRequest({ view: "leads", search: "kumar" }));
    const countQ = queryLog.find(q => q.sql.includes("COUNT(*)"));
    expect(countQ!.sql).toContain("ILIKE");
    expect(countQ!.params).toContain("%kumar%");
  });

  it("expectation filter is applied in SQL", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    queryResultMap = [
      { match: "COUNT(*) AS total", result: [{ total: "0" }] },
      { match: "sr_no", result: [] },
    ];

    await GET(makeRequest({ view: "leads", expectation: "Interested" }));
    const countQ = queryLog.find(q => q.sql.includes("COUNT(*)"));
    expect(countQ!.sql).toContain("lead_interest_status");
    expect(countQ!.params).toContain("Interested");
  });

  it("follow_up_today filter uses IST timezone", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    queryResultMap = [
      { match: "COUNT(*) AS total", result: [{ total: "0" }] },
      { match: "sr_no", result: [] },
    ];

    await GET(makeRequest({ view: "leads", followup_today: "true" }));
    const countQ = queryLog.find(q => q.sql.includes("COUNT(*)"));
    // IST boundary must appear in the SQL
    expect(countQ!.sql).toContain("Asia/Kolkata");
    expect(countQ!.sql).toContain("created_by_id IS NOT NULL");
    expect(countQ!.sql).toContain("Lead Transferred");
  });

  it("employee_id filter is applied to leads view", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    queryResultMap = [
      { match: "COUNT(*) AS total", result: [{ total: "0" }] },
      { match: "sr_no", result: [] },
    ];

    await GET(makeRequest({ view: "leads", employee_id: "10" }));
    const countQ = queryLog.find(q => q.sql.includes("COUNT(*)"));
    expect(countQ!.sql).toContain("assigned_to_user_id");
    expect(countQ!.params).toContain(10);
  });
});

describe("ID-based joins (no name strings)", () => {
  it("lead stats GROUP BY uses assigned_to_user_id, not assigned_to", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const leadQ = queryLog.find(q => q.sql.includes("total_leads") && q.sql.includes("GROUP BY"));
    expect(leadQ!.sql).toContain("assigned_to_user_id");
    expect(leadQ!.sql).not.toContain("GROUP BY w.assigned_to\n");
  });

  it("follow-up stats use created_by_id directly", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const fupQ = queryLog.find(q => q.sql.includes("follow_ups f") && q.sql.includes("GROUP BY"));
    expect(fupQ!.sql).toContain("f.created_by_id");
    // Should NOT fall back to name matching
    expect(fupQ!.sql).not.toContain("u_name");
  });

  it("site visit stats use created_by_id", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const svQ = queryLog.find(q => q.sql.includes("site_visits sv") && q.sql.includes("GROUP BY") && !q.sql.includes("JOIN site_visits sv ON"));
    expect(svQ!.sql).toContain("sv.created_by_id");
    expect(svQ!.sql).not.toContain("sv.created_by ");
  });

  it("booking stats use created_by_id", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest());
    const bq = queryLog.find(q => q.sql.includes("booking_applications"));
    expect(bq!.sql).toContain("ba.created_by_id");
    expect(bq!.sql).not.toContain("ba.created_by ");
  });
});

describe("Period consistency", () => {
  it("site visit date uses completed_at for completed visits", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest({ period: "30d" }));
    const rvQ = queryLog.find(q => q.sql.includes("recurring_visits"));
    expect(rvQ!.sql).toContain("completed_at");
  });

  it("stagnant leads query respects period when set", async () => {
    mockSession = { _id: 1, name: "Admin", role: "admin" };
    setupDefaultResults();
    await GET(makeRequest({ period: "30d" }));
    const stQ = queryLog.find(q => q.sql.includes("last_activity_at IS NULL OR w.last_activity_at <"));
    // Should have a date clause for assigned_at
    expect(stQ!.sql).toContain("assigned_at >= NOW()");
  });
});
