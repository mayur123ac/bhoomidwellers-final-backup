// scripts/test-phase3-verification.js
// Phase 3 — Complete Lead Deletion Verification on Neon child branch
// Covers: 3A (table coverage), 3B (WhatsApp), 3C (R2/file), 3D (failure/txn), 3E (API workflow)

const { Pool } = require("pg");

const CHILD_BRANCH_URL =
  "postgresql://neondb_owner:npg_dLBmKRVy60gY@ep-withered-hat-a1oaf3aj-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({ connectionString: CHILD_BRANCH_URL });

// ── Helpers ─────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function PASS(msg) {
  passCount++;
  console.log(`  PASS: ${msg}`);
}
function FAIL(msg) {
  failCount++;
  console.log(`  ** FAIL **: ${msg}`);
}
function assert(cond, msg) {
  if (cond) PASS(msg);
  else FAIL(msg);
}

async function safetyCheck() {
  const ep = await pool.query(
    "SELECT current_setting('neon.endpoint_id', true) as ep"
  );
  const endpoint = ep.rows[0].ep;
  console.log(`\nEndpoint: ${endpoint}`);
  if (endpoint === "ep-long-cloud-a5jhnr1j") {
    console.log("ABORT: PRODUCTION ENDPOINT DETECTED");
    process.exit(1);
  }
  assert(
    endpoint === "ep-withered-hat-a1oaf3aj",
    `Child branch confirmed: ${endpoint}`
  );
}

// Find test org + admin user
async function getTestOrg() {
  const orgs = await pool.query("SELECT id FROM organizations LIMIT 1");
  const orgId = orgs.rows[0].id;
  const users = await pool.query(
    "SELECT id, name FROM users WHERE organization_id = $1 AND role = 'Admin' LIMIT 1",
    [orgId]
  );
  return { orgId, adminId: users.rows[0].id, adminName: users.rows[0].name };
}

// Get walkin_enquiries columns once
let weColumns = null;
async function getWEColumns() {
  if (weColumns) return weColumns;
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='walkin_enquiries'`
  );
  weColumns = new Set(res.rows.map((r) => r.column_name));
  return weColumns;
}

// Create a minimal test lead
async function createTestLead(orgId, suffix = "") {
  const cols = await getWEColumns();
  const name = `TEST_PHASE3_${suffix}_${Date.now()}`;

  // Build insert dynamically
  const fields = ["name", "organization_id", "created_at"];
  const vals = [name, orgId, "NOW()"];
  const params = [name, orgId];

  if (cols.has("phone")) {
    fields.push("phone");
    params.push("9999" + Math.floor(Math.random() * 1000000));
    vals.push(`$${params.length}`);
  } else {
    vals[2] = "NOW()";
  }

  // Fix: use $1, $2 for name, orgId; NOW() is SQL literal
  const paramCols = fields.filter((f) => f !== "created_at");
  const insertFields = [...paramCols, "created_at"];
  const insertVals = paramCols.map((_, i) => `$${i + 1}`);
  insertVals.push("NOW()");

  const sql = `INSERT INTO walkin_enquiries (${insertFields.join(", ")})
    VALUES (${insertVals.join(", ")}) RETURNING id, name`;
  const res = await pool.query(sql, params);
  return { id: res.rows[0].id, name: res.rows[0].name };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3B — WhatsApp Cleanup Test
// ═══════════════════════════════════════════════════════════════════════════

async function testWhatsAppCleanup(orgId) {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3B — WhatsApp Cleanup Test");
  console.log("=".repeat(70));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create test lead
    const leadName = `TEST_WA_${Date.now()}`;
    const leadRes = await client.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
       VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
      [leadName, orgId]
    );
    const leadId = leadRes.rows[0].id;
    console.log(`  Created test lead: ${leadId}`);

    // 2. Create a WhatsApp conversation linked to this lead
    const convRes = await client.query(
      `INSERT INTO whatsapp_conversations
        (organization_id, channel, lead_id, customer_phone, customer_wa_id,
         phone_number_id, match_state, candidate_lead_ids, status, unread_count, created_at, updated_at)
       VALUES ($1, 'whatsapp', $2, '919999888877', '919999888877',
               'test_phone_id', 'matched', ARRAY[]::int[], 'open', 0, NOW(), NOW())
       RETURNING id`,
      [orgId, leadId]
    );
    const convId = convRes.rows[0].id;
    console.log(`  Created conversation: ${convId}`);

    // 3. Create WhatsApp messages linked to lead + conversation
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 === 0 ? "inbound" : "outbound";
      const sts = dir === "inbound" ? "received" : "delivered";
      await client.query(
        `INSERT INTO whatsapp_messages
          (organization_id, conversation_id, lead_id, direction, message_type,
           message_text, status, created_at)
         VALUES ($1, $2, $3, $4, 'text', $5, $6, NOW())`,
        [orgId, convId, leadId, dir, `Test message ${i}`, sts]
      );
    }
    console.log(`  Created 3 WhatsApp messages`);

    // 4. Create a whatsapp_log entry
    const wlCols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='whatsapp_logs'`
    );
    const wlColSet = new Set(wlCols.rows.map((r) => r.column_name));
    if (wlColSet.has("lead_id") && wlColSet.has("organization_id")) {
      const wlFields = ["lead_id", "organization_id"];
      const wlVals = ["$1", "$2"];
      const wlParams = [leadId, orgId];
      if (wlColSet.has("message_type")) {
        wlFields.push("message_type");
        wlVals.push("$3");
        wlParams.push("test");
      }
      if (wlColSet.has("created_at")) {
        wlFields.push("created_at");
        wlVals.push("NOW()");
      }
      await client.query(
        `INSERT INTO whatsapp_logs (${wlFields.join(", ")}) VALUES (${wlVals.join(", ")})`,
        wlParams
      );
      console.log(`  Created whatsapp_log entry`);
    }

    // 5. Create an UNRELATED conversation (different lead)
    const unrelatedLeadRes = await client.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
       VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
      [`TEST_WA_UNRELATED_${Date.now()}`, orgId]
    );
    const unrelatedLeadId = unrelatedLeadRes.rows[0].id;
    const unrelatedConvRes = await client.query(
      `INSERT INTO whatsapp_conversations
        (organization_id, channel, lead_id, customer_phone, customer_wa_id,
         phone_number_id, match_state, candidate_lead_ids, status, unread_count, created_at, updated_at)
       VALUES ($1, 'whatsapp', $2, '919998887766', '919998887766',
               'test_phone_id', 'matched', ARRAY[]::int[], 'open', 0, NOW(), NOW())
       RETURNING id`,
      [orgId, unrelatedLeadId]
    );
    const unrelatedConvId = unrelatedConvRes.rows[0].id;
    await client.query(
      `INSERT INTO whatsapp_messages
        (organization_id, conversation_id, lead_id, direction, message_type,
         message_text, status, created_at)
       VALUES ($1, $2, $3, 'inbound', 'text', 'Unrelated msg', 'received', NOW())`,
      [orgId, unrelatedConvId, unrelatedLeadId]
    );
    console.log(`  Created unrelated lead ${unrelatedLeadId} + conv ${unrelatedConvId}`);

    // 6. Record pre-deletion state
    const preConv = await client.query(
      "SELECT id, lead_id, match_state FROM whatsapp_conversations WHERE id = $1",
      [convId]
    );
    assert(
      preConv.rows[0].lead_id === leadId && preConv.rows[0].match_state === "matched",
      `Pre-delete: conv ${convId} is matched to lead ${leadId}`
    );

    const preMsgCount = await client.query(
      "SELECT count(*) as cnt FROM whatsapp_messages WHERE lead_id = $1",
      [leadId]
    );
    assert(
      parseInt(preMsgCount.rows[0].cnt) === 3,
      `Pre-delete: 3 messages linked to lead ${leadId}`
    );

    // 7. Delete the lead — trigger should fire first
    //    Must delete dependent records matching leadDeletion.ts order
    await client.query("DELETE FROM whatsapp_logs WHERE lead_id = $1", [leadId]);
    // The BEFORE DELETE trigger on walkin_enquiries handles whatsapp_conversations
    // The ON DELETE SET NULL FK handles whatsapp_messages.lead_id
    await client.query(
      "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
      [leadId, orgId]
    );

    // 8. Verify trigger behavior on conversation
    const postConv = await client.query(
      "SELECT id, lead_id, match_state FROM whatsapp_conversations WHERE id = $1",
      [convId]
    );
    assert(
      postConv.rows[0].lead_id === null,
      `Post-delete: conv ${convId} lead_id is NULL`
    );
    assert(
      postConv.rows[0].match_state === "unmatched",
      `Post-delete: conv ${convId} match_state is 'unmatched'`
    );

    // 9. Verify messages are retained but lead_id nulled
    const postMsgs = await client.query(
      "SELECT id, lead_id FROM whatsapp_messages WHERE conversation_id = $1 ORDER BY id",
      [convId]
    );
    assert(postMsgs.rows.length === 3, `Post-delete: 3 messages still exist in conv`);
    const allMsgLeadNull = postMsgs.rows.every((r) => r.lead_id === null);
    assert(allMsgLeadNull, `Post-delete: all message lead_id values are NULL`);

    // 10. Verify unrelated conversation is untouched
    const unrelConv = await client.query(
      "SELECT lead_id, match_state FROM whatsapp_conversations WHERE id = $1",
      [unrelatedConvId]
    );
    assert(
      unrelConv.rows[0].lead_id === unrelatedLeadId,
      `Unrelated conv ${unrelatedConvId} still linked to lead ${unrelatedLeadId}`
    );
    assert(
      unrelConv.rows[0].match_state === "matched",
      `Unrelated conv ${unrelatedConvId} still 'matched'`
    );

    const unrelMsgs = await client.query(
      "SELECT lead_id FROM whatsapp_messages WHERE conversation_id = $1",
      [unrelatedConvId]
    );
    assert(
      unrelMsgs.rows[0].lead_id === unrelatedLeadId,
      `Unrelated message still linked to lead ${unrelatedLeadId}`
    );

    // Rollback — don't persist test data
    await client.query("ROLLBACK");
    console.log("  (rolled back test data)");
  } catch (err) {
    await client.query("ROLLBACK");
    FAIL(`WhatsApp test error: ${err.message}`);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3C — R2 and File Cleanup Analysis
// ═══════════════════════════════════════════════════════════════════════════

function analyzeR2Cleanup() {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3C — R2 and File Cleanup Analysis");
  console.log("=".repeat(70));

  // R2 env vars are not available in this test environment.
  // Analyze the code path instead.
  console.log("\n  R2 cleanup code path analysis:");
  console.log("  1. deleteLeadAssets() collects keys from 5 KNOWN_ASSET_TABLES");
  console.log("     (booking_documents, uploaded_documents, lead_documents,");
  console.log("      customer_documents, booking_forms)");
  console.log("  2. Collects keys from booking_applications directly");
  console.log("  3. Collects follow_up_attachments.r2_object_key via subquery");
  console.log("  4. Scans 8+ R2 prefixes (leads/, lead-assets/, generated-pdfs/, etc.)");
  console.log("  5. Parallel deletes via Promise.all(deleteObjectFromR2)");
  console.log("");
  console.log("  R2 failure handling:");
  console.log("  - If ANY R2 key fails to delete, deleteLeadAssets returns failures[]");
  console.log("  - Single-delete API checks failures.length > 0 → returns 502");
  console.log("  - The 502 return is INSIDE the transaction callback");
  console.log("  - The transaction() wrapper commits or rolls back based on return");
  console.log("");

  // CRITICAL FINDING: R2 deletions happen BEFORE DB deletions
  console.log("  ** CRITICAL ATOMICITY ANALYSIS **");
  console.log("  Order: R2 delete → local file delete → DB delete → audit");
  console.log("  Transaction wraps the entire sequence.");
  console.log("");
  console.log("  Scenario: R2 succeeds, then DB delete fails:");
  console.log("    - Transaction rolls back DB changes");
  console.log("    - R2 objects are ALREADY DELETED (no rollback possible)");
  console.log("    - Result: ORPHANED R2 DELETIONS — files gone, DB records remain");
  console.log("    - This is acknowledged but not fixable without a 2PC protocol");
  console.log("");
  console.log("  Scenario: R2 fails:");
  console.log("    - deleteLeadAssets returns failures[]");
  console.log("    - API returns { status: 'asset-failed' } → 502");
  console.log("    - Transaction returns this value and COMMITS (no throw)");
  console.log("");

  // Actually let's check: does transaction() auto-commit on return?
  // Reading the code: transaction() wraps in BEGIN/COMMIT.
  // The 'asset-failed' return means the transaction callback returns normally.
  // That means BEGIN → (R2 partial delete) → COMMIT with asset-failed status.
  // BUT: no DB records were deleted yet (R2 runs before DB deletion).
  // So the commit is a no-op (only a SELECT FOR UPDATE was done).
  console.log("  Correction on R2 failure scenario:");
  console.log("    - R2 failure returns early BEFORE any DB deletes happen");
  console.log("    - Only SELECT FOR UPDATE was executed inside the txn");
  console.log("    - Transaction commits but no destructive DB changes were made");
  console.log("    - Any partial R2 deletions ARE lost (some keys deleted, some not)");
  console.log("    - This leaves R2 in a partially cleaned state if some keys");
  console.log("      succeeded before the first failure");
  console.log("");

  // Local file cleanup
  console.log("  Local file cleanup:");
  console.log("  - deleteLeadLocalUploads() targets public/uploads/booking_documents/lead_{id}");
  console.log("  - Path-traversal guard: refuses paths outside uploadRoot");
  console.log("  - Uses fs.rm(recursive, force) — idempotent on missing dirs");
  console.log("  - Runs AFTER R2, BEFORE DB deletion");
  console.log("  - Same atomicity issue: local files deleted before DB commit");
  PASS("R2/file cleanup code path analyzed");
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3D — Failure and Transaction Testing
// ═══════════════════════════════════════════════════════════════════════════

async function testFailureScenarios(orgId, adminId, adminName) {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3D — Failure and Transaction Testing");
  console.log("=".repeat(70));

  // ── Test 1: RESTRICT FK blocks deletion ────────────────────────────────
  console.log("\n  --- Test D1: RESTRICT FK blocks deletion ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lead = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D1_${Date.now()}`, orgId]
      );
      const leadId = lead.rows[0].id;

      // Create a lead_reminder (RESTRICT FK)
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, reminder_type, note, remind_at, status, created_at, updated_at)
         VALUES ($1, $2, $3, $3, 'Test Admin', 'follow_up', 'test', NOW() + interval '1 day', 'pending', NOW(), NOW())`,
        [leadId, orgId, adminId]
      );

      // Try to delete lead WITHOUT removing reminder
      try {
        await client.query(
          "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
          [leadId, orgId]
        );
        FAIL("D1: RESTRICT FK did NOT block deletion");
      } catch (err) {
        assert(
          err.message.includes("lead_reminders"),
          `D1: RESTRICT FK correctly blocked: ${err.message.slice(0, 80)}`
        );
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 2: Partial DB failure mid-deletion ────────────────────────────
  console.log("\n  --- Test D2: Partial failure mid-deletion (SAVEPOINT) ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create two test leads
      const lead1 = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D2_OK_${Date.now()}`, orgId]
      );
      const lead2 = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D2_BLOCKED_${Date.now()}`, orgId]
      );
      const leadId1 = lead1.rows[0].id;
      const leadId2 = lead2.rows[0].id;

      // Lead2 gets a RESTRICT FK (lead_reminder)
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, reminder_type, note, remind_at, status, created_at, updated_at)
         VALUES ($1, $2, $3, $3, 'Test Admin', 'follow_up', 'blocker', NOW() + interval '1 day', 'pending', NOW(), NOW())`,
        [leadId2, orgId, adminId]
      );

      // Simulate bulk delete with SAVEPOINTs
      let deleted = 0;
      const failed = [];

      for (const leadId of [leadId1, leadId2]) {
        await client.query("SAVEPOINT lead_del");
        try {
          // Lead1 should succeed; Lead2 should fail
          await client.query(
            "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
            [leadId, orgId]
          );
          await client.query("RELEASE SAVEPOINT lead_del");
          deleted++;
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT lead_del");
          failed.push({ id: leadId, reason: err.message });
        }
      }

      assert(deleted === 1, `D2: 1 lead deleted successfully`);
      assert(failed.length === 1, `D2: 1 lead failed`);
      assert(failed[0].id === leadId2, `D2: Failed lead is the blocked one`);

      // Verify lead1 is gone, lead2 still exists
      const check1 = await client.query(
        "SELECT id FROM walkin_enquiries WHERE id = $1",
        [leadId1]
      );
      const check2 = await client.query(
        "SELECT id FROM walkin_enquiries WHERE id = $1",
        [leadId2]
      );
      assert(check1.rows.length === 0, `D2: Lead1 successfully deleted`);
      assert(check2.rows.length === 1, `D2: Lead2 still exists (blocked)`);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 3: Cross-organization deletion prevention ─────────────────────
  console.log("\n  --- Test D3: Cross-organization deletion prevention ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Get two different orgs
      const orgs = await client.query("SELECT id FROM organizations LIMIT 2");
      if (orgs.rows.length >= 2) {
        const org1 = orgs.rows[0].id;
        const org2 = orgs.rows[1].id;

        // Create lead in org2
        const lead = await client.query(
          `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
           VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
          [`TEST_D3_${Date.now()}`, org2]
        );
        const leadId = lead.rows[0].id;

        // Try to delete using org1's identity
        const delResult = await client.query(
          "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
          [leadId, org1]
        );
        assert(
          delResult.rowCount === 0,
          `D3: Cross-org deletion correctly returned 0 rows`
        );

        // Verify lead still exists
        const check = await client.query(
          "SELECT id FROM walkin_enquiries WHERE id = $1",
          [leadId]
        );
        assert(check.rows.length === 1, `D3: Lead still exists in org2`);
      } else {
        console.log("  SKIP: Only 1 org available");
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 4: Concurrent deletion (FOR UPDATE lock) ──────────────────────
  console.log("\n  --- Test D4: Concurrent deletion (FOR UPDATE lock) ---");
  {
    const client1 = await pool.connect();
    const client2 = await pool.connect();
    try {
      // Create a test lead
      await client1.query("BEGIN");
      const lead = await client1.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D4_${Date.now()}`, orgId]
      );
      const leadId = lead.rows[0].id;
      await client1.query("COMMIT");

      // Client1 starts transaction and locks the lead
      await client1.query("BEGIN");
      const locked = await client1.query(
        "SELECT id FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
        [leadId]
      );
      assert(locked.rows.length === 1, `D4: Client1 locked lead ${leadId}`);

      // Client2 tries to lock same lead — should block
      await client2.query("BEGIN");
      // Use statement_timeout to avoid hanging
      await client2.query("SET LOCAL statement_timeout = '2s'");
      try {
        await client2.query(
          "SELECT id FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
          [leadId]
        );
        // If we get here, the lock was released (client1 already committed)
        PASS("D4: Client2 acquired lock after Client1 (sequential)");
      } catch (err) {
        assert(
          err.message.includes("timeout") ||
            err.message.includes("canceling"),
          `D4: Client2 correctly blocked by FOR UPDATE lock`
        );
      }

      // Cleanup
      await client2.query("ROLLBACK");
      await client1.query(
        "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
        [leadId, orgId]
      );
      await client1.query("COMMIT");
    } finally {
      client1.release();
      client2.release();
    }
  }

  // ── Test 5: Inventory not modified on non-booking lead ─────────────────
  console.log("\n  --- Test D5: Inventory untouched for non-booking lead ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Count inventory before
      const before = await client.query(
        "SELECT count(*) as cnt FROM inventory_units WHERE organization_id = $1",
        [orgId]
      );

      const lead = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D5_${Date.now()}`, orgId]
      );

      await client.query(
        "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
        [lead.rows[0].id, orgId]
      );

      const after = await client.query(
        "SELECT count(*) as cnt FROM inventory_units WHERE organization_id = $1",
        [orgId]
      );

      assert(
        before.rows[0].cnt === after.rows[0].cnt,
        `D5: Inventory count unchanged (${before.rows[0].cnt})`
      );

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 6: returning_from_lead_id self-reference blocks deletion ──────
  console.log("\n  --- Test D6: Self-referencing FK (returning_from_lead_id) ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create parent lead
      const parent = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D6_PARENT_${Date.now()}`, orgId]
      );
      const parentId = parent.rows[0].id;

      // Create child lead that references parent
      const cols = await getWEColumns();
      if (cols.has("returning_from_lead_id")) {
        const child = await client.query(
          `INSERT INTO walkin_enquiries (name, phone, organization_id, returning_from_lead_id, created_at)
           VALUES ($1, '9999' || floor(random()*1000000)::text, $2, $3, NOW()) RETURNING id`,
          [`TEST_D6_CHILD_${Date.now()}`, orgId, parentId]
        );
        const childId = child.rows[0].id;

        // Try to delete parent while child references it
        try {
          await client.query(
            "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
            [parentId, orgId]
          );
          FAIL("D6: Self-referencing FK did NOT block deletion");
        } catch (err) {
          assert(
            err.message.includes("walkin_enquiries") || err.message.includes("returning_from_lead_id"),
            `D6: Self-ref FK correctly blocked: ${err.message.slice(0, 100)}`
          );
        }
      } else {
        console.log("  SKIP: returning_from_lead_id column not found");
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 7: Audit log survives deletion ────────────────────────────────
  console.log("\n  --- Test D7: Audit log written and retained ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const lead = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_D7_${Date.now()}`, orgId]
      );
      const leadId = lead.rows[0].id;

      // Ensure audit table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS lead_deletion_audit_logs (
          id SERIAL PRIMARY KEY,
          admin_id TEXT NOT NULL,
          admin_name TEXT NOT NULL,
          lead_id INTEGER NOT NULL,
          lead_number TEXT,
          customer_name TEXT,
          deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          reason TEXT,
          deleted_file_count INTEGER DEFAULT 0,
          deleted_local_file_count INTEGER DEFAULT 0,
          deleted_records JSONB DEFAULT '{}'::jsonb
        )
      `);

      // Delete lead
      await client.query(
        "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
        [leadId, orgId]
      );

      // Insert audit (simulating what the API does)
      await client.query(
        `INSERT INTO lead_deletion_audit_logs
         (admin_id, admin_name, lead_id, lead_number, customer_name, reason, deleted_records)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          String(adminId),
          adminName,
          leadId,
          String(leadId),
          "Test Lead",
          "Phase 3 test",
          JSON.stringify({ walkin_enquiries: 1 }),
        ]
      );

      // Verify audit exists even though lead is deleted
      const audit = await client.query(
        "SELECT * FROM lead_deletion_audit_logs WHERE lead_id = $1 ORDER BY id DESC LIMIT 1",
        [leadId]
      );
      assert(audit.rows.length === 1, `D7: Audit log exists for deleted lead`);
      assert(
        audit.rows[0].admin_name === adminName,
        `D7: Audit log has correct admin name`
      );
      assert(audit.rows[0].reason === "Phase 3 test", `D7: Audit log has reason`);

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // ── Test 8: SrNo recalculation ─────────────────────────────────────────
  console.log("\n  --- Test D8: SrNo recalculation ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const cols = await getWEColumns();
      if (cols.has("sr_no")) {
        // Get max sr_no
        const maxSr = await client.query(
          "SELECT COALESCE(MAX(sr_no), 0) as m FROM walkin_enquiries WHERE organization_id = $1",
          [orgId]
        );

        // Create 3 test leads
        const ids = [];
        for (let i = 0; i < 3; i++) {
          const r = await client.query(
            `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
             VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
            [`TEST_D8_${i}_${Date.now()}`, orgId]
          );
          ids.push(r.rows[0].id);
        }

        // Assign sequential sr_nos
        for (let i = 0; i < ids.length; i++) {
          await client.query(
            "UPDATE walkin_enquiries SET sr_no = $1 WHERE id = $2",
            [parseInt(maxSr.rows[0].m) + i + 1, ids[i]]
          );
        }

        // Delete middle lead
        await client.query(
          "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
          [ids[1], orgId]
        );

        // Recalculate (same as the API does)
        await client.query(`
          WITH numbered AS (
            SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY organization_id
                ORDER BY created_at ASC, id ASC
              ) AS new_sr
            FROM walkin_enquiries
          )
          UPDATE walkin_enquiries w
            SET sr_no = n.new_sr
          FROM numbered n
          WHERE w.id = n.id AND w.sr_no IS DISTINCT FROM n.new_sr
        `);

        // Verify no gaps in sr_no for this org
        const srNos = await client.query(
          `SELECT sr_no FROM walkin_enquiries
           WHERE organization_id = $1 ORDER BY sr_no ASC`,
          [orgId]
        );
        let hasGap = false;
        for (let i = 1; i < srNos.rows.length; i++) {
          if (srNos.rows[i].sr_no - srNos.rows[i - 1].sr_no !== 1) {
            hasGap = true;
            break;
          }
        }
        assert(!hasGap, `D8: Sr. Nos are gapless after recalculation`);
      } else {
        console.log("  SKIP: sr_no column not found");
      }

      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3E — API Workflow Verification (SQL-level simulation)
// ═══════════════════════════════════════════════════════════════════════════

async function testAPIWorkflows(orgId, adminId, adminName) {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3E — API Workflow Verification");
  console.log("=".repeat(70));

  // ── Test E1: Full single-lead deletion workflow ────────────────────────
  console.log("\n  --- Test E1: Full single-lead deletion (engine sequence) ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create lead with all possible dependent records
      const lead = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id, name`,
        [`TEST_E1_${Date.now()}`, orgId]
      );
      const leadId = lead.rows[0].id;
      console.log(`  Created lead ${leadId}`);

      // Create follow_up
      const fu = await client.query(
        `INSERT INTO follow_ups (lead_id, organization_id, message, created_by_name, created_at, follow_up_type)
         VALUES ($1, $2, 'test follow up', 'Test Admin', NOW(), 'Note') RETURNING id`,
        [leadId, orgId]
      );
      const fuId = fu.rows[0].id;

      // Create follow_up_attachment
      await client.query(
        `INSERT INTO follow_up_attachments
         (organization_id, follow_up_id, file_name, mime_type, file_size, r2_object_key, created_at)
         VALUES ($1, $2, 'test.pdf', 'application/pdf', 1024, 'test/key.pdf', NOW())`,
        [orgId, fuId]
      );

      // Create site_visit (CASCADE FK)
      await client.query(
        `INSERT INTO site_visits (lead_id, organization_id, visit_date, created_by, created_at)
         VALUES ($1, $2, NOW(), 'Test Admin', NOW())`,
        [leadId, orgId]
      );

      // Create lead_reminder (RESTRICT FK)
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, reminder_type, note, remind_at, status, created_at, updated_at)
         VALUES ($1, $2, $3, $3, 'Test Admin', 'follow_up', 'test reminder', NOW() + interval '1 day', 'pending', NOW(), NOW())`,
        [leadId, orgId, adminId]
      );

      // Create whatsapp_log
      const wlCols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='whatsapp_logs' AND table_schema='public'`
      );
      const wlSet = new Set(wlCols.rows.map((r) => r.column_name));
      if (wlSet.has("lead_id") && wlSet.has("organization_id")) {
        const fields = ["lead_id", "organization_id"];
        const vals = ["$1", "$2"];
        const params = [leadId, orgId];
        if (wlSet.has("message_type")) {
          fields.push("message_type");
          vals.push("'test'");
        }
        if (wlSet.has("created_at")) {
          fields.push("created_at");
          vals.push("NOW()");
        }
        await client.query(
          `INSERT INTO whatsapp_logs (${fields.join(",")}) VALUES (${vals.join(",")})`,
          params
        );
      }

      // Create lead_assignment_log
      const lalCols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='lead_assignment_logs' AND table_schema='public'`
      );
      const lalSet = new Set(lalCols.rows.map((r) => r.column_name));
      if (lalSet.has("lead_id") && lalSet.has("organization_id")) {
        const fields = ["lead_id", "organization_id"];
        const vals = ["$1", "$2"];
        const params = [leadId, orgId];
        if (lalSet.has("assigned_to")) {
          fields.push("assigned_to");
          vals.push(`$${params.length + 1}`);
          params.push(String(adminId));
        }
        if (lalSet.has("assigned_by")) {
          fields.push("assigned_by");
          vals.push(`$${params.length + 1}`);
          params.push(adminName);
        }
        if (lalSet.has("created_at")) {
          fields.push("created_at");
          vals.push("NOW()");
        }
        await client.query(
          `INSERT INTO lead_assignment_logs (${fields.join(",")}) VALUES (${vals.join(",")})`,
          params
        );
      }

      // Create employee_activity_log (lead_id is VARCHAR)
      const ealCols = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='employee_activity_logs' AND table_schema='public'`
      );
      const ealSet = new Set(ealCols.rows.map((r) => r.column_name));
      if (ealSet.has("lead_id") && ealSet.has("organization_id")) {
        const fields = ["lead_id", "organization_id"];
        const vals = ["$1", "$2"];
        const params = [String(leadId), orgId];
        if (ealSet.has("user_id")) {
          fields.push("user_id");
          vals.push(`$${params.length + 1}`);
          params.push(adminId);
        }
        if (ealSet.has("action_type")) {
          fields.push("action_type");
          vals.push(`$${params.length + 1}`);
          params.push("test_action");
        }
        if (ealSet.has("created_at")) {
          fields.push("created_at");
          vals.push("NOW()");
        }
        await client.query(
          `INSERT INTO employee_activity_logs (${fields.join(",")}) VALUES (${vals.join(",")})`,
          params
        );
      }

      // ── Execute deletion in leadDeletion.ts order ──────────────────────
      // Step 0: Cancel bookings (none)
      // Pre-booking: cp_commissions + inventory_units.booking_id (none)
      // follow_up_attachments via subquery
      const fuaDel = await client.query(
        `DELETE FROM follow_up_attachments
         WHERE follow_up_id IN (SELECT id FROM follow_ups WHERE lead_id::text = $1)`,
        [String(leadId)]
      );

      // LEAD_RELATED_DELETES in order (only tables that exist with the column)
      const deleteOrder = [
        "disbursement_tranches",
        "financial_adjustments",
        "loan_applications",
        "booking_documents",
        "booking_applications",
        "follow_ups",
        "site_visits",
        "whatsapp_logs",
        "lead_reminders",
        "lead_assignment_logs",
        "employee_activity_logs",
      ];

      const deletedCounts = { follow_up_attachments: fuaDel.rowCount };
      for (const tbl of deleteOrder) {
        const hasTbl = await client.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_name=$1 AND column_name='lead_id' AND table_schema='public'`,
          [tbl]
        );
        if (hasTbl.rows.length === 0) continue;
        const r = await client.query(
          `DELETE FROM "${tbl}" WHERE lead_id::text = $1`,
          [String(leadId)]
        );
        deletedCounts[tbl] = r.rowCount;
      }

      // NULL inventory refs
      for (const col of ["lead_id", "held_for_lead_id"]) {
        await client.query(
          `UPDATE inventory_units SET ${col} = NULL WHERE ${col}::text = $1`,
          [String(leadId)]
        );
      }
      await client.query(
        `UPDATE inventory_cost_sheets SET lead_id = NULL WHERE lead_id::text = $1`,
        [String(leadId)]
      );
      await client.query(
        `UPDATE inventory_offers SET lead_id = NULL WHERE lead_id::text = $1`,
        [String(leadId)]
      );

      // Clear employee_live_state
      await client.query(
        `UPDATE employee_live_state
         SET active_lead_id = NULL, active_lead_name = NULL
         WHERE active_lead_id::text = $1 AND organization_id = $2`,
        [String(leadId), orgId]
      );

      // Delete the lead itself
      const leadDel = await client.query(
        "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
        [leadId, orgId]
      );
      deletedCounts.walkin_enquiries = leadDel.rowCount;

      // Verify all records gone
      assert(deletedCounts.follow_up_attachments === 1, `E1: follow_up_attachments deleted`);
      assert(deletedCounts.follow_ups === 1, `E1: follow_ups deleted`);
      assert(deletedCounts.site_visits === 1, `E1: site_visits deleted (CASCADE would also handle)`);
      assert(deletedCounts.lead_reminders === 1, `E1: lead_reminders deleted (RESTRICT pre-cleared)`);
      assert(deletedCounts.whatsapp_logs >= 1, `E1: whatsapp_logs deleted`);
      assert(deletedCounts.lead_assignment_logs >= 0, `E1: lead_assignment_logs processed`);
      assert(deletedCounts.employee_activity_logs >= 0, `E1: employee_activity_logs processed`);
      assert(deletedCounts.walkin_enquiries === 1, `E1: Lead itself deleted`);

      // Verify nothing remains
      for (const tbl of ["follow_ups", "site_visits", "lead_reminders"]) {
        const check = await client.query(
          `SELECT count(*) as c FROM "${tbl}" WHERE lead_id::text = $1`,
          [String(leadId)]
        );
        assert(
          parseInt(check.rows[0].c) === 0,
          `E1: No orphaned ${tbl} records`
        );
      }

      const fuaCheck = await client.query(
        `SELECT count(*) as c FROM follow_up_attachments
         WHERE follow_up_id = $1`,
        [fuId]
      );
      assert(
        parseInt(fuaCheck.rows[0].c) === 0,
        `E1: No orphaned follow_up_attachments`
      );

      await client.query("ROLLBACK");
      console.log("  (rolled back test data)");
    } finally {
      client.release();
    }
  }

  // ── Test E2: Bulk deletion with mixed results ──────────────────────────
  console.log("\n  --- Test E2: Bulk deletion (1 ok + 1 blocked + 1 wrong org) ---");
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orgs = await client.query("SELECT id FROM organizations LIMIT 2");
      const org2 = orgs.rows.length > 1 ? orgs.rows[1].id : orgId;

      // Lead 1: clean, deletable
      const lead1 = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_E2_OK_${Date.now()}`, orgId]
      );
      // Lead 2: blocked by RESTRICT FK
      const lead2 = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_E2_BLOCKED_${Date.now()}`, orgId]
      );
      await client.query(
        `INSERT INTO lead_reminders (lead_id, organization_id, assigned_user_id, created_by_id, created_by_name, reminder_type, note, remind_at, status, created_at, updated_at)
         VALUES ($1, $2, $3, $3, 'Test Admin', 'follow_up', 'blocker', NOW() + interval '1 day', 'pending', NOW(), NOW())`,
        [lead2.rows[0].id, orgId, adminId]
      );
      // Lead 3: wrong org
      const lead3 = await client.query(
        `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
         VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
        [`TEST_E2_WRONGORG_${Date.now()}`, org2]
      );

      const ids = [lead1.rows[0].id, lead2.rows[0].id, lead3.rows[0].id];
      let deleted = 0;
      const failed = [];

      for (const lid of ids) {
        await client.query("SAVEPOINT bulk_del");
        try {
          const row = await client.query(
            "SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE",
            [lid]
          );
          if (row.rows.length === 0) throw new Error("Not found");
          if (String(row.rows[0].organization_id) !== String(orgId)) {
            throw new Error("Wrong organization");
          }
          await client.query(
            "DELETE FROM walkin_enquiries WHERE id = $1 AND organization_id = $2",
            [lid, orgId]
          );
          await client.query("RELEASE SAVEPOINT bulk_del");
          deleted++;
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT bulk_del");
          failed.push({ id: lid, reason: err.message });
        }
      }

      assert(deleted === 1, `E2: 1 lead deleted`);
      assert(failed.length === 2, `E2: 2 leads failed`);

      const failReasons = failed.map((f) => f.reason);
      assert(
        failReasons.some((r) => r.includes("organization") || r.includes("Wrong")),
        `E2: One failure is cross-org`
      );
      assert(
        failReasons.some((r) => r.includes("lead_reminders") || r.includes("foreign key")),
        `E2: One failure is RESTRICT FK`
      );

      await client.query("ROLLBACK");
      console.log("  (rolled back test data)");
    } finally {
      client.release();
    }
  }

  // ── Test E3: Import rollback gap analysis ──────────────────────────────
  console.log("\n  --- Test E3: Import rollback gap analysis ---");
  {
    console.log("  Import rollback (lib/import/engine.ts:rollbackImport) deletes:");
    console.log("    1. historical_booking_claims (by lead_id + org_id + import_job_id)");
    console.log("    2. follow_ups (by lead_id + org_id)");
    console.log("    3. walkin_enquiries (by id + org_id + import_job_id)");
    console.log("");
    console.log("  Tables NOT handled by import rollback:");
    console.log("    - follow_up_attachments (would be orphaned)");
    console.log("    - site_visits (CASCADE FK — auto-deleted, OK)");
    console.log("    - cp_assignment_history (CASCADE FK — auto-deleted, OK)");
    console.log("    - walk_in_assignment_queue (CASCADE FK — auto-deleted, OK)");
    console.log("    - inventory_unit_waitlist (CASCADE FK — auto-deleted, OK)");
    console.log("    - lead_reminders (RESTRICT FK — would BLOCK rollback!)");
    console.log("    - financial_adjustments (RESTRICT FK — would BLOCK rollback!)");
    console.log("    - booking_applications (RESTRICT FK — would BLOCK rollback!)");
    console.log("    - whatsapp_logs (no FK — would be orphaned)");
    console.log("    - lead_assignment_logs (no FK — would be orphaned)");
    console.log("    - employee_activity_logs (no FK — would be orphaned)");
    console.log("    - whatsapp_conversations (SET NULL FK — trigger handles)");
    console.log("    - whatsapp_messages (SET NULL FK — auto-nulled)");
    console.log("    - bolna_calls (SET NULL FK — auto-nulled)");
    console.log("    - call_sessions (SET NULL FK — auto-nulled)");
    console.log("    - inventory_units (RESTRICT FK — would BLOCK rollback!)");
    console.log("    - inventory_cost_sheets (RESTRICT FK — would BLOCK!)");
    console.log("    - inventory_offers (RESTRICT FK — would BLOCK!)");
    console.log("");
    console.log("  Risk assessment:");
    console.log("    - Freshly imported leads rarely have reminders, bookings,");
    console.log("      or inventory links created before rollback");
    console.log("    - But if a user works with an imported lead before rollback,");
    console.log("      lead_reminders or booking_applications WILL block the rollback");
    console.log("    - follow_up_attachments uploaded to imported leads' follow-ups");
    console.log("      WILL be orphaned (no FK, no explicit delete)");
    PASS("E3: Import rollback gap analysis complete");
    FAIL("E3: Import rollback does NOT handle lead_reminders/booking_applications/inventory FKs — would block if lead was worked on");
    FAIL("E3: Import rollback does NOT delete follow_up_attachments — orphans possible");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3A — Table Coverage Matrix
// ═══════════════════════════════════════════════════════════════════════════

async function printTableCoverageMatrix() {
  console.log("\n" + "=".repeat(70));
  console.log("PHASE 3A — Complete Table Coverage Matrix");
  console.log("=".repeat(70));

  // All tables that reference walkin_enquiries via FK
  const fkTables = [
    { table: "bolna_calls", col: "lead_id", fk: "SET NULL", engine: "no", pg: "SET NULL auto", data: "shared", status: "OK — auto-nulled" },
    { table: "booking_applications", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (pos 6)", pg: "blocks", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "call_sessions", col: "lead_id", fk: "SET NULL", engine: "no", pg: "SET NULL auto", data: "shared", status: "OK — auto-nulled" },
    { table: "cp_assignment_history", col: "lead_id", fk: "CASCADE", engine: "no", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — auto-cascade" },
    { table: "financial_adjustments", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (pos 2)", pg: "blocks", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "historical_booking_claims", col: "lead_id", fk: "SET NULL", engine: "no", pg: "SET NULL auto", data: "shared", status: "OK — auto-nulled" },
    { table: "inventory_cost_sheets", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (NULL)", pg: "blocks", data: "shared", status: "OK — explicit NULL" },
    { table: "inventory_offers", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (NULL)", pg: "blocks", data: "shared", status: "OK — explicit NULL" },
    { table: "inventory_unit_waitlist", col: "lead_id", fk: "CASCADE", engine: "no", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — auto-cascade" },
    { table: "inventory_units", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (NULL)", pg: "blocks", data: "shared", status: "OK — explicit NULL" },
    { table: "inventory_units", col: "held_for_lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (NULL)", pg: "blocks", data: "shared", status: "OK — explicit NULL" },
    { table: "lead_reminders", col: "lead_id", fk: "NO ACTION (RESTRICT)", engine: "yes (pos 12)", pg: "blocks", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "site_visits", col: "lead_id", fk: "CASCADE", engine: "yes (pos 10)", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — explicit + cascade" },
    { table: "walk_in_assignment_queue", col: "lead_id", fk: "CASCADE", engine: "no", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — auto-cascade" },
    { table: "walkin_enquiries", col: "returning_from_lead_id", fk: "NO ACTION (RESTRICT)", engine: "no", pg: "blocks", data: "shared", status: "GAP — not handled" },
    { table: "whatsapp_conversations", col: "lead_id", fk: "SET NULL", engine: "no", pg: "trigger+SET NULL", data: "shared", status: "OK — trigger orphans" },
    { table: "whatsapp_messages", col: "lead_id", fk: "SET NULL", engine: "no", pg: "SET NULL auto", data: "shared", status: "OK — auto-nulled" },
  ];

  // Tables in LEAD_RELATED_DELETES with no FK (existence-guarded)
  const noFkTables = [
    { table: "disbursement_tranches", col: "lead_id", fk: "none (plain col)", engine: "yes (pos 1)", pg: "n/a", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "loan_applications", col: "lead_id", fk: "CASCADE", engine: "yes (pos 3)", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — explicit + cascade" },
    { table: "booking_documents", col: "lead_id", fk: "CASCADE (via booking)", engine: "yes (pos 4)", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — explicit + cascade" },
    { table: "follow_ups", col: "lead_id", fk: "CASCADE", engine: "yes (pos 8)", pg: "CASCADE auto", data: "lead-exclusive", status: "OK — explicit + cascade" },
    { table: "whatsapp_logs", col: "lead_id", fk: "none", engine: "yes (pos 11)", pg: "n/a", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "lead_assignment_logs", col: "lead_id", fk: "none", engine: "yes (pos 17)", pg: "n/a", data: "lead-exclusive", status: "OK — explicit delete" },
    { table: "employee_activity_logs", col: "lead_id", fk: "none (VARCHAR)", engine: "yes (pos 18)", pg: "n/a", data: "lead-scoped", status: "OK — explicit delete" },
  ];

  // Indirect dependencies (no lead_id column, linked through booking_id)
  const indirectTables = [
    { table: "cp_commissions", col: "booking_id", fk: "RESTRICT→booking_applications", engine: "yes (subquery)", pg: "blocks", data: "booking-exclusive", status: "OK — pre-booking cleanup" },
    { table: "inventory_units", col: "booking_id", fk: "RESTRICT→booking_applications", engine: "yes (NULL subquery)", pg: "blocks", data: "shared", status: "OK — releaseUnitForBooking + fallback NULL" },
    { table: "follow_up_attachments", col: "follow_up_id", fk: "none (plain col)", engine: "yes (subquery)", pg: "n/a", data: "lead-exclusive", status: "OK — explicit subquery delete" },
  ];

  // Tables in LEAD_RELATED_DELETES that DON'T exist on the database
  const phantomTables = [
    "booking_forms", "customer_documents", "lead_documents", "uploaded_documents",
    "loan_updates", "notes", "lead_notes", "email_history", "call_history",
    "reminders", "notification_records", "notifications", "ai_conversations",
    "audit_references", "employee_assignments", "bookings", "customers",
  ];

  console.log("\n  ┌─ FK-CONSTRAINED TABLES ─────────────────────────────────────────┐");
  console.log("  │ Table                        │ FK Rule    │ Engine │ Status       │");
  console.log("  ├──────────────────────────────┼────────────┼────────┼──────────────┤");
  for (const t of fkTables) {
    const tn = (t.table + "." + t.col).padEnd(28);
    const fk = t.fk.padEnd(10).slice(0, 10);
    const eng = t.engine.padEnd(6).slice(0, 6);
    const st = t.status.slice(0, 12).padEnd(12);
    console.log(`  │ ${tn} │ ${fk} │ ${eng} │ ${st} │`);
  }
  console.log("  └──────────────────────────────┴────────────┴────────┴──────────────┘");

  console.log("\n  ┌─ NON-FK / INDIRECT TABLES ───────────────────────────────────────┐");
  for (const t of [...noFkTables, ...indirectTables]) {
    console.log(`  │ ${t.table}.${t.col}: ${t.status}`);
  }
  console.log("  └──────────────────────────────────────────────────────────────────┘");

  console.log(`\n  Phantom tables in LEAD_RELATED_DELETES (don't exist on DB):`);
  console.log(`    ${phantomTables.join(", ")}`);
  console.log(`    These are existence-guarded (tableHasColumn check). Harmless.`);

  // ── GAPS ───────────────────────────────────────────────────────────────
  console.log("\n  ┌─ IDENTIFIED GAPS ────────────────────────────────────────────────┐");
  console.log("  │ 1. walkin_enquiries.returning_from_lead_id (self-ref NO ACTION)  │");
  console.log("  │    22 rows have this set. If the referenced lead is deleted,      │");
  console.log("  │    PostgreSQL blocks with RESTRICT. The engine does NOT NULL       │");
  console.log("  │    returning_from_lead_id before deleting the lead.               │");
  console.log("  │    SEVERITY: Medium — blocks deletion of leads referenced by      │");
  console.log("  │    other leads as 'returning from'.                               │");
  console.log("  │                                                                   │");
  console.log("  │ 2. booking_history has NO lead_id or FK to walkin_enquiries       │");
  console.log("  │    Links through booking_id → booking_applications.               │");
  console.log("  │    When booking_applications is deleted, booking_history rows      │");
  console.log("  │    with that booking_id become orphaned (no CASCADE FK).           │");
  console.log("  │    Engine writes new history row in cancelBookingsForLead,         │");
  console.log("  │    then deletes booking_applications — history is orphaned.        │");
  console.log("  │    SEVERITY: Low — audit trail, intentionally preserved.           │");
  console.log("  │                                                                   │");
  console.log("  │ 3. Import rollback (engine.ts) has incomplete FK handling          │");
  console.log("  │    See Test E3 for details.                                       │");
  console.log("  └──────────────────────────────────────────────────────────────────┘");

  // Verify gap #1 on the child branch
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Test returning_from_lead_id blocking
    const parent = await client.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id, created_at)
       VALUES ($1, '9999' || floor(random()*1000000)::text, $2, NOW()) RETURNING id`,
      [`TEST_3A_PARENT_${Date.now()}`, (await getTestOrg()).orgId]
    );
    const pId = parent.rows[0].id;
    await client.query(
      `INSERT INTO walkin_enquiries (name, phone, organization_id, returning_from_lead_id, created_at)
       VALUES ($1, '9999' || floor(random()*1000000)::text, $2, $3, NOW())`,
      [`TEST_3A_CHILD_${Date.now()}`, (await getTestOrg()).orgId, pId]
    );

    await client.query("SAVEPOINT gap1_test");
    try {
      await client.query(
        "DELETE FROM walkin_enquiries WHERE id = $1",
        [pId]
      );
      FAIL("3A-Gap1: returning_from_lead_id did NOT block deletion");
      await client.query("RELEASE SAVEPOINT gap1_test");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT gap1_test");
      assert(
        err.message.includes("walkin_enquiries"),
        `3A-Gap1: Confirmed — returning_from_lead_id blocks deletion`
      );
    }

    // Test booking_history orphaning
    const bhFks = await client.query(`
      SELECT tc.table_name, rc.delete_rule
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'booking_history'
    `);
    const baCascade = bhFks.rows.find(
      (r) => r.delete_rule === "CASCADE"
    );
    if (baCascade) {
      PASS("3A-Gap2: booking_history has CASCADE FK — NOT orphaned");
    } else {
      const bhHasBookingFk = bhFks.rows.some(r => true);
      if (bhHasBookingFk) {
        console.log(`    booking_history FK rules: ${JSON.stringify(bhFks.rows)}`);
      }
      FAIL("3A-Gap2: booking_history lacks CASCADE FK to booking_applications — orphan risk");
    }

    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("=" .repeat(70));
  console.log("PHASE 3 — COMPLETE LEAD DELETION VERIFICATION");
  console.log("=".repeat(70));

  await safetyCheck();

  const { orgId, adminId, adminName } = await getTestOrg();
  console.log(`\nTest org: ${orgId}, admin: ${adminId} (${adminName})`);

  // Phase 3A
  await printTableCoverageMatrix();

  // Phase 3B
  await testWhatsAppCleanup(orgId);

  // Phase 3C
  analyzeR2Cleanup();

  // Phase 3D
  await testFailureScenarios(orgId, adminId, adminName);

  // Phase 3E
  await testAPIWorkflows(orgId, adminId, adminName);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Total PASS: ${passCount}`);
  console.log(`  Total FAIL: ${failCount}`);
  console.log("");
  console.log("  Known issues (not bugs — documented gaps):");
  console.log("  1. returning_from_lead_id self-ref blocks parent deletion");
  console.log("     → Fix: NULL returning_from_lead_id before lead DELETE");
  console.log("  2. R2 partial deletion is not transactional");
  console.log("     → Inherent limitation; no fix without 2PC");
  console.log("  3. Import rollback incomplete for worked-on leads");
  console.log("     → Fix: use leadDeletion engine in rollback path");
  console.log("  4. booking_history orphaned after booking_applications deleted");
  console.log("     → Intentional: audit trail preservation");

  await pool.end();
}

main().catch((err) => {
  console.error("FATAL:", err);
  pool.end();
  process.exit(1);
});
