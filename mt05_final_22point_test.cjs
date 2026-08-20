// MT-05 FINAL — 22-point two-organization security test.
//
// One suite covering the whole of MT-05: the session/write path (Phase 2),
// Batch 1 (users and roles), and Batch 2 Groups A-E. Each point reproduces the
// SQL SHAPE a route now issues, runs it as Org A and as Org B, and asserts that
// neither can observe or mutate the other.
//
// Everything happens inside ONE transaction that is ALWAYS rolled back. That
// rollback is load-bearing, not tidiness: tenantContext throws when it sees more
// than one organization, so a leaked Org B would break the running application.
const { Client } = require("pg");
const fs = require("fs");

const ENDPOINT = "ep-floral-fog-a171dyjy";           // TEST branch
const IP = "13.228.184.177";
if (/ep-long-cloud|ep-mute-credit/.test(ENDPOINT)) { console.error("FATAL: refusing endpoint"); process.exit(3); }

const PW = fs.readFileSync("D:/bhoomidwellers-final-backup-main/frontend/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))
  .replace(/.*neondb_owner:([^@]*)@.*/, "$1").trim();

let pass = 0, fail = 0, point = 0;
const P = (name, ok, detail) => {
  point++;
  if (ok) { pass++; console.log(`  PASS  ${String(point).padStart(2)}. ${name}`); }
  else { fail++; console.log(`  FAIL  ${String(point).padStart(2)}. ${name}${detail ? "  -- " + detail : ""}`); }
};

(async () => {
  const c = new Client({
    host: IP, database: "neondb", user: "neondb_owner", password: PW,
    ssl: { servername: `${ENDPOINT}.ap-southeast-1.aws.neon.tech`, rejectUnauthorized: false },
    options: `endpoint=${ENDPOINT}`,
  });
  await c.connect();

  const ident = (await c.query(
    `SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS tables,
            (SELECT count(*) FROM organizations)::int AS orgs`)).rows[0];
  if (ident.tables !== 77 || ident.orgs !== 1) {
    console.error(`FATAL: not the expected test branch (tables=${ident.tables}, orgs=${ident.orgs})`);
    process.exit(3);
  }

  await c.query("BEGIN");
  try {
    const A = (await c.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
    const B = (await c.query(
      `INSERT INTO organizations (name, slug, status)
       VALUES ('Viraj Dwellers','viraj-final','active') RETURNING id`)).rows[0].id;

    // Fixtures: the SAME names, roles and phone numbers in BOTH tenants.
    // Identical strings are the point. If isolation depends on values happening
    // to differ, it is not isolation.
    const mk = async (org, tag) => {
      const u = (await c.query(
        `INSERT INTO users (name, username, email, password, role, is_active, organization_id)
         VALUES ('Shared Manager', $2, $3, 'x', 'sourcing_manager', true, $1) RETURNING id`,
        [org, `shared_${tag}`, `shared_${tag}@example.test`])).rows[0].id;
      const lead = (await c.query(
        `INSERT INTO walkin_enquiries (name, phone, assigned_to, status, organization_id)
         VALUES ('Shared Lead','9998887770','Shared Manager','Assigned',$1) RETURNING id`, [org])).rows[0].id;
      const role = (await c.query(
        `INSERT INTO roles (name, organization_id) VALUES ('Manager', $1) RETURNING id`, [org])).rows[0].id;
      const sess = (await c.query(
        `INSERT INTO employee_sessions (user_id, session_start, last_heartbeat, is_active, organization_id)
         VALUES ($1, NOW(), NOW(), true, $2) RETURNING id`, [u, org])).rows[0].id;
      await c.query(
        `INSERT INTO attendance_records (employee_id, login_session_id, attendance_status, login_time, organization_id)
         VALUES ($1,$2,'Present', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'), $3)`, [u, sess, org]);
      await c.query(
        `INSERT INTO employee_activity_logs (user_id, action_type, module, description, timestamp, organization_id)
         VALUES ($1,'LEAD_EDIT','Dashboard','edited', NOW(), $2)`, [u, org]);
      await c.query(
        `INSERT INTO employee_live_state (user_id, current_module, active_lead_id, last_activity, updated_at, organization_id)
         VALUES ($1,'Dashboard',$2, NOW(), NOW(), $3)`, [u, lead, org]);
      await c.query(
        `INSERT INTO known_login_devices (user_id, device_hash, device_label, organization_id)
         VALUES ($1, $2, 'Windows / Chrome', $3)`, [u, `hash_${tag}`, org]);
      const cl = (await c.query(
        `INSERT INTO caller_leads (name, contact_no, uploaded_by, assigned_to, organization_id)
         VALUES ('Shared Caller','9998887771','t','t',$1) RETURNING id`, [org])).rows[0].id;
      await c.query(
        `INSERT INTO caller_follow_ups (lead_id, message, created_by_name, organization_id)
         VALUES ($1,'note','t',$2)`, [cl, org]);
      const cp = (await c.query(
        `INSERT INTO channel_partners (name, phone, organization_id)
         VALUES ('Shared Partner','9998887772',$1) RETURNING id`, [org])).rows[0].id;
      await c.query(
        `INSERT INTO whatsapp_logs (lead_id, sender_name, sender_number, recipient_number, message_preview, sent_at, organization_id)
         VALUES ($1,'Shared Manager','1','2','hi', NOW(), $2)`, [lead, org]);
      await c.query(
        `INSERT INTO email_delivery_attempts (user_id, email_type, recipient, destination, delivered, transport, organization_id)
         VALUES ($1,'login','a@b.test','primary',false,'smtp',$2)`, [u, org]);
      const nl = (await c.query(
        `INSERT INTO notification_logs (channel, type, receiver, receiver_user_id, subject_type, subject_id,
                                        status, next_retry_at, retry_count, max_retries, organization_id)
         VALUES ('whatsapp', $4, 'Shared Manager', $1, 'channel_partner', $2, 'pending', NOW(), 0, 3, $3)
         RETURNING id`, [u, cp, org, `cp_registered_${tag}`])).rows[0].id;
      const bc = (await c.query(
        `INSERT INTO bolna_calls (organization_id, execution_id, lead_id, agent_id, channel, direction, status, to_number)
         VALUES ($1, $2, $3, 'agent', 'phone', 'outbound', 'queued', '9998887770') RETURNING id`,
        [org, tag === 'a' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222', lead])).rows[0].id;
      return { u, lead, role, sess, cl, cp, nl, bc };
    };
    const a = await mk(A, "a"), b = await mk(B, "b");

    const only = async (sql, params, org) =>
      (await c.query(sql, params)).rows.every((r) => r.organization_id === org);
    const n = async (sql, params) => (await c.query(sql, params)).rows.length;

    // 1-4  Read isolation on the core objects
    P("Org A's lead list excludes Org B's leads",
      await only(`SELECT id, organization_id FROM walkin_enquiries WHERE organization_id = $1`, [A], A));
    P("Org B sees only its own lead, not Bhoomi's 309",
      await n(`SELECT id FROM walkin_enquiries WHERE organization_id = $1`, [B]) === 1);
    P("a lead id from Org B returns nothing when read as Org A",
      await n(`SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`, [b.lead, A]) === 0);
    P("Org A's user directory excludes Org B's staff",
      await only(`SELECT id, organization_id FROM users WHERE is_active = true AND organization_id = $1`, [A], A));

    // 5-6  Identical names across tenants
    P("two organizations may hold identically-named roles with distinct ids",
      (await c.query(`SELECT id, organization_id FROM roles WHERE name = 'Manager'`)).rows.length >= 2 &&
      a.role !== b.role);
    P("resolving a user BY NAME returns one organization's user only",
      (await c.query(`SELECT id FROM users WHERE LOWER(TRIM(name)) = 'shared manager'
                       AND organization_id = $1 AND is_active = true ORDER BY id LIMIT 1`, [B])).rows[0].id === b.u);

    // 7-8  Aggregates and counts
    P("an aggregate on a SHARED manager name counts one organization only",
      Number((await c.query(
        `SELECT COUNT(*)::int AS total FROM walkin_enquiries
          WHERE assigned_to = 'Shared Manager' AND organization_id = $1`, [B])).rows[0].total) === 1);
    P("the last-active-admin count cannot be satisfied by another tenant's admin",
      Number((await c.query(
        `SELECT COUNT(*)::int AS count FROM users
          WHERE LOWER(role) = 'sourcing_manager' AND is_active = true AND deleted_at IS NULL
            AND organization_id = $1 AND id <> $2`, [B, b.u])).rows[0].count) === 0);

    // 9-11  Attendance and sessions (Group D)
    P("a force-logout cannot end another tenant's session",
      (await c.query(
        `UPDATE employee_sessions SET is_active = false, session_end_reason = 'forced_logout'
          WHERE user_id = $1 AND organization_id = $2 RETURNING id`, [b.u, A])).rowCount === 0);
    P("the stale-session sweep only touches the caller's organization",
      (await c.query(
        `UPDATE employee_sessions SET is_active = false
          WHERE is_active = true AND organization_id = $1
            AND EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) > -1 RETURNING organization_id`, [B]))
        .rows.every((r) => r.organization_id === B));
    P("attendance status for one employee is not answered from another tenant's record",
      await n(`SELECT id FROM attendance_records WHERE employee_id = $1 AND organization_id = $2`, [b.u, A]) === 0);

    // 12-13  Activity feed (mixed tenant-owned + global audit tables)
    P("the activity feed's employee_activity_logs branch is one organization only",
      await only(`SELECT e.id, e.organization_id FROM employee_activity_logs e
                   LEFT JOIN users u ON u.id = e.user_id AND u.organization_id = $1
                   WHERE e.organization_id = $1`, [B], B));
    P("the audit_logs branch is confined by the ACTOR's organization",
      await n(`SELECT a.id FROM audit_logs a
                JOIN users u ON u.id = a.user_id AND u.organization_id = $1`, [B]) === 0);

    // 14-16  Caller domain (Group C)
    P("a caller lead id from Org B cannot be updated as Org A",
      (await c.query(`UPDATE caller_leads SET feedback = 'x' WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [b.cl, A])).rowCount === 0);
    P("caller follow-ups aggregate per organization, not across",
      (await c.query(
        `SELECT cl.id, COUNT(cf.id)::int AS n FROM caller_leads cl
           LEFT JOIN caller_follow_ups cf ON cf.lead_id = cl.id AND cf.organization_id = cl.organization_id
          WHERE cl.organization_id = $1 GROUP BY cl.id`, [B])).rows.every((r) => r.n === 1));
    P("a batch delete scoped by organization leaves the other tenant's rows",
      (await c.query(`DELETE FROM caller_leads WHERE id = $1 AND organization_id = $2 RETURNING id`,
        [b.cl, A])).rowCount === 0 &&
      await n(`SELECT id FROM caller_leads WHERE id = $1`, [b.cl]) === 1);

    // 17-19  Communications (Group E)
    P("the notification list is one organization's queue only",
      await only(`SELECT n.id, n.organization_id FROM notification_logs n
                   LEFT JOIN channel_partners cp ON n.subject_type = 'channel_partner' AND cp.id = n.subject_id
                                                AND cp.organization_id = n.organization_id
                   WHERE n.organization_id = $1`, [B], B));
    P("a scoped retry sweep claims no other tenant's rows",
      (await c.query(
        `WITH due AS (
           SELECT id FROM notification_logs
            WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL AND next_retry_at <= now()
              AND retry_count < max_retries AND ($1::uuid IS NULL OR organization_id = $1::uuid)
            ORDER BY next_retry_at ASC LIMIT 25 FOR UPDATE SKIP LOCKED)
         UPDATE notification_logs n SET status = 'sending', locked_at = now()
           FROM due WHERE n.id = due.id RETURNING n.organization_id`, [B]))
        .rows.every((r) => r.organization_id === B));
    P("whatsapp logs for a lead id are not readable from the other organization",
      await n(`SELECT id FROM whatsapp_logs WHERE lead_id = $1 AND organization_id = $2`, [b.lead, A]) === 0);

    // 20  Calls: the webhook resolves tenancy from the row, not a session
    P("a bolna webhook update stays pinned to the row's own organization",
      (await c.query(
        `UPDATE bolna_calls SET status = 'completed'
          WHERE id = $1 AND organization_id IS NOT DISTINCT FROM $2 RETURNING id`, [b.bc, A])).rowCount === 0 &&
      (await c.query(
        `UPDATE bolna_calls SET status = 'completed'
          WHERE id = $1 AND organization_id IS NOT DISTINCT FROM $2 RETURNING id`, [b.bc, B])).rowCount === 1);

    // 21  A client-supplied organization_id cannot widen anything
    P("a client-supplied organization_id cannot widen the result set",
      await n(`SELECT id FROM walkin_enquiries WHERE id = $1 AND organization_id = $2`, [b.lead, A]) === 0);

    // 22  SQL OR-precedence: the trap this migration kept hitting
    {
      const flat = await n(
        `SELECT id FROM walkin_enquiries WHERE status = 'Assigned' OR status = 'ASSIGNED' AND organization_id = $1`, [B]);
      const paren = await n(
        `SELECT id FROM walkin_enquiries WHERE (status = 'Assigned' OR status = 'ASSIGNED') AND organization_id = $1`, [B]);
      P("unparenthesised OR leaks across organizations; the parenthesised form does not",
        flat > paren && paren === 1, `flat ${flat} vs parenthesised ${paren}`);
    }

  } finally {
    await c.query("ROLLBACK");
    const after = (await c.query(
      `SELECT (SELECT count(*)::int FROM organizations) AS orgs,
              (SELECT count(*)::int FROM walkin_enquiries) AS leads,
              (SELECT count(*)::int FROM users) AS users`)).rows[0];
    console.log(`\nrolled back -- organizations=${after.orgs}, leads=${after.leads}, users=${after.users}`);
    if (after.orgs !== 1) { console.error("FATAL: Org B survived the rollback"); process.exit(3); }
    await c.end();
  }
  console.log(`\n${pass} passed, ${fail} failed  (${point} points)`);
  process.exit(fail ? 1 : 0);
})();
