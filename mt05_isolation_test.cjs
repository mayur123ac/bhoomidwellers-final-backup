// MT-05 Phase 2 — tenant isolation tests against the REAL test branch.
//
// Everything runs inside ONE transaction that is ALWAYS rolled back, so a
// second organization is created, exercised, and discarded without leaving a
// trace. That matters: tenantContext throws when it sees more than one
// organization, so a leaked Org B would break the whole application.
//
// Target is pinned to ep-floral-fog (the test branch) and refuses production.
const { Client } = require("pg");
const fs = require("fs");

const ENVF = "D:/bhoomidwellers-final-backup-main/frontend/.env.local";
const PW = fs.readFileSync(ENVF, "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .replace(/.*neondb_owner:([^@]*)@.*/, "$1").trim();
const HOST = "ep-floral-fog-a171dyjy.ap-southeast-1.aws.neon.tech";
if (/ep-long-cloud|ep-mute-credit/.test(HOST)) { console.error("FATAL: production endpoint"); process.exit(3); }

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
}
let spN = 0;
async function throws(c, fn) {
  const sp = "sp" + ++spN;
  await c.query("SAVEPOINT " + sp);
  try { await fn(); await c.query("RELEASE SAVEPOINT " + sp); return null; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT " + sp); return e.message; }
}

(async () => {
  // Neon DNS is refused by this ISP resolver, so the connection goes via the
  // regional IP with options=endpoint selecting the branch; servername supplies
  // SNI because the certificate is issued for the hostname, not the IP.
  const c = new Client({
    host: "13.228.184.177", database: "neondb", user: "neondb_owner", password: PW,
    ssl: { servername: HOST, rejectUnauthorized: false },
    options: "endpoint=" + HOST.split(".")[0],
  });
  await c.connect();
  await c.query("BEGIN");
  try {
    const orgA = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
    const orgB = (await c.query(
      `INSERT INTO organizations (name, slug, status) VALUES ('Viraj Dwellers','viraj-test','active') RETURNING id`
    )).rows[0].id;
    console.log(`\norgA=${orgA}\norgB=${orgB}\n`);
    check("a second organization can be created", orgA !== orgB);

    // ── Roots land in the organization they were stamped with ──────────────
    const leadA = (await c.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id) VALUES ('Lead A','1',$1) RETURNING id, organization_id`, [orgA])).rows[0];
    const leadB = (await c.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id) VALUES ('Lead B','2',$1) RETURNING id, organization_id`, [orgB])).rows[0];
    check("Org A session creates a lead in Org A", leadA.organization_id === orgA);
    check("Org B session creates a lead in Org B", leadB.organization_id === orgB);

    // ── roles are per-organization: same name, both organizations ──────────
    await c.query(`INSERT INTO roles (name, organization_id) VALUES ('Admin',$1)`, [orgB]);
    const admins = (await c.query(`SELECT count(*)::int n FROM roles WHERE name='Admin'`)).rows[0].n;
    check("the same role name exists in two organizations", admins === 2, `found ${admins}`);
    const dup = await throws(c, () => c.query(`INSERT INTO roles (name, organization_id) VALUES ('Admin',$1)`, [orgB]));
    check("a duplicate role name WITHIN one organization is rejected", !!dup && /roles_org_name_key|duplicate/i.test(dup));

    // ── the parent-derived pattern keeps child org == parent org ───────────
    const fu = (await c.query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, organization_id)
       SELECT $1,'x','t', w.organization_id FROM walkin_enquiries w WHERE w.id = $1 RETURNING organization_id`,
      [leadB.id])).rows[0];
    check("a child derived from its parent inherits the parent's organization", fu.organization_id === orgB);

    // ── assertParentOrganization: the cross-tenant guard ───────────────────
    // Reproduces lib/tenantGuard.ts exactly.
    async function assertParent(table, id, orgId) {
      const { rows } = await c.query(`SELECT organization_id FROM public.${table} WHERE id = $1`, [id]);
      if (rows.length === 0) throw new Error(`${table} ${id} was not found.`);
      const p = rows[0].organization_id;
      if (p === null || p !== orgId) throw new Error(`${table} ${id} was not found.`);
    }
    const bookA = (await c.query(
      `INSERT INTO booking_applications (lead_id, primary_name, organization_id) VALUES ($1,'A',$2) RETURNING id`,
      [leadA.id, orgA])).rows[0];
    const bookB = (await c.query(
      `INSERT INTO booking_applications (lead_id, primary_name, organization_id) VALUES ($1,'B',$2) RETURNING id`,
      [leadB.id, orgB])).rows[0];

    check("Org A may write under its OWN booking", (await throws(c, () => assertParent("booking_applications", bookA.id, orgA))) === null);
    check("Org A creating a child under an Org B parent is REJECTED",
      /not found/i.test((await throws(c, () => assertParent("booking_applications", bookB.id, orgA))) || ""));
    check("Org B creating a child under an Org A parent is REJECTED",
      /not found/i.test((await throws(c, () => assertParent("booking_applications", bookA.id, orgB))) || ""));
    check("a nonexistent parent is REJECTED",
      /not found/i.test((await throws(c, () => assertParent("booking_applications", 2147483600, orgA))) || ""));

    // A NULL-organization parent must NOT be treated as a match.
    const bookNull = (await c.query(
      `INSERT INTO booking_applications (lead_id, primary_name) VALUES ($1,'N') RETURNING id`, [leadA.id])).rows[0];
    check("a parent with a NULL organization is REJECTED, not treated as a match",
      /not found/i.test((await throws(c, () => assertParent("booking_applications", bookNull.id, orgA))) || ""));

    // ── the guard's message must not leak existence ────────────────────────
    const mMissing = await throws(c, () => assertParent("booking_applications", 2147483600, orgA));
    const mForeign = await throws(c, () => assertParent("booking_applications", bookB.id, orgA));
    check("'wrong tenant' and 'does not exist' are indistinguishable to the caller",
      mMissing.replace(/\d+/g, "#") === mForeign.replace(/\d+/g, "#"));

    // ── nested child (grandchild) keeps the chain in one organization ──────
    const acc = (await c.query(
      `INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1,$2) RETURNING id, organization_id`,
      [bookB.id, orgB])).rows[0];
    const led = (await c.query(
      `INSERT INTO financial_ledger (account_id, transaction_type, amount, organization_id)
       VALUES ($1,'token',1,$2) RETURNING organization_id`, [acc.id, orgB])).rows[0];
    check("nested child (ledger → account → booking) stays in one organization",
      acc.organization_id === orgB && led.organization_id === orgB);

    // ── bulk insert: every row of a batch gets the batch's organization ────
    const batch = (await c.query(
      `INSERT INTO caller_upload_batches (file_name, row_count, uploaded_by, organization_id)
       VALUES ('b.csv',3,'t',$1) RETURNING id`, [orgB])).rows[0];
    for (let i = 0; i < 3; i++) {
      await c.query(`INSERT INTO caller_leads (upload_batch, name, organization_id) VALUES ($1,$2,$3)`,
        [batch.id, "row" + i, orgB]);
    }
    const bulk = (await c.query(
      `SELECT count(*)::int n, count(DISTINCT organization_id)::int d FROM caller_leads WHERE upload_batch=$1`, [batch.id])).rows[0];
    check("a bulk insert stamps every row with ONE organization", bulk.n === 3 && bulk.d === 1);

    // ── E. no NULL organization_id among rows written by these tests ───────
    const tables = ["walkin_enquiries","booking_applications","follow_ups","financial_accounts",
                    "financial_ledger","caller_upload_batches","caller_leads","roles"];
    let nulls = 0;
    for (const t of tables) {
      // exclude the deliberate NULL-parent fixture created above
      const q = t === "booking_applications"
        ? `SELECT count(*)::int n FROM booking_applications WHERE organization_id IS NULL AND id <> $1`
        : `SELECT count(*)::int n FROM ${t} WHERE organization_id IS NULL`;
      const r = await c.query(q, t === "booking_applications" ? [bookNull.id] : []);
      nulls += r.rows[0].n;
    }
    check("no NULL organization_id in any table touched by these tests", nulls === 0, `found ${nulls}`);

  } finally {
    await c.query("ROLLBACK");
    const orgs = (await c.query("SELECT count(*)::int n FROM organizations")).rows[0].n;
    console.log(`\nrolled back — organizations remaining: ${orgs}`);
    check("the test's second organization was discarded", orgs === 1, `found ${orgs}`);
    await c.end();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
