// test-deletion-child-branch.js
// Tests lead deletion on the Neon CHILD BRANCH only.
// SAFETY: Refuses to run if connected to production (ep-long-cloud).

const { Client } = require("pg");

const CHILD_BRANCH_URL =
  "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-withered-hat-a1oaf3aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const PRODUCTION_ENDPOINT = "ep-long-cloud";
const EXPECTED_ENDPOINT = "ep-withered-hat-a1oaf3aj";

async function main() {
  const client = new Client({
    connectionString: CHILD_BRANCH_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 0: SAFETY — Verify we are on the child branch, NOT production
  // ═══════════════════════════════════════════════════════════════════════
  const epResult = await client.query(
    "SELECT setting FROM pg_settings WHERE name = 'neon.endpoint_id'"
  );
  const endpoint = epResult.rows[0]?.setting || "UNKNOWN";
  console.log(`\n=== BRANCH SAFETY CHECK ===`);
  console.log(`Neon endpoint: ${endpoint}`);

  if (endpoint.startsWith(PRODUCTION_ENDPOINT)) {
    console.error("FATAL: Connected to PRODUCTION. Aborting immediately.");
    await client.end();
    process.exit(1);
  }
  if (!endpoint.startsWith(EXPECTED_ENDPOINT)) {
    console.error(
      `FATAL: Unexpected endpoint '${endpoint}'. Expected '${EXPECTED_ENDPOINT}'. Aborting.`
    );
    await client.end();
    process.exit(1);
  }
  console.log("SAFE: Confirmed child branch. Proceeding.\n");

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Check FK constraints referencing walkin_enquiries
  // ═══════════════════════════════════════════════════════════════════════
  console.log("=== FK CONSTRAINTS REFERENCING walkin_enquiries ===");
  const fkResult = await client.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'walkin_enquiries'
      AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY tc.table_name
  `);
  for (const row of fkResult.rows) {
    console.log(
      `  ${row.table_name}.${row.column_name} -> ON DELETE ${row.delete_rule}`
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: Check which key tables exist
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== KEY TABLES EXISTENCE ===");
  const tableCheck = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
      'follow_ups','follow_up_attachments','site_visits','booking_applications',
      'lead_reminders','financial_adjustments','inventory_units','inventory_unit_waitlist',
      'whatsapp_conversations','whatsapp_messages','bolna_calls','whatsapp_logs',
      'lead_deletion_audit_logs','booking_history','cp_assignment_history',
      'inventory_cost_sheets','inventory_offers','loan_applications',
      'booking_documents','booking_forms','disbursement_tranches',
      'cp_commissions','employee_live_state','admin_audit_logs',
      'employee_activity_logs','lead_assignment_logs','employee_assignments'
    )
    ORDER BY table_name
  `);
  for (const t of tableCheck.rows) console.log(`  ${t.table_name}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Check triggers on walkin_enquiries
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== TRIGGERS ON walkin_enquiries ===");
  const trigResult = await client.query(`
    SELECT trigger_name, event_manipulation, action_timing
    FROM information_schema.triggers
    WHERE event_object_table = 'walkin_enquiries'
  `);
  for (const t of trigResult.rows) {
    console.log(`  ${t.trigger_name} (${t.action_timing} ${t.event_manipulation})`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4: Find a real org for test data
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== ORGANIZATIONS ===");
  const orgs = await client.query(
    "SELECT id, name FROM organizations ORDER BY name LIMIT 10"
  );
  for (const o of orgs.rows) console.log(`  ${o.id} — ${o.name}`);

  const testOrgId = orgs.rows[0]?.id;
  if (!testOrgId) {
    console.error("No organizations found. Cannot proceed.");
    await client.end();
    process.exit(1);
  }
  console.log(`\nUsing org: ${testOrgId}`);

  // Find a user in this org for test data
  const userResult = await client.query(
    "SELECT id, name, role FROM users WHERE organization_id = $1 LIMIT 5",
    [testOrgId]
  );
  console.log("\n=== USERS IN TEST ORG ===");
  for (const u of userResult.rows)
    console.log(`  ${u.id} — ${u.name} (${u.role})`);

  const testUserId = userResult.rows[0]?.id;
  const testUserName = userResult.rows[0]?.name || "TestUser";

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 5: Create a dedicated test lead with full dependent records
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== CREATING TEST LEAD ===");

  // Check what columns walkin_enquiries has
  const weCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'walkin_enquiries'
    ORDER BY ordinal_position
  `);
  const colSet = new Set(weCols.rows.map((r) => r.column_name));
  console.log(`  walkin_enquiries has ${colSet.size} columns`);

  // Insert test lead
  const leadInsert = await client.query(
    `INSERT INTO walkin_enquiries (name, phone, email, organization_id, status, source)
     VALUES ('TEST_DELETION_LEAD', '9999999999', 'test-delete@test.com', $1, 'New', 'Walk-In')
     RETURNING id, name`,
    [testOrgId]
  );
  const testLeadId = leadInsert.rows[0].id;
  console.log(`  Created test lead: id=${testLeadId}, name=${leadInsert.rows[0].name}`);

  // ── Insert follow_ups ──
  let followUpId = null;
  try {
    const fuInsert = await client.query(
      `INSERT INTO follow_ups (lead_id, message, created_by_name, organization_id)
       VALUES ($1, 'Test follow-up for deletion', $2, $3)
       RETURNING id`,
      [testLeadId, testUserName, testOrgId]
    );
    followUpId = fuInsert.rows[0].id;
    console.log(`  Created follow_up: id=${followUpId}`);
  } catch (e) {
    console.log(`  follow_ups insert skipped: ${e.message}`);
  }

  // ── Insert follow_up_attachments (if follow_up created) ──
  if (followUpId) {
    try {
      await client.query(
        `INSERT INTO follow_up_attachments (organization_id, follow_up_id, file_name, mime_type, r2_object_key)
         VALUES ($1, $2, 'test.pdf', 'application/pdf', 'test-deletion/fake-key.pdf')`,
        [testOrgId, followUpId]
      );
      console.log("  Created follow_up_attachment");
    } catch (e) {
      console.log(`  follow_up_attachments insert skipped: ${e.message}`);
    }
  }

  // ── Insert site_visits ──
  try {
    await client.query(
      `INSERT INTO site_visits (lead_id, visit_date, created_by, organization_id)
       VALUES ($1, NOW(), $2, $3)`,
      [testLeadId, testUserName, testOrgId]
    );
    console.log("  Created site_visit");
  } catch (e) {
    console.log(`  site_visits insert skipped: ${e.message}`);
  }

  // ── Insert lead_reminders ──
  if (testUserId) {
    try {
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, remind_at)
         VALUES ($1, $2, $3, $3, $4, NOW() + INTERVAL '1 day')`,
        [testLeadId, testOrgId, testUserId, testUserName]
      );
      console.log("  Created lead_reminder");
    } catch (e) {
      console.log(`  lead_reminders insert skipped: ${e.message}`);
    }
  }

  // ── Insert whatsapp_logs ──
  try {
    await client.query(
      `INSERT INTO whatsapp_logs (lead_id, sender_name, sender_number, recipient_number, message_preview, organization_id)
       VALUES ($1, $2, '1234567890', '0987654321', 'Test WA message', $3)`,
      [testLeadId, testUserName, testOrgId]
    );
    console.log("  Created whatsapp_log");
  } catch (e) {
    console.log(`  whatsapp_logs insert skipped: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 6: Count all records BEFORE deletion
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== RECORD COUNTS BEFORE DELETION ===");

  const countQuery = async (table, col, id) => {
    try {
      const r = await client.query(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE ${col}::text = $1`,
        [String(id)]
      );
      return parseInt(r.rows[0].cnt);
    } catch {
      return -1; // table doesn't exist
    }
  };

  const beforeCounts = {};
  const tablesToCheck = [
    ["follow_ups", "lead_id"],
    ["site_visits", "lead_id"],
    ["whatsapp_logs", "lead_id"],
    ["lead_reminders", "lead_id"],
    ["booking_applications", "lead_id"],
    ["employee_activity_logs", "lead_id"],
    ["lead_assignment_logs", "lead_id"],
  ];

  for (const [table, col] of tablesToCheck) {
    const cnt = await countQuery(table, col, testLeadId);
    beforeCounts[table] = cnt;
    if (cnt >= 0) console.log(`  ${table}: ${cnt}`);
    else console.log(`  ${table}: (table not found)`);
  }

  // follow_up_attachments via subquery
  if (followUpId) {
    try {
      const r = await client.query(
        `SELECT COUNT(*) as cnt FROM follow_up_attachments
         WHERE follow_up_id IN (SELECT id FROM follow_ups WHERE lead_id::text = $1)`,
        [String(testLeadId)]
      );
      beforeCounts["follow_up_attachments"] = parseInt(r.rows[0].cnt);
      console.log(`  follow_up_attachments: ${beforeCounts["follow_up_attachments"]}`);
    } catch {
      console.log("  follow_up_attachments: (error)");
    }
  }

  // Total leads before
  const totalBefore = await client.query("SELECT COUNT(*) as cnt FROM walkin_enquiries");
  console.log(`\n  Total leads in DB: ${totalBefore.rows[0].cnt}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 7: Execute deletion using the SAME logic as leadDeletion.ts
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== EXECUTING LEAD DELETION ===");
  console.log(`  Deleting test lead id=${testLeadId}...`);

  await client.query("BEGIN");

  try {
    // Verify lead exists and lock it
    const lockResult = await client.query(
      "SELECT id, name, organization_id FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
      [testLeadId]
    );
    if (lockResult.rows.length === 0) throw new Error("Lead not found");

    const leadOrgId = lockResult.rows[0].organization_id;
    console.log(`  Locked lead: org=${leadOrgId}`);

    // Verify org match
    if (String(leadOrgId) !== String(testOrgId)) {
      throw new Error("Org mismatch — refusing to delete");
    }

    // Delete in the same order as leadDeletion.ts LEAD_RELATED_DELETES
    const deleteResults = {};

    // Helper: safe delete
    const safeDelete = async (table, column) => {
      try {
        const colCheck = await client.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
          [table, column]
        );
        if (colCheck.rows.length === 0) {
          deleteResults[table] = "skipped (no column)";
          return;
        }
        const r = await client.query(
          `DELETE FROM "${table}" WHERE "${column}"::text = $1`,
          [String(testLeadId)]
        );
        deleteResults[table] = r.rowCount;
      } catch (e) {
        deleteResults[table] = `error: ${e.message}`;
      }
    };

    // Helper: safe nullify
    const safeNull = async (table, column) => {
      try {
        const colCheck = await client.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
          [table, column]
        );
        if (colCheck.rows.length === 0) return;
        const r = await client.query(
          `UPDATE "${table}" SET "${column}" = NULL WHERE "${column}"::text = $1`,
          [String(testLeadId)]
        );
        deleteResults[`${table}.${column}_nulled`] = r.rowCount;
      } catch (e) {
        deleteResults[`${table}.${column}_nulled`] = `error: ${e.message}`;
      }
    };

    // ── follow_up_attachments via subquery FIRST ──
    try {
      const r = await client.query(
        `DELETE FROM follow_up_attachments
         WHERE follow_up_id IN (SELECT id FROM follow_ups WHERE lead_id::text = $1)`,
        [String(testLeadId)]
      );
      deleteResults["follow_up_attachments"] = r.rowCount;
    } catch (e) {
      deleteResults["follow_up_attachments"] = `error: ${e.message}`;
    }

    // ── cp_commissions via booking_id subquery ──
    try {
      const r = await client.query(
        `DELETE FROM cp_commissions
         WHERE booking_id IN (SELECT id FROM booking_applications WHERE lead_id::text = $1)`,
        [String(testLeadId)]
      );
      deleteResults["cp_commissions"] = r.rowCount;
    } catch (e) {
      deleteResults["cp_commissions"] = `skip: ${e.message.slice(0, 60)}`;
    }

    // ── inventory_units.booking_id NULL via booking subquery ──
    try {
      const r = await client.query(
        `UPDATE inventory_units SET booking_id = NULL
         WHERE booking_id IN (SELECT id FROM booking_applications WHERE lead_id::text = $1)`,
        [String(testLeadId)]
      );
      deleteResults["inventory_units.booking_id_nulled"] = r.rowCount;
    } catch (e) {
      deleteResults["inventory_units.booking_id_nulled"] = `skip: ${e.message.slice(0, 60)}`;
    }

    // ── Main deletion list (same order as LEAD_RELATED_DELETES) ──
    const LEAD_RELATED = [
      "disbursement_tranches", "financial_adjustments", "loan_applications",
      "booking_documents", "booking_forms", "booking_applications",
      "customer_documents", "lead_documents", "uploaded_documents",
      "loan_updates", "follow_ups", "notes", "lead_notes",
      "site_visits", "whatsapp_logs", "email_history", "call_history",
      "reminders", "lead_reminders", "notification_records", "notifications",
      "ai_conversations", "audit_references", "employee_assignments",
      "lead_assignment_logs", "employee_activity_logs",
      "bookings", "customers",
    ];

    for (const table of LEAD_RELATED) {
      await safeDelete(table, "lead_id");
    }

    // ── Inventory NULLs ──
    await safeNull("inventory_units", "lead_id");
    await safeNull("inventory_units", "held_for_lead_id");
    await safeNull("inventory_cost_sheets", "lead_id");
    await safeNull("inventory_offers", "lead_id");

    // ── employee_live_state ──
    try {
      const r = await client.query(
        `UPDATE employee_live_state SET active_lead_id = NULL, active_lead_name = NULL
         WHERE active_lead_id::text = $1 AND organization_id = $2`,
        [String(testLeadId), testOrgId]
      );
      deleteResults["employee_live_state_cleared"] = r.rowCount;
    } catch (e) {
      deleteResults["employee_live_state_cleared"] = `skip: ${e.message.slice(0, 60)}`;
    }

    // ── Finally: delete the lead itself ──
    const leadDel = await client.query(
      "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
      [testLeadId, testOrgId]
    );
    deleteResults["walkin_enquiries"] = leadDel.rowCount;

    await client.query("COMMIT");

    console.log("  Deletion COMMITTED successfully.\n");
    console.log("=== DELETION RESULTS ===");
    for (const [key, val] of Object.entries(deleteResults)) {
      if (val !== 0 && val !== "skipped (no column)") {
        console.log(`  ${key}: ${val}`);
      }
    }

    // Print skipped tables separately
    const skipped = Object.entries(deleteResults).filter(
      ([, v]) => v === "skipped (no column)" || v === 0
    );
    if (skipped.length > 0) {
      console.log("\n  Skipped/zero:");
      for (const [k, v] of skipped) console.log(`    ${k}: ${v}`);
    }
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`  DELETION FAILED — ROLLED BACK: ${e.message}`);
    // Clean up the test lead
    await client.query("DELETE FROM walkin_enquiries WHERE id = $1", [testLeadId]);
    await client.end();
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 8: Verify all records are gone
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== RECORD COUNTS AFTER DELETION ===");

  for (const [table, col] of tablesToCheck) {
    const cnt = await countQuery(table, col, testLeadId);
    const status = cnt === 0 ? "PASS" : cnt === -1 ? "N/A" : `FAIL (${cnt} remaining)`;
    console.log(`  ${table}: ${status}`);
  }

  // Verify lead is gone
  const leadCheck = await client.query(
    "SELECT COUNT(*) as cnt FROM walkin_enquiries WHERE id = $1",
    [testLeadId]
  );
  const leadGone = parseInt(leadCheck.rows[0].cnt) === 0;
  console.log(`  walkin_enquiries (lead itself): ${leadGone ? "PASS" : "FAIL"}`);

  // Verify total lead count decreased by 1
  const totalAfter = await client.query("SELECT COUNT(*) as cnt FROM walkin_enquiries");
  const expectedTotal = parseInt(totalBefore.rows[0].cnt); // We added 1 then deleted 1
  const actualTotal = parseInt(totalAfter.rows[0].cnt);
  console.log(
    `\n  Total leads: before=${expectedTotal}, after=${actualTotal} (${
      expectedTotal === actualTotal ? "PASS — net zero" : "CHECK"
    })`
  );

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 9: Test RESTRICT FK blocking (lead_reminders)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== RESTRICT FK TEST (lead_reminders) ===");

  // Create a lead with a reminder, then try to delete lead WITHOUT deleting reminder first
  const lead2 = await client.query(
    `INSERT INTO walkin_enquiries (name, phone, organization_id, status, source)
     VALUES ('TEST_RESTRICT_FK', '8888888888', $1, 'New', 'Walk-In')
     RETURNING id`,
    [testOrgId]
  );
  const lead2Id = lead2.rows[0].id;

  if (testUserId) {
    try {
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, remind_at)
         VALUES ($1, $2, $3, $3, $4, NOW() + INTERVAL '1 day')`,
        [lead2Id, testOrgId, testUserId, testUserName]
      );

      // Try to delete lead WITHOUT deleting reminder — should fail with FK violation
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM walkin_enquiries WHERE id = $1", [lead2Id]);
        await client.query("COMMIT");
        console.log("  FAIL: Lead deleted despite RESTRICT FK on lead_reminders!");
      } catch (fkErr) {
        await client.query("ROLLBACK");
        if (fkErr.message.includes("violates foreign key") || fkErr.message.includes("still referenced")) {
          console.log("  PASS: RESTRICT FK correctly blocked lead deletion");
          console.log(`  Error: ${fkErr.message.slice(0, 100)}`);
        } else {
          console.log(`  UNEXPECTED ERROR: ${fkErr.message}`);
        }
      }

      // Clean up: delete reminder first, then lead
      await client.query("DELETE FROM lead_reminders WHERE lead_id = $1", [lead2Id]);
      await client.query("DELETE FROM walkin_enquiries WHERE id = $1", [lead2Id]);
      console.log("  Cleaned up test lead #2");
    } catch (e) {
      console.log(`  Reminder test skipped: ${e.message}`);
      await client.query("DELETE FROM walkin_enquiries WHERE id = $1", [lead2Id]).catch(() => {});
    }
  } else {
    await client.query("DELETE FROM walkin_enquiries WHERE id = $1", [lead2Id]);
    console.log("  Skipped (no test user for reminder)");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 10: Verify unrelated records are untouched
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n=== UNRELATED RECORDS INTEGRITY ===");

  const orgCount = await client.query("SELECT COUNT(*) as cnt FROM organizations");
  console.log(`  organizations: ${orgCount.rows[0].cnt} (should be 4)`);

  const userCount = await client.query("SELECT COUNT(*) as cnt FROM users");
  console.log(`  users: ${userCount.rows[0].cnt} (should be 42)`);

  // Check inventory_units are untouched (we had no booking so nothing should have changed)
  try {
    const invCount = await client.query("SELECT COUNT(*) as cnt FROM inventory_units");
    console.log(`  inventory_units: ${invCount.rows[0].cnt}`);
  } catch {
    console.log("  inventory_units: table not found");
  }

  console.log("\n=== ALL TESTS COMPLETE ===\n");
  await client.end();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
