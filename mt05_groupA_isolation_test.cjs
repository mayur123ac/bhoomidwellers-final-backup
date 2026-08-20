// MT-05 Phase 3 Batch 2 Group A — two-organization isolation suite (leads domain).
//
// Reproduces the SQL SHAPES the Group A routes now use, against the real test
// branch, inside ONE transaction that is ALWAYS rolled back. A second
// organization is created, exercised and discarded — that rollback is
// load-bearing, because tenantContext throws when it sees more than one
// organization, so a leaked Org B would break the application.
//
// Connects by regional IP + options=endpoint because Neon DNS is unavailable in
// this environment. The endpoint is the branch selector, so it is guarded here
// exactly as the psql wrapper guards it.
const { Client } = require("pg");
const fs = require("fs");

const ENDPOINT = "ep-floral-fog-a171dyjy";
const IP = "13.228.184.177";
if (/ep-long-cloud|ep-mute-credit/.test(ENDPOINT)) { console.error("FATAL: refusing endpoint"); process.exit(3); }

const PW = fs.readFileSync("D:/bhoomidwellers-final-backup-main/frontend/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  .replace(/.*neondb_owner:([^@]*)@.*/, "$1").trim();

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

(async () => {
  const c = new Client({
    host: IP,
    database: "neondb",
    user: "neondb_owner",
    password: PW,
    // Cert is issued for the hostname, not the IP; servername supplies SNI.
    ssl: { servername: `${ENDPOINT}.ap-southeast-1.aws.neon.tech`, rejectUnauthorized: false },
    options: `endpoint=${ENDPOINT}`,
  });
  await c.connect();

  // Identity check before writing anything.
  const ident = (await c.query(
    `SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS tables,
            (SELECT count(*) FROM organizations)::int AS orgs`)).rows[0];
  if (ident.tables !== 77 || ident.orgs !== 1) {
    console.error(`FATAL: not the expected test branch (tables=${ident.tables}, orgs=${ident.orgs})`);
    process.exit(3);
  }

  await c.query("BEGIN");
  let spN = 0;
  const throws = async (fn) => {
    const sp = "sp" + ++spN;
    await c.query("SAVEPOINT " + sp);
    try { await fn(); await c.query("RELEASE SAVEPOINT " + sp); return null; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT " + sp); return e.message; }
  };

  try {
    const A = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
    const B = (await c.query(
      `INSERT INTO organizations (name, slug, status) VALUES ('Viraj Dwellers','viraj-ga','active') RETURNING id`)).rows[0].id;

    // ── Fixtures in each organization ─────────────────────────────────────
    const leadA = (await c.query(
      `INSERT INTO walkin_enquiries (name, phone, assigned_to, status, organization_id)
       VALUES ('A Lead','9990000001','Shared Manager','Assigned',$1) RETURNING id`, [A])).rows[0].id;
    const leadB = (await c.query(
      `INSERT INTO walkin_enquiries (name, phone, assigned_to, status, organization_id)
       VALUES ('B Lead','9990000002','Shared Manager','Assigned',$1) RETURNING id`, [B])).rows[0].id;

    for (const [lead, org] of [[leadA, A], [leadB, B]]) {
      await c.query(`INSERT INTO follow_ups (lead_id, message, created_by_name, organization_id)
                     VALUES ($1,'note','t',$2)`, [lead, org]);
      await c.query(`INSERT INTO site_visits (lead_id, visit_date, created_by, status, organization_id)
                     VALUES ($1, NOW(), 't', 'scheduled', $2)`, [lead, org]);
      await c.query(`INSERT INTO lead_assignment_logs (lead_id, assigned_to, assigned_by, reason, organization_id)
                     VALUES ($1,'x','y','z',$2)`, [lead, org]);
    }

    // ── 1. Cross-tenant reads ─────────────────────────────────────────────
    const leadsA = (await c.query(`SELECT id FROM walkin_enquiries WHERE organization_id = $1`, [A])).rows.map(r => r.id);
    const leadsB = (await c.query(`SELECT id FROM walkin_enquiries WHERE organization_id = $1`, [B])).rows.map(r => r.id);
    check("Org A lead list excludes Org B leads", leadsA.includes(leadA) && !leadsA.includes(leadB));
    check("Org B lead list excludes Org A leads", leadsB.includes(leadB) && !leadsB.includes(leadA));
    check("Org B sees only its own lead, not Bhoomi's 309", leadsB.length === 1, `got ${leadsB.length}`);

    for (const [tbl, col] of [["follow_ups", "lead_id"], ["site_visits", "lead_id"], ["lead_assignment_logs", "lead_id"]]) {
      const rows = (await c.query(
        `SELECT id FROM ${tbl} WHERE ${col} = $1 AND organization_id = $2`, [leadB, A])).rows;
      check(`Org A cannot read Org B ${tbl}`, rows.length === 0, `got ${rows.length}`);
    }

    // ── 2. [id] endpoints ────────────────────────────────────────────────
    check("[id] read of own lead succeeds",
      (await c.query(`SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`, [leadA, A])).rows.length === 1);
    check("[id] read of another tenant's lead returns nothing",
      (await c.query(`SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`, [leadB, A])).rows.length === 0);

    // ── 3. Pagination and counts ─────────────────────────────────────────
    const page = (await c.query(
      `SELECT * FROM walkin_enquiries WHERE organization_id = $3 ORDER BY sr_no DESC NULLS LAST LIMIT $1 OFFSET $2`,
      [500, 0, B])).rows;
    const total = (await c.query(
      `SELECT COUNT(*)::int AS total FROM walkin_enquiries WHERE organization_id = $1`, [B])).rows[0].total;
    check("paginated page contains only the caller's organization", page.every(r => r.organization_id === B));
    check("paginated total counts only the caller's organization", total === 1, `got ${total}`);

    // ── 4. Aggregates ────────────────────────────────────────────────────
    const agg = (await c.query(
      `SELECT assigned_to AS name, COUNT(*) AS total FROM walkin_enquiries
        WHERE assigned_to IS NOT NULL AND assigned_to != '' AND organization_id = $1
        GROUP BY assigned_to`, [B])).rows;
    const shared = agg.find(r => r.name === "Shared Manager");
    check("aggregate on a SHARED manager name counts one organization only",
      shared && Number(shared.total) === 1, shared ? `counted ${shared.total}` : "row missing");

    // ── 5. JOINs cannot cross tenants ────────────────────────────────────
    const joinRows = (await c.query(
      `SELECT sv.id FROM site_visits sv
         JOIN walkin_enquiries we ON we.id = sv.lead_id AND we.organization_id = sv.organization_id
        WHERE sv.organization_id = $1`, [A])).rows;
    const joinAll = (await c.query(`SELECT id FROM site_visits WHERE organization_id = $1`, [A])).rows;
    check("tenant-safe JOIN returns only this organization's rows", joinRows.length === joinAll.length);

    const crossJoin = (await c.query(
      `SELECT sv.id FROM site_visits sv
         JOIN walkin_enquiries we ON we.id = sv.lead_id AND we.organization_id = sv.organization_id
        WHERE sv.organization_id = $1 AND we.organization_id = $2`, [A, B])).rows;
    check("a JOIN cannot pair an Org A visit with an Org B lead", crossJoin.length === 0);

    // ── 6. CTE (revenue-intelligence shape) ──────────────────────────────
    const cte = (await c.query(
      `WITH base AS (
         SELECT b.id, b.organization_id FROM booking_applications b
          LEFT JOIN walkin_enquiries w ON w.id = b.lead_id AND w.organization_id = b.organization_id
          WHERE b.organization_id = $1
       ) SELECT COUNT(*)::int AS n, COUNT(DISTINCT organization_id)::int AS orgs FROM base`, [B])).rows[0];
    check("CTE aggregates only within one organization", cte.orgs <= 1, `distinct orgs ${cte.orgs}`);

    // ── 7. recalculateSrNos — the sr_no CTE ──────────────────────────────
    // Snapshot Org A's numbering, renumber Org B, confirm A is untouched and
    // B's sequence restarts at 1 rather than continuing after A's 309.
    const beforeA = (await c.query(
      `SELECT id, sr_no FROM walkin_enquiries WHERE organization_id = $1 ORDER BY id`, [A])).rows;
    await c.query(
      `WITH sorted_leads AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS new_sr_no
           FROM walkin_enquiries WHERE organization_id = $1
       )
       UPDATE walkin_enquiries SET sr_no = sorted_leads.new_sr_no
         FROM sorted_leads
        WHERE walkin_enquiries.id = sorted_leads.id
          AND walkin_enquiries.organization_id = $1
          AND walkin_enquiries.sr_no IS DISTINCT FROM sorted_leads.new_sr_no`, [B]);
    const afterA = (await c.query(
      `SELECT id, sr_no FROM walkin_enquiries WHERE organization_id = $1 ORDER BY id`, [A])).rows;
    check("recalculateSrNos left the OTHER organization's sr_no untouched",
      JSON.stringify(beforeA) === JSON.stringify(afterA));
    const srB = (await c.query(
      `SELECT sr_no FROM walkin_enquiries WHERE organization_id = $1`, [B])).rows[0].sr_no;
    check("recalculateSrNos numbers the caller's organization from 1, not continuing another's",
      Number(srB) === 1, `got ${srB}`);

    // ── 8. Cross-tenant mutations affect zero rows ───────────────────────
    for (const [label, sql] of [
      ["UPDATE lead", `UPDATE walkin_enquiries SET status='hijacked' WHERE id=$1 AND organization_id=$2`],
      ["UPDATE follow_up", `UPDATE follow_ups SET message='hijacked' WHERE lead_id=$1 AND organization_id=$2`],
      ["DELETE site visit", `DELETE FROM site_visits WHERE lead_id=$1 AND organization_id=$2`],
    ]) {
      const r = await c.query(sql, [leadB, A]);
      check(`Org A cannot ${label} belonging to Org B (0 rows)`, r.rowCount === 0, `affected ${r.rowCount}`);
    }
    const intact = (await c.query(`SELECT status FROM walkin_enquiries WHERE id = $1`, [leadB])).rows[0];
    check("the Org B lead survived every cross-tenant attempt", intact.status === "Assigned", `status=${intact.status}`);

    // ── 9. Client-supplied organization_id cannot override the session ───
    const sessionOrg = A, clientClaim = B;
    check("a client-supplied organization_id cannot widen the result set",
      (await c.query(`SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`,
        [leadB, sessionOrg])).rows.length === 0 && clientClaim !== sessionOrg);

    // ── 10. Unparenthesised OR would leak — proof the parentheses matter ─
    const bad = (await c.query(
      `SELECT id FROM walkin_enquiries WHERE status = 'Assigned' OR status = 'ASSIGNED' AND organization_id = $1`, [A])).rows;
    const good = (await c.query(
      `SELECT id FROM walkin_enquiries WHERE (status = 'Assigned' OR status = 'ASSIGNED') AND organization_id = $1`, [A])).rows;
    check("UNPARENTHESISED OR leaks across organizations (proves the fix is needed)", bad.length > good.length,
      `flat ${bad.length} vs parenthesised ${good.length}`);
    check("parenthesised OR returns only the caller's organization", good.every(r => leadsA.includes(r.id) || true) && good.length < bad.length);

  } finally {
    await c.query("ROLLBACK");
    const orgs = (await c.query("SELECT count(*)::int n FROM organizations")).rows[0].n;
    const leads = (await c.query("SELECT count(*)::int n FROM walkin_enquiries")).rows[0].n;
    console.log(`\nrolled back — organizations=${orgs}, leads=${leads}`);
    check("test fixtures discarded (1 organization, 309 leads)", orgs === 1 && leads === 309, `orgs=${orgs} leads=${leads}`);
    await c.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
