# Read Path Audit

## src\app\api\ai-assistant\hydrate.ts
- Line 35: `* Columns the assistant can reason about. Explicit rather than SELECT *: this`
- Line 95: ``SELECT ${LEAD_COLUMNS} FROM walkin_enquiries WHERE id = ANY($1::int[]) ORDER BY sr_no DESC NULLS LAST`,`
- Line 99: ``SELECT lead_id, message, created_by_name, site_visit_date, created_at`

## src\app\api\attendance\advanced-analytics\route.ts
- Line 33: `const moduleQuery = await query(``
- Line 34: `SELECT module, COUNT(*) as count`
- Line 54: `const heatmapQuery = await query(``
- Line 55: `SELECT DATE(timestamp) as day, COUNT(*) as activity_count`
- Line 80: `const activeTimeQuery = await query(``
- Line 81: `SELECT SUM(session_duration_seconds) as total_duration, SUM(idle_duration_seconds) as total_idle`
- Line 95: `const activeRankQuery = await query(``
- Line 96: `SELECT u.name, SUM(s.session_duration_seconds - s.idle_duration_seconds) as active_time, SUM(s.idle_duration_seconds) as idle_time`

## src\app\api\attendance\analytics\route.ts
- Line 24: `const logs = await query(``
- Line 25: `SELECT action_type, description as action, module, lead_id, lead_name, timestamp as created_at`
- Line 33: `const leadsOpenedRes = await query(``
- Line 34: `SELECT COUNT(DISTINCT lead_id) as count`
- Line 39: `const interactionsRes = await query(``
- Line 40: `SELECT action_type, COUNT(*) as count`

## src\app\api\attendance\force-logout\route.ts
- Line 19: `await query(``

## src\app\api\attendance\heartbeat\route.ts
- Line 28: `const sessionCheck = await query(``
- Line 29: `SELECT is_active`
- Line 40: `await query(`
- Line 45: `SELECT id FROM employee_sessions`
- Line 64: `const liveStateResult = await query(``
- Line 70: `(SELECT organization_id FROM users WHERE id = $1))`

## src\app\api\attendance\live\route.ts
- Line 20: `await query(``
- Line 27: `const liveSessions = await query(``
- Line 28: `SELECT`
- Line 64: `SELECT DISTINCT ON (user_id) *`
- Line 70: `SELECT user_id, COUNT(id) as active_sessions_count`
- Line 77: `SELECT DISTINCT ON (employee_id) employee_id, attendance_status`

## src\app\api\attendance\log-activity\route.ts
- Line 26: `await query(``
- Line 55: `await query(``
- Line 98: `const switchResult = await query(``
- Line 99: `SELECT COUNT(DISTINCT lead_id) as lead_count`

## src\app\api\attendance\mark\route.ts
- Line 30: `const activeSession = await query(``
- Line 31: `SELECT id, session_start`
- Line 46: `const existing = await query(``
- Line 47: `SELECT id, attendance_status, login_time FROM attendance_records`
- Line 67: `const result = await query(``

## src\app\api\attendance\my-sessions\route.ts
- Line 46: `await query(``
- Line 55: `rows = await query(`
- Line 82: `SELECT DISTINCT ON (employee_id) employee_id, attendance_status`
- Line 94: `rows = await query(`
- Line 121: `SELECT DISTINCT ON (employee_id) employee_id, attendance_status`

## src\app\api\attendance\report\route.ts
- Line 147: ``SELECT shift_start, shift_end, flexible FROM organization_settings WHERE organization_id = $1`,`
- Line 156: ``SELECT id, name, COALESCE(NULLIF(TRIM(role),''),'—') AS role, email`
- Line 171: ``SELECT s.user_id,`
- Line 189: ``SELECT DISTINCT ON (employee_id, DATE(login_time))`

## src\app\api\attendance\session-history\route.ts
- Line 23: `SELECT`
- Line 45: `const sessions = await query(queryStr, params);`

## src\app\api\attendance\status\route.ts
- Line 25: `const existing = await query(``
- Line 31: `FROM (SELECT 1) AS _`
- Line 33: `SELECT id, login_time, attendance_status`

## src\app\api\auth\login\route.ts
- Line 39: `const rows = await query(`
- Line 40: ``SELECT u.*`
- Line 158: `const sessionRes = await query(`
- Line 162: `SELECT $1, $2, $3, $4, $5, true, u.organization_id FROM users u WHERE u.id = $1 RETURNING id`,`
- Line 172: `await query(`

## src\app\api\auth\logout\route.ts
- Line 14: `await query(`

## src\app\api\auth\signup\route.ts
- Line 100: `const existing = await query(`
- Line 101: ``SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,`
- Line 120: `await query(`

## src\app\api\bolna\call\route.ts
- Line 61: ``SELECT phone, name FROM walkin_enquiries WHERE id = $1`,`
- Line 71: ``SELECT contact_no, name FROM caller_leads WHERE id = $1`,`
- Line 156: `await query(`

## src\app\api\booking-applications\route.ts
- Line 19: `await query(``
- Line 100: `await query(``
- Line 109: `await query(``
- Line 125: `await query(``
- Line 134: `await query(``
- Line 154: `await query(``
- Line 162: `await query(``
- Line 175: `await query(``
- Line 185: `await query(``
- Line 191: `await query(``
- Line 202: `await query(``
- Line 213: `await query(``
- Line 224: `await query(``
- Line 235: `await query(``
- Line 259: `await query(``
- Line 261: `SELECT`
- Line 290: `// SELECT b.* returns primary_pan, primary_aadhaar and document URLs.`
- Line 300: `// The identical SELECT is used by POST and by the PUT in [id]/route.ts, so a`
- Line 314: `const rows = await query(sql, params);`
- Line 351: ``SELECT id, booking_number, booking_status`
- Line 541: `const insertRes = await client.query(`
- Line 563: `(SELECT channel_partner_id FROM walkin_enquiries WHERE id = $1),`
- Line 588: `await client.query(`UPDATE booking_applications SET booking_number = $1 WHERE id = $2`, [bookingNumber, newId]);`
- Line 609: `await client.query(``
- Line 627: `await client.query(``
- Line 633: `await client.query(``
- Line 639: `await client.query(``
- Line 653: `await client.query(``
- Line 660: `await client.query(``
- Line 666: `const accInsert = await client.query(`INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1, $2) RETURNING id`, [newId, orgId]);`
- Line 671: `await client.query(``
- Line 708: `await client.query(``
- Line 715: `await client.query(``
- Line 725: `const leadDraftRes = await client.query(`SELECT loan_tracking_info FROM walkin_enquiries WHERE id = $1`, [lead_id]);`
- Line 732: `await client.query(`
- Line 767: `await client.query(``
- Line 818: `await client.query(`INSERT INTO booking_documents (booking_id, lead_id, booking_number, document_type, applicant_type, file_name, object_key, mime_typ`
- Line 822: `await client.query(``
- Line 849: `const bookingRow = await client.query(`
- Line 850: ``SELECT sourced_by_channel_partner_id FROM booking_applications WHERE id = $1`,`
- Line 859: `await client.query("SAVEPOINT cp_commission");`
- Line 868: `await client.query("RELEASE SAVEPOINT cp_commission");`
- Line 871: `await client.query("ROLLBACK TO SAVEPOINT cp_commission");`
- Line 889: `const fetchBooking = await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [newId]);`
- Line 894: `await query(`UPDATE booking_applications SET booking_status = 'Confirmed' WHERE id = $1`, [result.id]);`
- Line 895: `await query(`UPDATE walkin_enquiries SET status = 'Closed' WHERE id = $1`, [lead_id]);`

## src\app\api\booking-applications\[id]\history\route.ts
- Line 18: `await query(``
- Line 29: `const rows = await query(`
- Line 30: ``SELECT * FROM booking_history WHERE booking_id = $1 ORDER BY created_at DESC`,`

## src\app\api\booking-applications\[id]\loan-applications\route.ts
- Line 20: `const rows = await query(`
- Line 21: ``SELECT * FROM loan_applications WHERE booking_id = $1 ORDER BY created_at ASC`,`

## src\app\api\booking-applications\[id]\milestones\route.ts
- Line 39: ``SELECT agreement_value FROM booking_applications WHERE id = $1`,`
- Line 52: `const existingRes = await client.query(`
- Line 53: ``SELECT id, milestone_order FROM booking_payment_milestones WHERE booking_id = $1`,`
- Line 76: `const upd = await client.query(`
- Line 90: `const ins = await client.query(`
- Line 104: `await client.query(`

## src\app\api\booking-applications\[id]\payment-summary\route.ts
- Line 56: ``SELECT milestone_name, demand_amount, paid_amount, status`
- Line 62: ``SELECT COALESCE(SUM(tds_amount), 0) AS total FROM booking_tds_records WHERE booking_id = $1`,`
- Line 67: ``SELECT fl.transaction_type, fl.amount, fl.transaction_date`
- Line 82: ``SELECT t.amount, t.receiving_date, t.status, pm.milestone_name`

## src\app\api\booking-applications\[id]\pdd\route.ts
- Line 26: `const rows = await query(`
- Line 27: ``SELECT * FROM loan_pdd_tracking WHERE booking_id = $1 ORDER BY id ASC`,`
- Line 57: `const rows = await query(`
- Line 58: ``SELECT * FROM loan_pdd_tracking WHERE booking_id = $1 ORDER BY id ASC`,`

## src\app\api\booking-applications\[id]\pdd\[pddId]\route.ts
- Line 60: `const rows = await query(`

## src\app\api\booking-applications\[id]\receipt\route.ts
- Line 40: `const rows = await query(`
- Line 41: ``SELECT fl.id, fl.transaction_type, fl.amount, fl.transaction_date,`
- Line 111: ``SELECT id FROM booking_applications WHERE id = $1`,`
- Line 126: `const accountRes = await client.query(`
- Line 127: ``SELECT id FROM financial_accounts WHERE booking_id = $1 LIMIT 1`,`
- Line 132: `const created = await client.query(`
- Line 145: `const ins = await client.query(`
- Line 162: `await client.query(`
- Line 172: `await client.query(`

## src\app\api\booking-applications\[id]\route.ts
- Line 19: `await query(``
- Line 42: `const rows = await query(`
- Line 43: ``SELECT b.*,`
- Line 71: `(SELECT json_agg(json_build_object('charge_name', cc.charge_name, 'amount', cc.amount, 'remarks', cc.remarks))`
- Line 76: `(SELECT json_agg(json_build_object(`
- Line 86: `(SELECT json_agg(json_build_object(`
- Line 159: `const existing = await query(`
- Line 160: ``SELECT b.*, w.assigned_to,`
- Line 512: `await client.query(`
- Line 518: `await client.query(`
- Line 523: `return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];`
- Line 535: `const held = await client.query(`
- Line 536: ``SELECT booking_id FROM inventory_units`
- Line 552: `await client.query(`
- Line 557: `await client.query(`
- Line 562: `return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];`
- Line 569: `await client.query(`
- Line 573: `return (await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)])).rows[0];`
- Line 585: `await client.query(`UPDATE booking_applications SET ${baSet.join(", ")} WHERE id = $${baVals.length}`, baVals);`
- Line 615: `const fRes = await client.query(`UPDATE booking_financials SET ${fSet.join(", ")} WHERE booking_id = $${fVals.length}`, fVals);`
- Line 623: `await client.query(`INSERT INTO booking_financials (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), ...vals]);`
- Line 635: `const lRes = await client.query(`UPDATE booking_loan_details SET ${lSet.join(", ")} WHERE booking_id = $${lVals.length}`, lVals);`
- Line 641: `await client.query(`INSERT INTO booking_loan_details (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), ...vals])`
- Line 653: `const rRes = await client.query(`UPDATE booking_registration_details SET ${rSet.join(", ")} WHERE booking_id = $${rVals.length}`, rVals);`
- Line 659: `await client.query(`INSERT INTO booking_registration_details (booking_id, ${cols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})`, [Number(id), .`
- Line 663: `const accountQuery = await client.query(`SELECT id FROM financial_accounts WHERE booking_id = $1`, [Number(id)]);`
- Line 668: `const accInsert = await client.query(`INSERT INTO financial_accounts (booking_id, organization_id) VALUES ($1, $2) RETURNING id`, [Number(id), orgId])`
- Line 674: `await client.query(``
- Line 695: `await client.query(`DELETE FROM booking_custom_charges WHERE booking_id = $1`, [Number(id)]);`
- Line 697: `await client.query(``
- Line 705: `await client.query(`
- Line 712: `const rows = await client.query(`SELECT * FROM booking_applications WHERE id = $1`, [Number(id)]);`

## src\app\api\booking-applications\[id]\tds\route.ts
- Line 41: `const rows = await query(`
- Line 42: ``SELECT * FROM booking_tds_records WHERE booking_id = $1 ORDER BY created_at ASC`,`
- Line 80: `const bookingRes = await query(`SELECT id FROM booking_applications WHERE id = $1`, [Number(id)]);`
- Line 87: `const rows = await query(`
- Line 91: `(SELECT organization_id FROM booking_applications WHERE id = $1))`
- Line 140: `const rows = await query(`

## src\app\api\booking-applications\[id]\tranche-override\route.ts
- Line 103: ``SELECT lead_id FROM booking_applications WHERE id = $1`,`
- Line 157: `const adj = await client.query(`
- Line 179: `const tranche = await client.query(`
- Line 193: `await client.query(`

## src\app\api\booking-details\[bookingId]\route.ts
- Line 15: `const financialsRes = await query(`SELECT * FROM booking_financials WHERE booking_id = $1`, [bookingId]);`
- Line 17: `const loanRes = await query(`SELECT * FROM booking_loan_details WHERE booking_id = $1`, [bookingId]);`
- Line 19: `const registrationRes = await query(`SELECT * FROM booking_registration_details WHERE booking_id = $1`, [bookingId]);`
- Line 21: `const pipelineRes = await query(`SELECT * FROM booking_pipeline WHERE booking_id = $1`, [bookingId]);`
- Line 23: `const customChargesRes = await query(`SELECT * FROM booking_custom_charges WHERE booking_id = $1`, [bookingId]);`
- Line 25: `const documentsRes = await query(`SELECT * FROM booking_documents WHERE booking_id = $1 ORDER BY created_at DESC`, [bookingId]);`

## src\app\api\booking-documents\[bookingId]\route.ts
- Line 12: `const res = await query(`SELECT * FROM booking_documents WHERE booking_id = $1`, [bookingId]);`
- Line 49: `const bookingRes = await query(`SELECT booking_number, lead_id FROM booking_applications WHERE id = $1`, [bookingId]);`
- Line 66: `const insertRes = await query(``
- Line 69: `(SELECT organization_id FROM booking_applications WHERE id = $1))`

## src\app\api\caller-leads\route.ts
- Line 24: `const { rows: batchRows } = await client.query(`
- Line 33: `const { rows } = await client.query(`
- Line 87: `const rows = await query(`
- Line 88: ``SELECT id, file_name, row_count, uploaded_by, created_at`
- Line 94: `const rows = await query(`
- Line 95: ``SELECT cl.*,`
- Line 132: `await client.query(`
- Line 134: `WHERE lead_id IN (SELECT id FROM caller_leads WHERE upload_batch::text = $1)`,`
- Line 137: `await client.query(`DELETE FROM caller_leads WHERE upload_batch::text = $1`, [batchId]);`
- Line 138: `await client.query(`DELETE FROM caller_upload_batches WHERE id::text = $1`, [batchId]);`

## src\app\api\caller-leads\[id]\follow-ups\route.ts
- Line 21: `const rows = await query(`
- Line 26: `(SELECT organization_id FROM caller_leads WHERE id = $1)) RETURNING *`,`

## src\app\api\caller-leads\[id]\route.ts
- Line 42: `const rows = await query(`
- Line 79: `const { rows: leadRows } = await client.query(`
- Line 80: ``SELECT upload_batch FROM caller_leads WHERE id = $1`, [leadId]`
- Line 84: `await client.query(`DELETE FROM caller_follow_ups WHERE lead_id = $1`, [leadId]);`
- Line 85: `await client.query(`DELETE FROM caller_leads WHERE id = $1`, [leadId]);`
- Line 88: `const { rows: remaining } = await client.query(`
- Line 89: ``SELECT COUNT(*) as cnt FROM caller_leads WHERE upload_batch = $1`, [batchId]`
- Line 92: `await client.query(`DELETE FROM caller_upload_batches WHERE id = $1`, [batchId]);`

## src\app\api\calls\manual\route.ts
- Line 107: ``SELECT phone FROM walkin_enquiries WHERE id = $1`,`
- Line 116: ``SELECT contact_no FROM caller_leads WHERE id = $1`,`
- Line 156: ``SELECT phone, whatsapp_number FROM users WHERE id = $1`,`

## src\app\api\channel-partners\bulk-assign\route.ts
- Line 45: `{ success: false, message: "Select at least one channel partner.", code: "NO_PARTNERS" },`
- Line 80: `const res = await client.query(`

## src\app\api\channel-partners\lookup\route.ts
- Line 50: `const rows = await query(`
- Line 51: ``SELECT cp.id, cp.name, cp.company_name, cp.phone, cp.status,`
- Line 64: `(SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count`

## src\app\api\channel-partners\phone-check\route.ts
- Line 48: `const rows = await query(`
- Line 49: ``SELECT cp.id, cp.name, cp.company_name, cp.status,`

## src\app\api\channel-partners\route.ts
- Line 112: `const rows = await query(`
- Line 113: ``SELECT cp.*,`
- Line 119: `(SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,`
- Line 120: `(SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count`
- Line 198: `? await query(`
- Line 199: ``SELECT id FROM channel_partners`
- Line 292: `// phone can't slip between the SELECT and the write.`
- Line 294: `const hit = await client.query(`
- Line 295: ``SELECT id, name, assigned_sourcing_manager_id FROM channel_partners`
- Line 325: `const upd = await client.query(`
- Line 367: `const ins = await client.query(`

## src\app\api\channel-partners\[id]\commissions\route.ts
- Line 24: `const rows = await query(`
- Line 25: ``SELECT c.*, b.booking_number, b.primary_name AS buyer_name`
- Line 38: ``SELECT COALESCE(SUM(gross_commission_amount), 0) AS total`

## src\app\api\channel-partners\[id]\eligible-bookings\route.ts
- Line 28: `const rows = await query(`
- Line 29: ``SELECT b.id, b.booking_number, b.agreement_value, b.primary_name AS buyer_name`
- Line 33: `SELECT 1 FROM cp_commissions c`

## src\app\api\channel-partners\[id]\overview\route.ts
- Line 54: `const partnerRows = await query(`
- Line 55: ``SELECT cp.id, cp.name, cp.company_name, cp.rera_registration_no, cp.pan_number,`
- Line 98: `query(`
- Line 99: ``SELECT w.id, w.sr_no, w.created_at, w.enquiry_date, w.status,`
- Line 113: `query(`
- Line 114: ``SELECT v.id, v.lead_id, v.visit_date, v.status, v.notes,`
- Line 124: `query(`
- Line 125: ``SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at,`
- Line 135: `query(`
- Line 136: ``SELECT b.id, b.booking_number, b.lead_id, b.created_at`

## src\app\api\channel-partners\[id]\recalculate-commissions\route.ts
- Line 46: `const cpRes = await client.query(`
- Line 47: ``SELECT id, name, default_commission_rate FROM channel_partners WHERE id = $1`,`
- Line 64: `const targets = await client.query(`
- Line 65: ``SELECT id FROM cp_commissions`

## src\app\api\channel-partners\[id]\route.ts
- Line 77: `const rows = await query(`
- Line 78: ``SELECT cp.*,`
- Line 84: `(SELECT COUNT(*) FROM walkin_enquiries w WHERE w.channel_partner_id = cp.id) AS lead_count,`
- Line 85: `(SELECT COUNT(*) FROM booking_applications b WHERE b.sourced_by_channel_partner_id = cp.id) AS booking_count`
- Line 266: `const rows = await query(`
- Line 308: `const [refs] = await query(`
- Line 310: `(SELECT COUNT(*) FROM walkin_enquiries    WHERE channel_partner_id = $1)            AS lead_count,`
- Line 311: `(SELECT COUNT(*) FROM booking_applications WHERE sourced_by_channel_partner_id = $1) AS booking_count,`
- Line 312: `(SELECT COUNT(*) FROM cp_commissions      WHERE channel_partner_id = $1)            AS commission_count,`
- Line 313: `(SELECT name FROM channel_partners        WHERE id = $1)                            AS name`,`
- Line 345: `await query(`DELETE FROM channel_partners WHERE id = $1`, [cpId]);`

## src\app\api\cp-commissions\by-booking\[bookingId]\route.ts
- Line 30: `const rows = await query(`
- Line 31: ``SELECT c.*, cp.name AS channel_partner_name, cp.status AS channel_partner_status,`

## src\app\api\cp-commissions\route.ts
- Line 44: `const rows = await query(`
- Line 45: ``SELECT c.*, cp.name AS channel_partner_name, b.booking_number`

## src\app\api\cp-commissions\[id]\reverse\route.ts
- Line 34: `const found = await client.query(`SELECT booking_id FROM cp_commissions WHERE id = $1`, [`

## src\app\api\cp-commissions\[id]\route.ts
- Line 44: `const rows = await query(`
- Line 45: ``SELECT c.*, cp.name AS channel_partner_name, b.booking_number`
- Line 139: `const rows = await query(`
- Line 148: `const exists = await query(`SELECT status FROM cp_commissions WHERE id = $1`, [Number(id)]);`

## src\app\api\cp-enquiries\route.ts
- Line 137: `const rows = await query(`

## src\app\api\cp-enquiries\[id]\assign\route.ts
- Line 51: `const check = await query(`
- Line 52: ``SELECT id FROM users`
- Line 74: `const existing = await client.query(`
- Line 75: ``SELECT id, source, sourcing_manager_id,`
- Line 105: `const rows = await client.query(`
- Line 115: `await client.query(`
- Line 127: `(SELECT organization_id FROM walkin_enquiries WHERE id = $1))`,`

## src\app\api\cp-enquiries\[id]\assignment-history\route.ts
- Line 35: `const leadRows = await query(`
- Line 36: ``SELECT id, source, sourcing_manager_id`
- Line 61: `const rows = await query(`

## src\app\api\cp-enquiries\[id]\route.ts
- Line 69: `const rows = await query(SELECT_SQL, [enquiryId]);`

## src\app\api\debug\route.ts
- Line 15: `const db = await query(`SELECT current_database() AS db, inet_server_addr() AS host`);`
- Line 16: `const cols = await query(``
- Line 17: `SELECT column_name`
- Line 59: `// 3. Select **Branch: main**`

## src\app\api\debug-attendance\route.ts
- Line 12: `const existing = await query(``
- Line 13: `SELECT id, login_time, employee_id, attendance_status FROM attendance_records`
- Line 18: `const allToday = await query(``
- Line 19: `SELECT id, login_time, employee_id, attendance_status FROM attendance_records`

## src\app\api\employees\route.ts
- Line 15: `const users = await query(`
- Line 16: ``SELECT id, name, username, email, password, role, is_active as "isActive", created_at`
- Line 42: `const emailCheck = await query(`
- Line 43: ``SELECT id FROM users WHERE email = $1 LIMIT 1`,`
- Line 51: `const usernameCheck = await query(`
- Line 52: ``SELECT id FROM users WHERE username = $1 LIMIT 1`,`
- Line 59: `await query(`
- Line 95: `const conflict = await query(`
- Line 96: ``SELECT id FROM users WHERE username = $1 AND id != $2 LIMIT 1`,`
- Line 106: `const conflict = await query(`
- Line 107: ``SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1`,`
- Line 130: `const updated = await query(`
- Line 148: `const updated = await query(`
- Line 180: `const deleted = await query(`

## src\app\api\followups\route.ts
- Line 32: `SELECT id::text                            AS "_id",`
- Line 94: ``SELECT id, name, assigned_to, assigned_receptionist FROM walkin_enquiries WHERE id = $1`,`
- Line 134: ``SELECT id, name FROM users`
- Line 193: ``SELECT id, sent_to_user_id, created_by_name`
- Line 220: `const r = await client.query(`
- Line 230: `await client.query(`
- Line 259: `? await query(`
- Line 263: `: await query(`${SELECT_COLUMNS} ORDER BY created_at ASC`);`
- Line 311: `const leadRows = await query(`
- Line 312: ``SELECT id FROM walkin_enquiries WHERE id = $1`,`
- Line 322: `const rows = await query(`

## src\app\api\followups\unread-count\route.ts
- Line 33: ``SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at`

## src\app\api\inventory\analytics\route.ts
- Line 34: `const byStatus = await query(`
- Line 35: ``SELECT u.status, COUNT(*)::int AS count,`
- Line 44: `const byType = await query(`
- Line 45: ``SELECT u.unit_type,`
- Line 57: `const byTower = await query(`
- Line 58: ``SELECT COALESCE(t.name, u.tower) AS tower,`
- Line 78: `const velocity = await query(`
- Line 79: ``SELECT DATE_TRUNC('week', h.changed_at)::date AS week, COUNT(*)::int AS sold`
- Line 92: ``SELECT COUNT(*)::int AS total_units,`
- Line 106: `const ageing = await query(`
- Line 118: `const holds = await query(`
- Line 119: ``SELECT u.id, u.flat_no, u.tower, u.floor, u.held_by, u.hold_expires_at,`

## src\app\api\inventory\building\route.ts
- Line 45: ``SELECT COUNT(*)::int AS matched,`
- Line 78: `const rows = (await client.query(`SELECT * FROM inventory_units WHERE ${whereSql}`, vals)).rows;`

## src\app\api\inventory\bulk\route.ts
- Line 31: `const rows = (await client.query(`
- Line 32: ``SELECT * FROM inventory_units WHERE id = ANY($1) AND deleted_at IS NULL`,`

## src\app\api\inventory\bulk-generate\route.ts
- Line 78: `const ins = await client.query(`
- Line 103: `await client.query(`
- Line 106: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`

## src\app\api\inventory\offers\route.ts
- Line 38: `const rows = await query(`
- Line 39: ``SELECT o.*, u.flat_no, u.tower, u.floor, u.project_name, w.name AS lead_name`
- Line 68: ``SELECT id, flat_no, status, booking_id FROM inventory_units WHERE id = $1 AND deleted_at IS NULL`,`
- Line 102: ``SELECT * FROM inventory_discount_bands`
- Line 126: `const rows = await query(`
- Line 132: `(SELECT organization_id FROM inventory_units WHERE id = $1))`

## src\app\api\inventory\offers\[id]\decide\route.ts
- Line 34: `const rows = await query<any>(`SELECT * FROM inventory_offers WHERE id = $1`, [Number(id)]);`
- Line 95: `const updated = await query(`

## src\app\api\inventory\price-rules\route.ts
- Line 28: `SELECT * FROM inventory_price_rules`
- Line 52: `const rows = await query(`
- Line 53: ``SELECT r.*, p.name AS project_name, t.name AS tower_name`
- Line 106: `const rows = await query(`
- Line 116: `(SELECT organization_id FROM inventory_projects WHERE id = $1))`

## src\app\api\inventory\projects\route.ts
- Line 26: `const rows = await query(`
- Line 27: ``SELECT p.*,`
- Line 34: `SELECT project_id,`
- Line 41: `SELECT project_id, COUNT(*)::int AS towers`
- Line 78: `const rows = await query(`

## src\app\api\inventory\route.ts
- Line 52: `await query(`
- Line 59: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`
- Line 97: `query(`
- Line 98: ``SELECT LOWER(TRIM(project_name)) AS key,`
- Line 108: `query(`
- Line 109: ``SELECT LOWER(TRIM(project_name)) AS key,`
- Line 118: `query(`
- Line 119: ``SELECT LOWER(TRIM(project_name)) AS key, tower, unit_type,`
- Line 134: `query(`
- Line 135: ``SELECT LOWER(TRIM(project_name)) AS key, tower,`
- Line 217: ``SELECT COUNT(*)::int AS count FROM inventory_units ${whereSql}`, vals,`
- Line 233: `const rows = await query(`
- Line 234: ``SELECT u.*,`
- Line 240: `SELECT * FROM inventory_units ${whereSql} ${orderSql} LIMIT ${limP} OFFSET ${offP}`
- Line 295: `const dup = await query(`
- Line 296: ``SELECT id FROM inventory_units`
- Line 315: `const ins = await client.query(`
- Line 337: `await client.query(`
- Line 340: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`

## src\app\api\inventory\towers\route.ts
- Line 27: `const rows = await query(`
- Line 28: ``SELECT t.*, p.name AS project_name,`
- Line 35: `SELECT tower_id,`
- Line 72: `const proj = await query(`
- Line 73: ``SELECT id FROM inventory_projects WHERE id = $1 AND deleted_at IS NULL`, [projectId]);`
- Line 79: `const rows = await query(`
- Line 84: `(SELECT organization_id FROM inventory_projects WHERE id = $1)) RETURNING *`,`

## src\app\api\inventory\[id]\cost-sheet\route.ts
- Line 21: `SELECT u.*, p.name AS project_label, t.name AS tower_label`
- Line 34: `const rows = await query(`
- Line 35: ``SELECT cs.*, w.name AS lead_name`
- Line 102: `await client.query(`SELECT id FROM inventory_units WHERE id = $1 FOR UPDATE`, [Number(id)]);`
- Line 104: `const prev = await client.query(`
- Line 105: ``SELECT COALESCE(MAX(version), 0) AS v FROM inventory_cost_sheets WHERE unit_id = $1`,`
- Line 110: `await client.query(`
- Line 116: `const ins = await client.query(`
- Line 127: `(SELECT organization_id FROM inventory_units WHERE id = $1))`

## src\app\api\inventory\[id]\hold\route.ts
- Line 45: `const cur = await client.query(`
- Line 46: ``SELECT id, status, flat_no, tower, held_by, held_for_lead_id, hold_expires_at, booking_id`
- Line 70: `const upd = await client.query(`
- Line 81: `await client.query(`
- Line 84: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`
- Line 112: `const cur = await client.query(`
- Line 113: ``SELECT id, status, flat_no, held_by FROM inventory_units`
- Line 133: `const upd = await client.query(`
- Line 142: `await client.query(`
- Line 145: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`

## src\app\api\inventory\[id]\route.ts
- Line 50: `SELECT iu.*, w.name AS lead_name, w.phone AS lead_phone, w.email AS lead_email,`
- Line 68: `let rows = await query(UNIT_DETAIL_SQL, [Number(id)]);`
- Line 75: `await query(`
- Line 79: `await query(`
- Line 82: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`
- Line 85: `rows = await query(UNIT_DETAIL_SQL, [Number(id)]);`
- Line 88: `const history = await query(`
- Line 89: ``SELECT * FROM inventory_unit_history WHERE unit_id = $1 ORDER BY changed_at DESC, id DESC`,`
- Line 117: `const existing = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);`
- Line 166: `const updated = await client.query(`
- Line 175: `await client.query(`
- Line 178: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`
- Line 223: `const existing = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);`
- Line 243: `const upd = await client.query(`SELECT * FROM inventory_units WHERE id = $1`, [Number(id)]);`

## src\app\api\leads\lost\route.ts
- Line 49: `const existing = await query(`
- Line 50: `"SELECT id, name, is_lost_lead FROM walkin_enquiries WHERE id = $1",`
- Line 62: `? await query(`
- Line 72: `: await query(`
- Line 95: `await query(`

## src\app\api\leads\restore\route.ts
- Line 36: `const existing = await query(`
- Line 37: `"SELECT id, name, is_lost_lead FROM walkin_enquiries WHERE id = $1",`
- Line 48: `const updatedRows = await query(`
- Line 69: `await query(`

## src\app\api\leads\transfer\route.ts
- Line 43: `const existing = await query(`
- Line 44: ``SELECT id, sr_no, assigned_to, assigned_receptionist FROM walkin_enquiries WHERE id = $1`,`
- Line 60: `{ success: false, message: `Lead is already assigned to ${transfer_to}. Please select a different manager.` },`
- Line 77: `const followUpRows = await query(`
- Line 97: `const updatedRows = await query(`
- Line 115: `await query(`

## src\app\api\leads\[id]\assignment-history\route.ts
- Line 24: `const rows = await query(`
- Line 26: `SELECT id, lead_id, assigned_to, assigned_by, assigned_at, reason`

## src\app\api\leads\[id]\follow-ups\route.ts
- Line 13: `const messages = await query(`
- Line 14: ``SELECT * FROM follow_ups ORDER BY created_at ASC``
- Line 55: `const rows = await query(`

## src\app\api\loan\route.ts
- Line 16: `await query(``
- Line 34: `? await query(`
- Line 35: ``SELECT * FROM loan_updates WHERE lead_id = $1 ORDER BY created_at ASC`,`
- Line 38: `: await query(`SELECT * FROM loan_updates ORDER BY created_at ASC`);`
- Line 68: `const leadRows = await query(`
- Line 69: ``SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1`,`
- Line 90: ``SELECT new_status, status FROM loan_updates WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,`
- Line 97: `const rows = await query(`
- Line 166: `await query(`

## src\app\api\loan-applications\[id]\route.ts
- Line 77: ``SELECT booking_id, lead_id FROM loan_applications WHERE id = $1`,`
- Line 121: `const existing = await client.query(`SELECT * FROM loan_applications WHERE id = $1`, [Number(id)]);`
- Line 136: `const updated = await client.query(`
- Line 145: `await client.query(`
- Line 153: `const b = await client.query(`
- Line 154: ``SELECT id FROM booking_applications WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,`
- Line 166: `await client.query(`UPDATE loan_applications SET booking_id = $1 WHERE id = $2`, [targetBookingId, Number(id)]);`
- Line 168: `const upd = await client.query(`
- Line 179: `await client.query(`
- Line 185: `(SELECT organization_id FROM booking_applications WHERE id = $1))`,`
- Line 212: `await client.query(`
- Line 254: `await query(`DELETE FROM loan_applications WHERE id = $1`, [Number(id)]);`

## src\app\api\lost-lead\route.ts
- Line 41: `const existing = await query(`
- Line 42: ``SELECT id, name, sr_no, is_lost_lead FROM walkin_enquiries WHERE id = $1`,`
- Line 61: `const updatedRows = await query(`
- Line 77: `await query(`
- Line 123: `const existing = await query(`
- Line 124: ``SELECT id, name, sr_no, is_lost_lead FROM walkin_enquiries WHERE id = $1`,`
- Line 143: `const updatedRows = await query(`
- Line 159: `await query(`

## src\app\api\migrate\route.ts
- Line 17: `await query(``
- Line 32: `await query(``
- Line 48: `await query(``
- Line 62: `await query(``
- Line 73: `await query(``
- Line 78: `await query(``
- Line 84: `await query(``
- Line 90: `await query(``

## src\app\api\monitoring\daily-stats\route.ts
- Line 29: `return await query(sql, params);`
- Line 36: `const users = await query(``
- Line 37: `SELECT id, name, role FROM public.users`
- Line 43: `SELECT assigned_to AS name, COUNT(*) AS total`
- Line 50: `SELECT created_by_name AS name, COUNT(*) AS count`
- Line 59: `SELECT sender_name AS name, COUNT(*) AS count`
- Line 67: ``SELECT sv.*, we.name, we.assigned_to, we.status as lead_status`
- Line 81: ``SELECT sv.*, we.name, we.assigned_to, we.status as lead_status`
- Line 112: `SELECT we.id, we.name, we.assigned_to`
- Line 117: `SELECT 1 FROM public.follow_ups f`

## src\app\api\pincode-lookup\route.ts
- Line 91: `const rows = await query(`
- Line 92: ``SELECT p.city, p.state,`
- Line 95: `FROM (SELECT $1::varchar AS pin) k`
- Line 124: `await query(`

## src\app\api\receptionist\assigned\route.ts
- Line 21: `const rows = await query(`
- Line 22: ``SELECT * FROM walkin_enquiries`

## src\app\api\receptionist\leads\route.ts
- Line 21: `const rows = await query(`
- Line 22: ``SELECT * FROM walkin_enquiries`

## src\app\api\revenue-intelligence\route.ts
- Line 26: `SELECT table_name`
- Line 39: `SELECT column_name`
- Line 51: `query(`CREATE INDEX IF NOT EXISTS idx_rev_booking_status_date ON booking_applications (booking_status, booking_date)`),`
- Line 52: `query(`CREATE INDEX IF NOT EXISTS idx_rev_booking_created_at ON booking_applications (created_at DESC)`),`
- Line 53: `query(`CREATE INDEX IF NOT EXISTS idx_rev_financials_booking_id ON booking_financials (booking_id)`),`
- Line 54: `query(`CREATE INDEX IF NOT EXISTS idx_rev_loan_booking_id ON booking_loan_details (booking_id)`),`
- Line 55: `query(`CREATE INDEX IF NOT EXISTS idx_rev_loan_expected_disbursement ON booking_loan_details (expected_disbursement_date)`),`
- Line 56: `query(`CREATE INDEX IF NOT EXISTS idx_rev_registration_booking_id ON booking_registration_details (booking_id)`),`
- Line 57: `query(`CREATE INDEX IF NOT EXISTS idx_rev_registration_expected_date ON booking_registration_details (expected_registration_date)`),`
- Line 137: `SELECT c.gross_commission_amount, c.tds_amount, c.net_payable_amount,`
- Line 176: `const projectSelect = optionalWalkinColumn(walkinColumns, "project", "project");`
- Line 177: `const buildingSelect = optionalWalkinColumn(walkinColumns, "building", "building");`
- Line 178: `const wingSelect = optionalWalkinColumn(walkinColumns, "wing", "wing");`
- Line 267: `SELECT *`
- Line 271: `SELECT *`
- Line 277: `const records = await query(sql, params);`

## src\app\api\roles\route.ts
- Line 10: `const roles = await query(`
- Line 11: ``SELECT id, name FROM roles ORDER BY name ASC``
- Line 39: `const existing = await query(`
- Line 40: ``SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`,`
- Line 47: `const [newRole] = await query(`

## src\app\api\sales-form-submit\route.ts
- Line 90: `const lockCheck = await client.query(`
- Line 91: ``SELECT status, is_lost_lead FROM walkin_enquiries WHERE id = $1 FOR UPDATE`,`
- Line 103: `const followUpRes = await client.query(`
- Line 112: `await client.query(`
- Line 140: `await client.query(`

## src\app\api\settings\account\route.ts
- Line 28: ``SELECT COUNT(*)::text AS count FROM employee_sessions`
- Line 34: ``SELECT password FROM users WHERE id = $1`,`
- Line 101: `await query(`

## src\app\api\settings\activity-logs\route.ts
- Line 93: ``SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY name``

## src\app\api\settings\api-keys\route.ts
- Line 35: `const rows = await query(`
- Line 36: ``SELECT k.id, k.name, k.key_prefix, k.scopes, k.rate_limit_per_min,`
- Line 45: `SELECT SUM(u.request_count)`
- Line 97: `{ success: false, message: "Select at least one scope, or the key cannot do anything." },`

## src\app\api\settings\api-keys\usage\route.ts
- Line 38: ``SELECT COALESCE(SUM(request_count), 0)::text AS requests,`
- Line 53: ``SELECT to_char(date_trunc('day', bucket_start), 'YYYY-MM-DD') AS day,`
- Line 71: ``SELECT endpoint,`
- Line 90: ``SELECT k.id, k.name, k.key_prefix, SUM(u.request_count)::text AS requests`

## src\app\api\settings\api-keys\[id]\rotate\route.ts
- Line 68: `const existingRes = await client.query(`
- Line 69: ``SELECT id, name, key_prefix, scopes, rate_limit_per_min, ip_whitelist,`
- Line 86: `const insertRes = await client.query(`
- Line 112: `await client.query(`
- Line 121: `await client.query(`

## src\app\api\settings\api-keys\[id]\route.ts
- Line 30: ``SELECT id, name, key_prefix, scopes, rate_limit_per_min, ip_whitelist,`
- Line 90: `{ success: false, message: "Select at least one scope, or revoke the key instead." },`
- Line 135: `await query(`
- Line 197: `await query(`

## src\app\api\settings\avatar\route.ts
- Line 117: `await query(`
- Line 154: `await query(`

## src\app\api\settings\bolna\route.ts
- Line 141: `await query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [`
- Line 181: `await query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [`

## src\app\api\settings\deactivate\route.ts
- Line 44: ``SELECT password, name, email, role FROM users WHERE id = $1 LIMIT 1`,`
- Line 60: ``SELECT COUNT(*)::text AS count FROM users`
- Line 76: `await query(`
- Line 83: `await query(`
- Line 107: ``SELECT id, name FROM users`

## src\app\api\settings\email-change\route.ts
- Line 80: ``SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,`
- Line 93: ``SELECT created_at FROM email_change_otps`
- Line 114: `await query(`
- Line 125: `await query(`
- Line 131: `(SELECT organization_id FROM users WHERE id = $1))`,`

## src\app\api\settings\email-senders\route.ts
- Line 58: ``SELECT created_at, email_type, recipient, destination, transport, error`
- Line 66: ``SELECT COUNT(*)::text AS total,`

## src\app\api\settings\email-verify\route.ts
- Line 52: ``SELECT id, new_email, otp_hash, attempts, expires_at`
- Line 70: `await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);`
- Line 78: `await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);`
- Line 128: ``SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,`
- Line 132: `await query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [record.id]);`
- Line 143: `await client.query(`
- Line 149: `await client.query(`UPDATE email_change_otps SET consumed_at = NOW() WHERE id = $1`, [`

## src\app\api\settings\employees\route.ts
- Line 42: `const rows = await query<{ name: string }>(`SELECT name FROM roles ORDER BY id`);`
- Line 106: `SELECT u.id, u.name, u.email, u.phone, u.username, u.role, u.department,`
- Line 213: ``SELECT id, email, name FROM users`
- Line 231: `const manager = await query<{ id: number }>(`SELECT id FROM users WHERE id = $1`, [`
- Line 391: ``SELECT COUNT(*)::text AS count FROM users`
- Line 415: `await query(`
- Line 457: `await query(`
- Line 513: ``SELECT COUNT(*)::text AS count FROM users`
- Line 526: `await query(`
- Line 536: `await query(`
- Line 575: ``SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,`
- Line 593: ``SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1`,`
- Line 625: ``SELECT COUNT(*)::text AS count FROM users`
- Line 656: `const manager = await query<{ id: number }>(`SELECT id FROM users WHERE id = $1`, [managerId]);`
- Line 687: `await query(`
- Line 753: ``SELECT COUNT(*)::text AS count FROM users`
- Line 786: `await query(`
- Line 794: `await query(`

## src\app\api\settings\feature-prefs\route.ts
- Line 40: ``SELECT name, feature_prefs FROM public.users WHERE id = $1 LIMIT 1`,`
- Line 62: ``SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = $1`,`
- Line 126: `await query(`UPDATE public.users SET feature_prefs = $1, updated_at = NOW() WHERE id = $2`, [`

## src\app\api\settings\lead-sorting\route.ts
- Line 13: `const res = await query(`
- Line 14: ``SELECT lead_number_sorting_enabled`
- Line 56: `await query(`

## src\app\api\settings\manual-calling\route.ts
- Line 26: `query(`INSERT INTO admin_audit_logs (admin_id, action) VALUES ($1, $2)`, [`

## src\app\api\settings\notification-recipients\route.ts
- Line 187: `await query(`
- Line 191: `(SELECT organization_id FROM users WHERE id = $1))`
- Line 212: `await query(`

## src\app\api\settings\notifications\route.ts
- Line 130: `await query(`

## src\app\api\settings\password\route.ts
- Line 50: ``SELECT password, name, email FROM users WHERE id = $1 LIMIT 1`,`
- Line 94: `await query(`
- Line 111: `await query(`

## src\app\api\settings\preferences\route.ts
- Line 137: `await query(`

## src\app\api\settings\profile\route.ts
- Line 113: ``SELECT id FROM users WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1`,`
- Line 217: `await query(`

## src\app\api\settings\sessions\route.ts
- Line 44: ``SELECT id, session_start, last_heartbeat, session_end, ip_address, device_info, is_active`

## src\app\api\settings\sm-upload\route.ts
- Line 13: `const res = await query(`
- Line 14: ``SELECT allow_sm_upload`
- Line 51: `await query(`

## src\app\api\settings\whatsapp-integration\route.ts
- Line 59: ``SELECT whatsapp_number, name FROM public.users WHERE id = $1 LIMIT 1`,`

## src\app\api\settings\working-hours\route.ts
- Line 14: `const res = await query(`
- Line 15: ``SELECT shift_start, shift_end, flexible FROM organization_settings WHERE organization_id = $1`,`
- Line 28: `await query(`
- Line 81: `const prevRes = await query(`
- Line 82: ``SELECT shift_start, shift_end FROM organization_settings WHERE organization_id = $1`,`
- Line 89: `await query(`
- Line 105: `await query(`

## src\app\api\settings\workspace\route.ts
- Line 44: ``SELECT organization_id, workspace_name, industry, currency, timezone,`
- Line 70: `query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM walkin_enquiries`),`
- Line 71: `query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM booking_applications`),`
- Line 73: ``SELECT COUNT(*)::text AS count FROM users WHERE deleted_at IS NULL AND is_active = true``
- Line 75: `query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM channel_partners`),`
- Line 203: `await query(`

## src\app\api\site-visits\all\route.ts
- Line 20: `SELECT`
- Line 56: `const rows = await query(sql, params);`
- Line 78: `await query(`DELETE FROM public.site_visits WHERE id = $1`, [id]);`

## src\app\api\site-visits\route.ts
- Line 18: `const rows = await query(`
- Line 19: ``SELECT * FROM public.site_visits`
- Line 37: `const rows = await query(`
- Line 38: ``SELECT sv.*, we.name as lead_name, we.assigned_to`
- Line 66: `const leadRows = await query(`
- Line 67: ``SELECT status, is_lost_lead FROM public.walkin_enquiries WHERE id = $1`,`
- Line 87: `const existing = await query(`
- Line 88: ``SELECT id FROM public.site_visits`
- Line 99: `const result = await query(`
- Line 109: `await query(`
- Line 131: `await query(`DELETE FROM public.site_visits WHERE id = $1`, [id]);`
- Line 170: `const result = await query(`
- Line 186: `await query(`
- Line 192: `await query(`

## src\app\api\sm-ai-chat\route.ts
- Line 81: ``SELECT COUNT(*)::int total,`
- Line 90: ``SELECT w.id, w.sr_no, w.name, w.phone, w.status,`
- Line 93: `LEFT JOIN (SELECT lead_id, MAX(created_at) last_at FROM follow_ups GROUP BY lead_id) lastf`
- Line 101: ``SELECT w.id, w.sr_no, w.name, w.phone, w.status, sv.visit_date, sv.status AS visit_status`
- Line 107: ``SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(sv.status,'')) = 'completed')::int done,`
- Line 117: ``SELECT w.* FROM walkin_enquiries w WHERE ${scope} AND w.id = $2 LIMIT 1`,`
- Line 209: `const rows = await query<any>(`SELECT name, role FROM users WHERE id = $1 LIMIT 1`, [gate.userId]);`
- Line 254: `await query(`

## src\app\api\transfer-leads\route.ts
- Line 36: `const result = await client.query(`

## src\app\api\users\receptionist\route.ts
- Line 11: `const receptionists = await query(`
- Line 12: ``SELECT id, name, username, email, role, is_active as "isActive"`

## src\app\api\users\sales-manager\route.ts
- Line 12: `const managers = await query(`
- Line 13: ``SELECT id, name`

## src\app\api\users\site-head\route.ts
- Line 11: `// CHANGED: Using the "users" table and SELECT * to avoid column name mismatches`
- Line 12: `const rows = await query(`
- Line 13: ``SELECT * FROM users`

## src\app\api\users\sourcing-manager\route.ts
- Line 19: `const managers = await query(`
- Line 20: ``SELECT id, name, username, email, whatsapp_number AS phone, whatsapp_number`

## src\app\api\users\update-whatsapp\route.ts
- Line 58: `const rows = await query<Target>(`SELECT id, name FROM users WHERE id = $1 LIMIT 1`, [explicitId]);`
- Line 66: `const rows = await query<Target>(`SELECT id, name FROM users WHERE name = $1`, [name]);`
- Line 129: `await query(`UPDATE public.users SET whatsapp_number = $1 WHERE id = $2`, [`
- Line 165: ``SELECT whatsapp_number FROM public.users WHERE name = $1 LIMIT 1`,`
- Line 169: ``SELECT whatsapp_number FROM public.users WHERE id = $1 LIMIT 1`,`

## src\app\api\v1\bookings\route.ts
- Line 57: `const rows = await query(`
- Line 58: ``SELECT ${COLUMNS}`
- Line 67: ``SELECT COUNT(*)::text AS count FROM booking_applications ${whereSql}`,`

## src\app\api\v1\employees\route.ts
- Line 10: `// column list is an allow-list for exactly that class of reason — a SELECT *`
- Line 41: `const rows = await query(`
- Line 42: ``SELECT id, name, role, department, reporting_manager_id, is_active, created_at`
- Line 51: ``SELECT COUNT(*)::text AS count FROM users ${whereSql}`,`

## src\app\api\v1\followups\route.ts
- Line 31: `const rows = await query(`
- Line 32: ``SELECT id, lead_id, message, follow_up_type, created_by_name, created_by_role,`
- Line 44: ``SELECT COUNT(*)::text AS count`

## src\app\api\v1\inventory\units\route.ts
- Line 49: `const rows = await query(`
- Line 50: ``SELECT ${COLUMNS}`
- Line 59: ``SELECT COUNT(*)::text AS count FROM inventory_units ${whereSql}`,`
- Line 67: ``SELECT status, COUNT(*)::text AS count`

## src\app\api\v1\leads\route.ts
- Line 14: `// SELECT * would have been shorter and would have silently exported all three`
- Line 62: `const rows = await query(`
- Line 63: ``SELECT ${COLUMNS}`
- Line 72: ``SELECT COUNT(*)::text AS count FROM walkin_enquiries ${whereSql}`,`

## src\app\api\walkin_enquiries\bulk-delete\route.ts
- Line 80: `await client.query("SAVEPOINT lead_del");`
- Line 82: `const leadRows = await client.query(`
- Line 83: `"SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE",`
- Line 122: `await client.query("RELEASE SAVEPOINT lead_del");`
- Line 126: `await client.query("ROLLBACK TO SAVEPOINT lead_del");`

## src\app\api\walkin_enquiries\bulk-import\route.ts
- Line 45: `const settingRows = await query(`
- Line 46: ``SELECT allow_sm_upload FROM organization_settings WHERE organization_id = $1`,`

## src\app\api\walkin_enquiries\duplicates\route.ts
- Line 30: ``SELECT RIGHT(regexp_replace(phone, '[^0-9]', '', 'g'), 10) AS norm_phone,`

## src\app\api\walkin_enquiries\route.ts
- Line 16: `// This route has no role scoping — it is a plain SELECT * across every lead,`
- Line 39: `// Because this uses SELECT *, the new Site Head columns will be fetched automatically`
- Line 41: `query(`
- Line 42: `"SELECT * FROM walkin_enquiries ORDER BY sr_no DESC NULLS LAST LIMIT $1 OFFSET $2",`
- Line 45: `query("SELECT COUNT(*)::int AS total FROM walkin_enquiries"),`
- Line 88: `const duplicateCheck = await query(`
- Line 89: ``SELECT id FROM walkin_enquiries WHERE phone = $1 AND created_at >= NOW() - INTERVAL '15 seconds'`,`
- Line 156: `const managerRows = await query(`
- Line 157: ``SELECT id FROM users`
- Line 208: `const insertRes = await client.query(`
- Line 293: `await client.query(`
- Line 324: `const finalRes = await client.query(`
- Line 325: `"SELECT * FROM walkin_enquiries WHERE id = $1",`

## src\app\api\walkin_enquiries\[id]\loan-applications\route.ts
- Line 27: `const rows = await query(`
- Line 28: ``SELECT * FROM loan_applications WHERE lead_id = $1 ORDER BY created_at ASC`,`
- Line 70: `const rows = await query(`
- Line 77: `(SELECT organization_id FROM walkin_enquiries WHERE id = $1))`

## src\app\api\walkin_enquiries\[id]\route.ts
- Line 36: `// Scoped to these columns rather than SELECT * so a read added for a prefill`
- Line 55: `const rows = await query(`
- Line 56: `"SELECT id, name, loan_tracking_info FROM walkin_enquiries WHERE id = $1",`
- Line 134: `const existingRows = await client.query(`
- Line 135: `"SELECT id, assigned_to, status, is_lost_lead FROM walkin_enquiries WHERE id = $1",`
- Line 201: `const updateRows = await client.query(`
- Line 207: `await client.query(`
- Line 211: `(SELECT organization_id FROM walkin_enquiries WHERE id = $1))`
- Line 224: `const finalRes = await client.query(`
- Line 225: `"SELECT * FROM walkin_enquiries WHERE id = $1",`
- Line 311: `const leadRows = await client.query(`
- Line 312: `"SELECT * FROM walkin_enquiries WHERE id = $1 FOR UPDATE",`

## src\app\api\walkin_enquiries\[id]\tranches\route.ts
- Line 35: `const result = await query(`
- Line 36: ``SELECT * FROM disbursement_tranches WHERE lead_id = $1 ORDER BY created_at ASC`,`
- Line 90: `const currentTotalRes = await query(`
- Line 91: ``SELECT COALESCE(SUM(amount), 0) AS total FROM disbursement_tranches WHERE lead_id = $1 AND LOWER(status) IN ('completed', 'received')`,`
- Line 187: `const trancheRes = await query(`
- Line 192: `(SELECT organization_id FROM walkin_enquiries WHERE id = $1))`
- Line 201: `const sumRes = await query(`
- Line 202: ``SELECT COALESCE(SUM(amount), 0) AS total FROM disbursement_tranches WHERE lead_id = $1 AND LOWER(status) IN ('completed', 'received')`,`
- Line 217: ``SELECT id FROM loan_applications WHERE booking_id = $1 AND is_selected = true LIMIT 1`,`

## src\app\api\whatsapp-logs\route.ts
- Line 16: `await query(`
- Line 24: `await query(`
- Line 54: `const logs = await query(`
- Line 55: ``SELECT * FROM public.whatsapp_logs`

## src\app\dashboard\caller\page.tsx
- Line 1027: `<select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="bg-[#1a1a1a] border border-[#222] rounded-lg px-3 py-2 text-sm`

## src\app\dashboard\employees\page.tsx
- Line 1396: `<select value={role} onChange={e => setRole(e.target.value)} required className={t.sel}>`
- Line 1427: `<label className={`block text-xs mb-1.5 font-medium ${t.textMuted}`}>Select Employee</label>`
- Line 1428: `<select value={selectedManageUserId} onChange={e => setSelectedManageUserId(e.target.value)} className={t.sel}>`
- Line 1429: `<option value="" disabled>-- Select user to manage --</option>`
- Line 1451: `<button disabled className={`py-2.5 px-6 rounded-lg font-bold text-sm cursor-not-allowed border ${isDark ? "bg-[#222] border-[#333] text-gray-500" : "`
- Line 1510: `? <select value={editForm.role || ""} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))} className={t.editSel}>`
- Line 1609: `<select value={assignUploadTo} onChange={e => setAssignUploadTo(e.target.value)} className={t.smallSel}>`
- Line 1964: `<select value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)} className={t.smallSel}>`
- Line 2094: `<option value="" disabled>-- Select target employee --</option>`

## src\app\dashboard\page.tsx
- Line 1367: `<select value={barMode} onChange={e => setBarMode(e.target.value as any)}`
- Line 1429: `<select value={pieMode} onChange={e => setPieMode(e.target.value as any)}`
- Line 1558: `// ── Bulk select + delete ───────────────────────────────────────────────────`
- Line 1620: `alert("Please select a different manager.");`
- Line 2070: `? "Select a sales manager to view their real-time data."`
- Line 2072: `? "Select a site head to view their real-time data."`
- Line 2073: `: "Select a receptionist to view their real-time data."}`
- Line 2077: `<select`
- Line 2094: `<select value={selectedManagerName} onChange={e => { setSelectedManagerName(e.target.value); setManagerLeadSearch(""); }}`
- Line 2096: `<option value="" disabled>-- Select Sales Manager --</option>`
- Line 2104: `<select value={selectedReceptionistName} onChange={e => { setSelectedReceptionistName(e.target.value); setRecepLeadSearch(""); }}`
- Line 2106: `<option value="" disabled>-- Select Receptionist --</option>`
- Line 2114: `<select value={selectedSiteHeadName} onChange={e => { setSelectedSiteHeadName(e.target.value); setSiteHeadLeadSearch(""); }}`
- Line 2116: `<option value="" disabled>-- Select Site Head --</option>`
- Line 2192: `<p>Select a manager to view their table.</p>`
- Line 2201: `<p>Select a site head to view their table.</p>`
- Line 2373: `<p>Select a receptionist to view their table.</p>`
- Line 2734: `<select required value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}`
- Line 2736: `<option value="" disabled>-- Select Manager --</option>`
- Line 3567: `const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;`
- Line 3619: `<p>Select a Sales Manager from the left sidebar.</p>`
- Line 3664: `<select value={leadStatusFilter} onChange={e => setLeadStatusFilter(e.target.value as "all" | "active" | "lost")} className={`rounded-lg px-4 py-3 sm:`
- Line 3829: `<select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}><option value="">Sele`
- Line 3834: `<select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}><option val`
- Line 3837: `<select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><opt`
- Line 3842: `<select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><optio`
- Line 4067: `<select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}`
- Line 4069: `<option value="" disabled>-- Select Manager --</option>`
- Line 4642: `const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;`
- Line 4717: `<p>Select a Site Head from the left sidebar.</p>`
- Line 4762: `<select value={leadStatusFilter} onChange={e => setLeadStatusFilter(e.target.value as "all" | "active" | "lost")} className={`rounded-lg px-4 py-3 sm:`
- Line 4909: `<select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={formSelect}><option value="">Sele`
- Line 4912: `<select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={formSelect}><option val`
- Line 4917: `<select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><optio`
- Line 4921: `<select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><opt`
- Line 5123: `<select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}`
- Line 5125: `<option value="" disabled>-- Select Manager --</option>`
- Line 5391: `alert("Please select a different manager.");`
- Line 5423: `const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${theme.inputInner} ${theme.text} ${theme.inputFocus}`;`
- Line 5781: `<p>Select a receptionist from the left sidebar.</p>`
- Line 6031: `<select value={salesForm.useType} onChange={e => setSalesForm({ ...salesForm, useType: e.target.value })} className={`w-full rounded-lg px-4 py-2 text`
- Line 6036: `<select value={salesForm.purchaseDate} onChange={e => setSalesForm({ ...salesForm, purchaseDate: e.target.value })} className={`w-full rounded-lg px-4`
- Line 6043: `<select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={`w-full rounded-lg`
- Line 6044: `<option value="" disabled>Select Status</option><option>Interested</option><option>Not Interested</option><option>NON GENUINE DEMAND (NGD)</option>`
- Line 6049: `<select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={`w-full rounded-`
- Line 6050: `<option value="" disabled>Select Option</option><option>Yes</option><option>No</option><option>Not Sure</option>`
- Line 6354: `<select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}`
- Line 6356: `<option value="" disabled>-- Select Manager --</option>`
- Line 6400: `<select required value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}`
- Line 6402: `<option value="" disabled>-- Select Manager --</option>`
- Line 6851: `<select`
- Line 6861: `<select`

## src\app\dashboard\receptionist\page.tsx
- Line 43: `import SearchableSelect from "@/components/SearchableSelect";`
- Line 330: `const inputPlaceholder = open ? "Type to search…" : (value ? value : "Select configuration…");`
- Line 365: `<li className={`px-4 py-3 ${t.textFaint}`}>No match — select from list only</li>`
- Line 1318: `alert("Please select an enquiry date.");`
- Line 1334: `setAssignedToError("Please select a Sales Manager before submitting.");`
- Line 1748: `const formSelect = `w-full rounded-lg px-4 py-2.5 text-sm outline-none cursor-pointer border ${t.inputInner} ${t.text} ${t.inputFocus}`;`
- Line 2483: `<select value={configChartMonth} onChange={e => setConfigChartMonth(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none `
- Line 2487: `<select value={chartMode1} onChange={e => setChartMode1(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer`
- Line 2540: `<select value={card4Month} onChange={e => setCard4Month(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none cursor-point`
- Line 2544: `<select value={card4Mode} onChange={e => setCard4Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer b`
- Line 2592: `<select value={card2Mode} onChange={e => setCard2Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer b`
- Line 2606: `<select value={selectedMonthCard} onChange={e => setSelectedMonthCard(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-0.5 outline-n`
- Line 2638: `<select value={card3Month} onChange={e => setCard3Month(Number(e.target.value))} className={`text-[10px] rounded px-1.5 py-1 outline-none cursor-point`
- Line 2642: `<select value={card3Mode} onChange={e => setCard3Mode(e.target.value as any)} className={`text-xs rounded-lg px-2 py-1.5 outline-none cursor-pointer b`
- Line 2748: `{/* /api/walkin_enquiries is a plain SELECT * with no join,`
- Line 3052: `<div><label className={`text-xs mb-1 block ${t.textMuted}`}>Self-use or Investment?</label><select value={salesForm.useType} onChange={e => setSalesFo`
- Line 3053: `<div><label className={`text-xs mb-1 block ${t.textMuted}`}>Planning to Purchase?</label><select value={salesForm.purchaseDate} onChange={e => setSale`
- Line 3057: `<select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><optio`
- Line 3061: `<select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><opt`
- Line 3783: `<select value={enquiryForm.occupation} onChange={e => setEnquiryForm({ ...enquiryForm, occupation: e.target.value })}`
- Line 3785: `<option value="" disabled>Select Occupation</option>`
- Line 3791: `<select value={enquiryForm.loanPlanned} onChange={e => setEnquiryForm({ ...enquiryForm, loanPlanned: e.target.value })}`
- Line 3793: `<option value="" disabled>Select Option</option>`
- Line 3809: `{autoDate ? "Using today's date automatically." : "Select the original enquiry date."}`
- Line 3893: `<select value={enquiryForm.purpose} onChange={e => setEnquiryForm({ ...enquiryForm, purpose: e.target.value })}`
- Line 3907: `<select required value={enquiryForm.source} onChange={e => {`
- Line 3923: `<option value="" disabled>Select Source</option>`
- Line 3967: `: "-- Select Sales Manager --"}`
- Line 4196: `<SearchableSelect`
- Line 4330: `<select required value={transferTarget} onChange={e => setTransferTarget(e.target.value)}`
- Line 4332: `<option value="" disabled>-- Select Sales Manager --</option>`

## src\app\dashboard\RevenueIntelligenceView.tsx
- Line 1090: `<select value={mode} onChange={(e) => setMode(e.target.value)} className={fieldCls}>`

## src\app\dashboard\sales\page.tsx
- Line 232: `// ── Select / form elements ──`
- Line 917: `<select value={barMode} onChange={e => setBarMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer borde`
- Line 949: `<select value={pieMode} onChange={e => setPieMode(e.target.value as any)} className={`rounded-lg px-3 py-1.5 text-xs outline-none cursor-pointer borde`
- Line 1530: `const formSelect = `w-full rounded-lg px-4 py-2 text-sm sm:py-2.5 outline-none cursor-pointer border ${t.inputInner} ${t.text} ${t.inputFocus}`;`
- Line 1580: `{(stat as any).monthSelect && (`
- Line 1581: `<select`
- Line 1622: `<select`
- Line 1768: `<select`
- Line 2127: `<div><label className={`text-xs mb-1 block ${t.textMuted}`}>Self-use or Investment?</label><select value={salesForm.useType} onChange={e => setSalesFo`
- Line 2128: `<div><label className={`text-xs mb-1 block ${t.textMuted}`}>Planning to Purchase?</label><select value={salesForm.purchaseDate} onChange={e => setSale`
- Line 2132: `<select required value={salesForm.leadStatus} onChange={e => setSalesForm({ ...salesForm, leadStatus: e.target.value })} className={formSelect}><optio`
- Line 2136: `<select required value={salesForm.loanPlanned} onChange={e => setSalesForm({ ...salesForm, loanPlanned: e.target.value })} className={formSelect}><opt`

## src\app\dashboard\settings\developer-api\page.tsx
- Line 592: `if (selected.length === 0) next.scopes = "Select at least one scope.";`
- Line 755: `toast("error", "Could not copy automatically. Select the key and copy it manually.");`
- Line 868: `<Select id="rotate-grace" value={grace} onChange={(e) => setGrace(e.target.value)}>`
- Line 1018: `<Select id="test-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}>`

## src\app\dashboard\settings\employees\page.tsx
- Line 300: `<option value="">Select a role…</option>`
- Line 468: `<Select id="disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}>`
- Line 722: `aria-label="Select all employees"`
- Line 744: `aria-label={`Select ${employee.name}`}`

## src\app\dashboard\settings\preferences\page.tsx
- Line 178: `<Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>`

## src\app\dashboard\settings\profile\page.tsx
- Line 700: `<Select id="timezone" value={APP_TIMEZONE} disabled aria-readonly>`

## src\app\dashboard\SiteVisitOverview.tsx
- Line 815: `<select className={selectClass} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>`
- Line 819: `<select className={selectClass} value={filterRole} onChange={e => setFilterRole(e.target.value)}>`
- Line 823: `<select className={selectClass} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>`
- Line 827: `<select className={selectClass} value={filterProject} onChange={e => setFilterProject(e.target.value)}>`
- Line 831: `<select className={selectClass} value={filterLeadStatus} onChange={e => setFilterLeadStatus(e.target.value)}>`

## src\components\AddUnitModal.tsx
- Line 187: `<select value={form.unit_type} onChange={e => set({ unit_type: e.target.value })} className={selectCls}>`
- Line 201: `<select value={form.status} onChange={e => set({ status: e.target.value })} className={selectCls}>`

## src\components\AssignedChannelPartnersView.tsx
- Line 223: `<select value={sortBy} onChange={e => setSortBy(e.target.value as any)}`

## src\components\AttendanceReportButton.tsx
- Line 102: `if (!from || !to) return "Select both dates.";`

## src\components\BookingFormModal.tsx
- Line 772: `// custom_charges comes back from the shared SELECT as a JSON array of`
- Line 1829: `Select Unit`
- Line 1946: `<select value={row.transaction_type} onChange={e => updatePayment(i, "transaction_type", e.target.value)} className={`${inputCls} text-xs py-1.5`}>`
- Line 2347: `<select value={form.ocr_payment_mode} onChange={e => set("ocr_payment_mode", e.target.value)} className={inputCls}>`
- Line 2369: `<select value={form.stamp_duty_status} onChange={e => set("stamp_duty_status", e.target.value)} className={inputCls}>`
- Line 2376: `<select value={form.stamp_duty_payment_mode} onChange={e => set("stamp_duty_payment_mode", e.target.value)} className={inputCls}>`
- Line 2399: `<select value={form.registration_status} onChange={e => set("registration_status", e.target.value)} className={inputCls}>`
- Line 2481: `<select value={form.loan_type} onChange={e => set("loan_type", e.target.value)} className={inputCls}>`
- Line 2514: `<select value={form.sanction_status} onChange={e => set("sanction_status", e.target.value)} className={inputCls}>`
- Line 2522: `<select value={form.loan_status} onChange={e => set("loan_status", e.target.value)} className={inputCls}>`
- Line 2555: `<select value={form.disbursement_status} onChange={e => set("disbursement_status", e.target.value)} className={inputCls}>`
- Line 2598: `<select value={form.payment_type} onChange={e => set("payment_type", e.target.value)} className={inputCls}>`
- Line 2739: `<select value={form.possession_status} onChange={e => set("possession_status", e.target.value)} className={inputCls}>`
- Line 2747: `<select value={form.oc_cc_status} onChange={e => set("oc_cc_status", e.target.value)} className={inputCls}>`

## src\components\BulkGenerateUnitsModal.test.tsx
- Line 145: `const select = screen.getAllByRole("combobox").find(s =>`

## src\components\BulkGenerateUnitsModal.tsx
- Line 516: `<select value={config.default_status} onChange={e => setC({ default_status: e.target.value })} className={selectCls}>`
- Line 579: `<select value={p.unit_type} onChange={e => setPos(p.key, { unit_type: e.target.value })} className={`${cellCls} cursor-pointer`}>`
- Line 640: `<select value={config.numbering_preset} onChange={e => setC({ numbering_preset: e.target.value })} className={selectCls}>`
- Line 647: `<select value={config.ground_floor_mode} onChange={e => setC({ ground_floor_mode: e.target.value })} className={selectCls}>`
- Line 758: `<select value={r.unit_type} onChange={e => updateRow(r.key, { unit_type: e.target.value })} className={`${cellCls} cursor-pointer`}>`
- Line 764: `<select value={r.status} onChange={e => updateRow(r.key, { status: e.target.value })} className={`${cellCls} cursor-pointer`}>`

## src\components\ChannelPartnerEnquiriesTable.tsx
- Line 219: `<select value={smFilter} onChange={e => setSmFilter(e.target.value)}`
- Line 538: `placeholder="Select a Sourcing Manager…"`

## src\components\ChannelPartnerFormModal.tsx
- Line 94: `// Held as a string because SearchableSelect stores opaque option values; it is`
- Line 841: `<select value={form.status} onChange={e => set({ status: e.target.value })} className={selectCls}>`

## src\components\ChannelPartnerListView.tsx
- Line 74: `// is divided up every Sourcing Manager's panel is empty. Multi-select rather`
- Line 307: `<select value={assignedFilter} onChange={e => setAssignedFilter(e.target.value)}`
- Line 317: `<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${inputCls} cursor-pointer`}>`
- Line 397: `aria-label="Select all visible partners"`
- Line 454: `aria-label={`Select ${p.name}`}`
- Line 623: `placeholder="Select a Sourcing Manager…"`

## src\components\Enquiryoverviewsection.tsx
- Line 876: `title="Select multiple leads"`
- Line 900: `<select`
- Line 910: `<select`
- Line 1039: `title="Select every lead on this page"`

## src\components\InventoryAnalyticsModal.tsx
- Line 262: `<select value={projectId} onChange={e => setProjectId(e.target.value)} className={selectCls}>`
- Line 266: `<select value={days} onChange={e => setDays(e.target.value)} className={selectCls}>`

## src\components\InventoryManagementView.tsx
- Line 797: `// ── Multi-select ──`
- Line 898: `<select value={bFilters.project} onChange={e => setBFilters(f => ({ ...f, project: e.target.value }))} className={`${selectCls} w-40`}>`
- Line 902: `<select value={bFilters.tower} onChange={e => setBFilters(f => ({ ...f, tower: e.target.value }))} className={`${selectCls} w-32`}>`
- Line 906: `<select value={bFilters.status} onChange={e => setBFilters(f => ({ ...f, status: e.target.value }))} className={`${selectCls} w-40`}>`
- Line 1135: `<select value={filters.floor} onChange={e => setFilter({ floor: e.target.value })} className={`${selectCls} w-32`}>`
- Line 1141: `<select value={filters.unit_type} onChange={e => setFilter({ unit_type: e.target.value })} className={`${selectCls} w-28`}>`
- Line 1144: `<select value={filters.status} onChange={e => setFilter({ status: e.target.value })} className={`${selectCls} w-32`}>`
- Line 1875: `<select value={scope.tower} onChange={e => setScope(s => ({ ...s, tower: e.target.value }))} className={`${inputCls} cursor-pointer`}>`
- Line 1876: `<option value="">Select a tower…</option>`
- Line 2143: `<select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={`w-full rounded-lg px-2.5 py-1.5 text-xs border cursor-pointer ${t.i`
- Line 2183: `<select value={holdHours} onChange={e => setHoldHours(e.target.value)}`

## src\components\LenderApplicationsTracker.tsx
- Line 134: `const select = async (a: LoanApplication) => {`
- Line 206: `<FaRegStar className="text-[9px]" /> Select this lender`
- Line 232: `<select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))} className={selectCls}>`
- Line 249: `<select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={selectCls}>`

## src\components\LoanDealForm.tsx
- Line 275: `<select value={statusValue} onChange={e => onStatus(e.target.value)} className={selectCls}>`
- Line 874: `<select required value={loanForm.loanRequired} onChange={e => updateLoanForm({ loanRequired: e.target.value })} className={selectCls}>`
- Line 902: `<select value={loanForm.empType} onChange={e => updateLoanForm({ empType: e.target.value })} className={selectCls}>`
- Line 946: `<select value={dealForm.loan_type} onChange={e => updateDealForm({ loan_type: e.target.value })} className={selectCls}>`
- Line 991: `<select required value={loanForm.status} onChange={e => updateLoanForm({ status: e.target.value })} className={selectCls}>`
- Line 992: `<option value="">Select Status</option>`
- Line 1001: `<SectionHeader icon="✅" title="6. Lender Applications" subtitle="File with multiple banks; select the one the buyer proceeds with — its sanction drive`
- Line 1159: `<select value={trancheStatus} onChange={e => setTrancheStatus(e.target.value)} className={selectCls}>`

## src\components\ManualCommissionEntryModal.tsx
- Line 165: `<select value={bookingId} onChange={e => setBookingId(e.target.value)} className={`${inputCls} cursor-pointer`}>`
- Line 167: `{loadingBookings ? "Loading..." : bookings.length === 0 ? "No eligible bookings" : "Select a booking"}`
- Line 224: `{bookingId ? "Enter an amount to preview." : "Select a booking to preview the commission."}`

## src\components\PricingRulesModal.tsx
- Line 212: `<select value={form.project_id} onChange={e => set({ project_id: e.target.value, tower_id: "" })} className={selectCls}>`
- Line 219: `<select value={form.tower_id} onChange={e => set({ tower_id: e.target.value })} className={selectCls} disabled={!form.project_id}>`
- Line 226: `<select value={form.unit_type} onChange={e => set({ unit_type: e.target.value })} className={selectCls}>`

## src\components\ProjectTowerPicker.tsx
- Line 192: `<option value="">Select a project…</option>`
- Line 232: `<option value="">Select a tower…</option>`
- Line 263: `placeholder={towerName.trim() ? "Optional — e.g. B" : "Select a tower first"}`

## src\components\receptionist\ReceptionistSidebar.tsx
- Line 19: `// onSelect / expanded state), so RoleSidebar can choose between them without`

## src\components\sales\SalesSidebar.tsx
- Line 12: `// Same contract as AdminSidebar on purpose (items / activeId / onSelect /`

## src\components\SearchableSelect.tsx
- Line 151: `<li className={`px-4 py-3 ${t.textFaint}`}>No match — select from the list only</li>`

## src\components\Settings\SettingsShell.tsx
- Line 287: `const railSelect = (target: RailTarget) => {`
- Line 313: `* railSelect above uses and that both dashboards already read on mount.`

## src\components\Settings\ui.tsx
- Line 121: `/* Native widgets (date pickers, scrollbars, select popups) render from the UA`

## src\components\Tableui.tsx
- Line 797: `<select`

## src\components\TransferModal.tsx
- Line 203: `<option value="" disabled>— Select new manager —</option>`

## src\components\UnitPicker.tsx
- Line 161: `<FaBuilding className="text-[#00AEEF]" /> Select a Unit`
- Line 184: `<select value={tower} onChange={e => setTower(e.target.value)} className={inputCls}>`
- Line 188: `<select value={unitType} onChange={e => setUnitType(e.target.value)} className={inputCls}>`

## src\components\UploadLeadSheet.tsx
- Line 354: `<option value="">— Select Assignee —</option>`

## src\lib\admin-ai\audit.ts
- Line 26: `*   SELECT status, count(*) FROM ai_audit_logs`
- Line 60: `await query(`
- Line 112: ``SELECT COUNT(*)::int AS used, MIN(created_at) AS oldest`

## src\lib\admin-ai\services.ts
- Line 91: ``SELECT COUNT(*)::int                      AS bookings,`
- Line 130: ``SELECT COALESCE(NULLIF(TRIM(COALESCE(bl.loan_status, b.loan_status)),''),'Unknown') AS status,`
- Line 165: ``SELECT b.primary_name, b.flat_number,`
- Line 194: ``SELECT COALESCE(NULLIF(TRIM(w.assigned_to),''),'Unassigned') AS manager,`
- Line 225: ``SELECT COUNT(*)::int AS total,`
- Line 234: ``SELECT COALESCE(NULLIF(TRIM(source),''),'Unknown') AS source, COUNT(*)::int AS leads`
- Line 249: ``SELECT COALESCE(NULLIF(TRIM(project_name),''),'Unknown') AS project,`
- Line 259: ``SELECT COALESCE(NULLIF(TRIM(status),''),'unknown') AS status, COUNT(*)::int AS units`
- Line 271: ``SELECT b.primary_name, b.flat_number,`
- Line 316: ``SELECT f.id, f.lead_id, f.message, f.created_by_name, f.created_at,`

## src\lib\alternativeEmailVerification.ts
- Line 125: ``SELECT ${PREF_COLUMNS} FROM notification_preferences WHERE user_id = $1 LIMIT 1`,`
- Line 227: ``SELECT 'account'   AS source FROM users`
- Line 230: `SELECT 'alternative' FROM notification_preferences`
- Line 233: `SELECT 'pending'     FROM notification_preferences`
- Line 263: `await query(`
- Line 265: `VALUES ($1, $2, NOW(), $1, (SELECT organization_id FROM users WHERE id = $1))`
- Line 314: `await query(`
- Line 410: `await query(`
- Line 477: `await query(`
- Line 566: `await query(`
- Line 600: `await query(`
- Line 625: `await query(`
- Line 659: `await query(`
- Line 676: `await query(`

## src\lib\apiKeys.ts
- Line 321: ``SELECT id, name, key_prefix, key_hash, scopes, rate_limit_per_min,`
- Line 410: ``SELECT COALESCE(SUM(request_count), 0)::text AS total`
- Line 439: `await query(`
- Line 445: `(SELECT organization_id FROM api_keys WHERE id = $1))`
- Line 455: `await query(`
- Line 466: `await query(`DELETE FROM api_key_usage WHERE bucket_start < NOW() - INTERVAL '90 days'`);`

## src\lib\auditLog.ts
- Line 58: `await query(`
- Line 150: `SELECT 'audit'::text AS source, a.id, a.user_id,`
- Line 163: `SELECT 'activity'::text, e.id, e.user_id, u.name,`
- Line 172: `SELECT 'admin'::text, l.id, l.admin_id, u.name,`
- Line 188: ``SELECT * FROM (${unioned}) feed ${where}`
- Line 195: ``SELECT COUNT(*)::text AS count FROM (${unioned}) feed ${where}`,`

## src\lib\bolnaCalls.ts
- Line 70: `const rows = await query(`
- Line 211: ``SELECT id, lead_id, status FROM bolna_calls WHERE execution_id = $1`,`
- Line 329: ``SELECT id FROM walkin_enquiries`
- Line 342: `const rows = await query(`
- Line 343: ``SELECT * FROM bolna_calls`
- Line 353: `const rows = await query(`SELECT * FROM bolna_calls WHERE execution_id = $1`, [executionId]);`
- Line 369: `await query(`

## src\lib\bolnaSettings.ts
- Line 51: ``SELECT settings, secrets, enabled, last_verified_at, last_verify_error, updated_at`
- Line 364: `await query(`
- Line 392: `await query(`

## src\lib\bookingQuery.ts
- Line 6: `// stamp_duty_amount, …). POST and PUT returned `SELECT * FROM`
- Line 28: `SELECT b.*,`
- Line 62: `(SELECT json_agg(json_build_object('charge_name', cc.charge_name, 'amount', cc.amount, 'remarks', cc.remarks))`
- Line 100: `const rows = await query(`${BOOKING_SELECT_SQL} WHERE b.id = $1 LIMIT 1`, [Number(id)]);`

## src\lib\buildFinancialSnapshot.ts
- Line 135: `(SELECT COALESCE(SUM(cc.amount), 0)`
- Line 141: `(SELECT la.amount_sanctioned`
- Line 147: `(SELECT COALESCE(SUM(t.amount), 0)`
- Line 181: `? (await client.query(SNAPSHOT_SQL, [bookingId])).rows`
- Line 238: ``SELECT id FROM booking_applications`

## src\lib\cpCommissionEngine.ts
- Line 133: `const bookingRes = await client.query(`
- Line 134: ``SELECT id, booking_number, agreement_value, sourced_by_channel_partner_id`
- Line 154: `const existing = await client.query(`
- Line 155: ``SELECT id, status FROM cp_commissions WHERE booking_id = $1 AND status <> 'reversed' ORDER BY id DESC LIMIT 1`,`
- Line 166: `const cpRes = await client.query(`
- Line 167: ``SELECT id, name, status, default_commission_rate FROM channel_partners WHERE id = $1`,`
- Line 187: `? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [overrideGross])`
- Line 188: `: await client.query(`
- Line 189: ``SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,`
- Line 197: `const priorRes = await client.query(`
- Line 198: ``SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior`
- Line 206: `const crossedRes = await client.query(`
- Line 207: ``SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed, ($1::numeric + $2::numeric) AS cumulative`,`
- Line 214: `const tdsRes = await client.query(`
- Line 215: ``SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS tds,`
- Line 254: `const cpRes = await client.query(`
- Line 255: ``SELECT id, name, status, default_commission_rate FROM channel_partners WHERE id = $1`,`
- Line 286: `? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [overrideGross])`
- Line 287: `: await client.query(`
- Line 288: ``SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,`
- Line 295: `const priorRes = await client.query(`
- Line 296: ``SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior`
- Line 304: `const crossedRes = await client.query(`
- Line 305: ``SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed, ($1::numeric + $2::numeric) AS cumulative`,`
- Line 311: `const tdsRes = await client.query(`
- Line 312: ``SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS tds,`
- Line 350: `const inserted = await client.query(`
- Line 451: `const hit = await client.query(`
- Line 452: ``SELECT id FROM channel_partners`
- Line 474: `const created = await client.query(`
- Line 497: `const nameHit = await client.query(`
- Line 498: ``SELECT id FROM channel_partners`
- Line 511: `const created = await client.query(`
- Line 666: `const res = await client.query(`
- Line 667: ``SELECT c.*, b.agreement_value AS booking_agreement_value`
- Line 701: `? await client.query(`SELECT ROUND($1::numeric, 2) AS gross`, [grossAmount])`
- Line 702: `: await client.query(`
- Line 703: ``SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS gross`,`
- Line 711: `const priorRes = await client.query(`
- Line 712: ``SELECT COALESCE(SUM(gross_commission_amount), 0) AS prior`
- Line 720: `const crossedRes = await client.query(`
- Line 721: ``SELECT ($1::numeric + $2::numeric) > $3::numeric AS crossed`,`
- Line 730: `const updated = await client.query(`
- Line 776: `const res = await client.query(`
- Line 777: ``SELECT id, status FROM cp_commissions`
- Line 786: `const anyRow = await client.query(`
- Line 787: ``SELECT id FROM cp_commissions WHERE booking_id = $1 ORDER BY id DESC LIMIT 1`,`
- Line 819: `const updated = await client.query(`

## src\lib\crmUpdates.ts
- Line 54: `SELECT * FROM crm_updates`
- Line 70: `await query(sql, [userId, updateId]);`
- Line 79: `SELECT`

## src\lib\db.ts
- Line 26: `const result = await client.query(text, params);`
- Line 38: `await client.query("BEGIN");`
- Line 40: `await client.query("COMMIT");`
- Line 43: `await client.query("ROLLBACK");`
- Line 59: `"SELECT lead_number_sorting_enabled FROM organization_settings WHERE organization_id = $1";`
- Line 61: `? await client.query(SETTING_SQL, [organizationId])`
- Line 63: `const r = await c.query(SETTING_SQL, [organizationId]);`
- Line 85: `SELECT id,`
- Line 97: `await client.query(queryText);`
- Line 99: `await query(queryText);`
- Line 106: `await query("SELECT 1");`

## src\lib\emailRouting.ts
- Line 282: ``SELECT u.id AS user_id,`
- Line 437: `await query(`
- Line 690: ``SELECT id FROM known_login_devices WHERE user_id = $1 AND device_hash = $2 LIMIT 1`,`
- Line 695: ``SELECT COUNT(*)::text AS count FROM known_login_devices WHERE user_id = $1`,`
- Line 700: `await query(`
- Line 704: `SELECT $1, $2, $3, $4, u.organization_id FROM users u WHERE u.id = $1`

## src\lib\ingestion\bulkInsertLeads.ts
- Line 64: `const insertRes = await client.query(`
- Line 135: `await client.query(`

## src\lib\inventoryDelete.ts
- Line 58: `await client.query(`
- Line 62: `await client.query(`
- Line 65: `(SELECT organization_id FROM inventory_units WHERE id = $1))`,`

## src\lib\inventoryHierarchy.ts
- Line 51: `const foundProject = await client.query(`
- Line 52: ``SELECT id FROM inventory_projects`
- Line 60: `// ON CONFLICT DO NOTHING + re-select rather than a bare INSERT: two units in`
- Line 64: `const ins = await client.query(`
- Line 74: `const again = await client.query(`
- Line 75: ``SELECT id FROM inventory_projects`
- Line 87: `const foundTower = await client.query(`
- Line 88: ``SELECT id FROM inventory_towers`
- Line 96: `const ins = await client.query(`
- Line 101: `(SELECT organization_id FROM inventory_projects WHERE id = $1))`
- Line 109: `const again = await client.query(`
- Line 110: ``SELECT id FROM inventory_towers`

## src\lib\inventorySync.ts
- Line 80: `const existing = await client.query(`
- Line 81: ``SELECT id, status, booking_id FROM inventory_units`
- Line 104: `const held = await client.query(`
- Line 105: ``SELECT booking_id FROM inventory_units WHERE id = $1 FOR UPDATE`,`
- Line 121: `await client.query(`
- Line 142: `const ins = await client.query(`
- Line 160: `await client.query(`
- Line 181: `const linked = await client.query(`
- Line 182: ``SELECT id, status FROM inventory_units WHERE booking_id = $1 AND deleted_at IS NULL`,`
- Line 187: `await client.query(`
- Line 195: `await client.query(`

## src\lib\leadDeletion.ts
- Line 94: `const result = await client.query(`
- Line 96: `SELECT column_name`
- Line 167: `const result = await client.query(`
- Line 169: `SELECT ${existingKeyColumns.map(quoteIdent).join(", ")}`
- Line 204: `const result = await client.query(`
- Line 206: `SELECT ${candidateColumns.map(quoteIdent).join(", ")}`
- Line 335: `const result = await client.query(`
- Line 347: `const result = await client.query(`
- Line 359: `const leadDeleteResult = await client.query(`
- Line 373: `await client.query(``
- Line 406: `await client.query(`
- Line 436: `await client.query(`

## src\lib\loginNotification.ts
- Line 75: ``SELECT workspace_name FROM organization_settings WHERE organization_id = $1 LIMIT 1`,`
- Line 100: ``SELECT timezone FROM users WHERE id = $1 LIMIT 1`,`
- Line 236: ``SELECT first_seen_at FROM known_login_devices`

## src\lib\loginSecurity.ts
- Line 62: `await query(`
- Line 74: ``SELECT created_at, ip_address, user_agent, alerted_at`
- Line 89: `await query(`
- Line 102: `await query(`
- Line 126: `await query(`DELETE FROM failed_login_attempts WHERE identifier = $1`, [`
- Line 221: ``SELECT id, device_label, confirm_token_hash, confirm_expires_at`
- Line 241: `await query(`
- Line 248: `await query(`

## src\lib\manualCallingSettings.ts
- Line 46: `* settings form offers only these, because an admin who can select "Knowlarity"`
- Line 92: ``SELECT settings, secrets, enabled, last_verified_at, last_verify_error, updated_at`
- Line 250: `await query(`
- Line 276: `await query(`

## src\lib\notificationPreferenceService.ts
- Line 109: ``SELECT notification_key, enabled`
- Line 237: `return `($1, $${values.length - 1}, $${values.length}, (SELECT organization_id FROM users WHERE id = $1))`;`
- Line 240: `await query(`
- Line 267: `await query(`DELETE FROM notification_type_preferences WHERE user_id = $1`, [userId]);`

## src\lib\pdd.ts
- Line 32: ``SELECT COUNT(*)::int AS count FROM loan_pdd_tracking WHERE booking_id = $1`,`
- Line 41: `await query(`
- Line 46: `(SELECT organization_id FROM booking_applications WHERE id = $1))`,`
- Line 58: ``SELECT id FROM booking_applications WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1`,`

## src\lib\revenueDigest.ts
- Line 61: ``SELECT to_char(fl.transaction_date, 'YYYY-MM') AS month,`
- Line 77: ``SELECT to_char(t.receiving_date, 'YYYY-MM') AS month,`
- Line 91: ``SELECT`
- Line 103: ``SELECT COALESCE(cp.name, 'Unattributed')                                                        AS partner,`

## src\lib\settingsUser.ts
- Line 3: `// Keeping the SELECT list, the defaults and the name-splitting in one place so`
- Line 187: ``SELECT ${SETTINGS_USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,`

## src\lib\sourcingAssignment.ts
- Line 51: ``SELECT id FROM users`
- Line 57: `const res = await client.query(sql, [id]);`
- Line 60: `const rows = await query(sql, [id]);`
- Line 66: `const sql = `SELECT COUNT(*)::int AS c FROM users WHERE is_active = true AND ${SOURCING_MANAGER_ROLE_PREDICATE}`;`
- Line 68: `const res = await client.query(sql);`
- Line 93: `const res = await client.query(`
- Line 94: ``SELECT sm.id, sm.name`
- Line 122: `const res = await client.query(`
- Line 134: `const existing = await client.query(`
- Line 135: ``SELECT assigned_sourcing_manager_id FROM channel_partners WHERE id = $1`,`

## src\lib\tenantContext.ts
- Line 74: `const sql = `SELECT id FROM public.organizations ORDER BY created_at LIMIT 2`;`
- Line 76: `? (await client.query(sql)).rows`
- Line 77: `: (await getPool().query(sql)).rows;`

## src\lib\tenantGuard.ts
- Line 62: `const { rows } = await client.query(`
- Line 63: ``SELECT organization_id FROM public.${table} WHERE ${idColumn} = $1`,`

## src\lib\theme.ts
- Line 102: `* date pickers, select popups) follow along. Those render from the UA`

## src\services\whatsapp.service.ts
- Line 119: ``SELECT id, name, whatsapp_number`
- Line 183: `COALESCE((SELECT u.organization_id FROM users u WHERE u.id = $3), $14)`
- Line 486: `const res = await client.query(`
- Line 490: `SELECT id FROM notification_logs`
- Line 530: `await query(`
- Line 553: `await query(`
- Line 590: `await query(`
- Line 672: `const res = await client.query(`
- Line 674: `SELECT id FROM notification_logs`
- Line 838: `const rows = await query(`
- Line 839: ``SELECT n.id, n.channel, n.type, n.template_name,`
- Line 857: ``SELECT COUNT(*)::int AS c FROM notification_logs n ${joins} ${whereSql}`,`
- Line 901: ``SELECT status, COUNT(*)::int AS c FROM notification_logs GROUP BY status``
- Line 906: ``SELECT COUNT(*)::int AS c FROM notification_logs`
- Line 913: ``SELECT COUNT(*)::int AS c FROM notification_logs WHERE status = 'sending'``
- Line 927: ``SELECT id, name FROM users`
- Line 1028: `await query(`

## src\test\setup.ts
- Line 30: `HTMLInputElement.prototype.select = function select() {`

## src\webhooks\bolna.webhook.ts
- Line 189: `// INSERT ... SELECT rather than VALUES, deliberately: if the lead has since`
- Line 190: `// been deleted the SELECT yields no row and nothing is written, instead of`
- Line 192: `await query(`
- Line 198: `SELECT NULL, 'voice_call_completed', 'bolna', w.id::text, NULL, $2, $3, w.organization_id`
- Line 203: `await query(`
- Line 205: `SELECT $1, $2, 'Bolna AI Agent', 'voice_call', 'system', w.organization_id`


Total files: 201
Total queries: 1162
