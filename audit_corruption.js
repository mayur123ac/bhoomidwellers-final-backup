const { loadEnvConfig } = require("@next/env");
loadEnvConfig("./");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DRY_RUN = !process.argv.includes("--fix");

async function main() {
  const auditRes = await pool.query(
    "SELECT w.id, w.sr_no, w.name, w.assigned_to, w.assigned_to_user_id, u_to.role AS assignee_role, w.assigned_receptionist, w.assigned_receptionist_user_id, u_recep.name AS recep_user_name, w.organization_id FROM walkin_enquiries w LEFT JOIN users u_to ON u_to.id = w.assigned_to_user_id LEFT JOIN users u_recep ON u_recep.id = w.assigned_receptionist_user_id WHERE w.assigned_receptionist IS NULL AND w.assigned_receptionist_user_id IS NOT NULL ORDER BY w.id DESC LIMIT 200"
  );
  console.log("Corrupted records (NULL name, non-NULL user_id):", auditRes.rowCount);
  auditRes.rows.forEach(function(r) {
    console.log("  id=" + r.id + " assigned_to=" + r.assigned_to + " role=" + r.assignee_role + " wrong_recep_uid=" + r.assigned_receptionist_user_id + " recep_name=" + r.recep_user_name + " org=" + r.organization_id);
  });
  if (DRY_RUN) {
    console.log("DRY RUN - pass --fix to apply cleanup");
    await pool.end();
    return;
  }
  if (auditRes.rowCount === 0) {
    console.log("No corrupted records to clean.");
    await pool.end();
    return;
  }
  const fix = await pool.query(
    "UPDATE walkin_enquiries SET assigned_receptionist_user_id = NULL WHERE assigned_receptionist IS NULL AND assigned_receptionist_user_id IS NOT NULL RETURNING id"
  );
  console.log("Records cleaned:", fix.rowCount, "  IDs:", fix.rows.map(function(r) { return r.id; }).join(", "));
  const chk = await pool.query(
    "SELECT COUNT(*)::int AS n FROM walkin_enquiries WHERE assigned_receptionist IS NULL AND assigned_receptionist_user_id IS NOT NULL"
  );
  console.log("Remaining corrupted records after fix:", chk.rows[0].n);
  await pool.end();
}

main().catch(function(e) { console.error("Error:", e.message); process.exit(1); });
