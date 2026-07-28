// lib/ingestion/bulkInsertLeads.ts
// Inserts a batch of parsed leads inside a single transaction, then recalculates
// Sr. Nos ONCE at the end. Duplicate external_ref rows are skipped, not aborted.
import { transaction, recalculateSrNos } from "@/lib/db";
import { isChannelPartnerSource, resolveChannelPartnerId } from "@/lib/cpCommissionEngine";
import type { ParsedLead } from "./parseLeadSheet";

export interface BulkInsertParams {
  rows: ParsedLead[];
  assignedTo: string;
  overseeingSiteHead: string | null;
  uploadedByName: string;
}

export interface SkippedRow {
  row: number; // 1-indexed position within the valid-rows batch
  reason: string;
}

export interface BulkInsertResult {
  inserted: number;
  skipped: SkippedRow[];
}

// Actual VARCHAR limits on walkin_enquiries — clamp every string we insert so a
// single over-length value can never abort the whole batch transaction.
const clamp = (val: string | null, max: number): string | null =>
  val == null ? null : val.length > max ? val.slice(0, max) : val;

export async function bulkInsertLeads(
  params: BulkInsertParams
): Promise<BulkInsertResult> {
  const { rows, assignedTo, overseeingSiteHead, uploadedByName } = params;

  return transaction(async (client) => {
    let inserted = 0;
    const skipped: SkippedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowSource = clamp(row.source || "Direct Walk-in", 100);

      // CP-sourced sheet rows now carry the partner's phone (parseLeadSheet rejects
      // them otherwise), so this resolves via the high-confidence phone branch
      // rather than falling back to name matching. Runs inside the batch
      // transaction, which is what lets repeat partners within one sheet collapse
      // onto a single row. Non-CP sources are skipped: their cp_name holds
      // sub-source labels ("Hoarding", "Social Media"), not partners.
      const channelPartnerId = isChannelPartnerSource(rowSource)
        ? await resolveChannelPartnerId(
            client,
            { cp_name: row.cp_name, cp_company: null, cp_phone: row.cp_phone, source: rowSource },
            uploadedByName
          )
        : null;

      const insertRes = await client.query(
        `INSERT INTO walkin_enquiries (
          name, phone, email, address, occupation, organization,
          budget, configuration, purpose, source,
          alt_phone, source_other, referral_name,
          cp_name, cp_company, cp_phone,
          loan_planned, assigned_to, assigned_receptionist, status,
          is_global_shared, overseeing_site_head,
          enquiry_date, auto_date_enabled, external_ref, channel_partner_id
        )
        VALUES (
          $1,  $2,  $3,  $4,  $5,  $6,
          $7,  $8,  $9,  $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19, $20,
          $21, $22,
          $23, $24, $25, $26
        )
        ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
        RETURNING id`,
        [
          clamp(row.name, 150), // $1
          clamp(row.phone, 20), // $2
          "N/A", // $3  email
          "N/A", // $4  address
          "N/A", // $5  occupation
          "N/A", // $6  organization
          clamp(row.budget || "Pending", 100), // $7
          clamp(row.configuration || "N/A", 100), // $8
          "N/A", // $9  purpose
          rowSource, // $10
          clamp(row.alt_phone, 20), // $11 alt_phone
          null, // $12 source_other
          null, // $13 referral_name
          clamp(row.cp_name, 150), // $14
          null, // $15 cp_company
          clamp(row.cp_phone, 20), // $16 cp_phone
          "Pending", // $17 loan_planned
          clamp(assignedTo, 150), // $18
          null, // $19 assigned_receptionist
          "Assigned", // $20 status
          false, // $21 is_global_shared
          clamp(overseeingSiteHead, 150), // $22
          row.enquiry_date, // $23
          false, // $24 auto_date_enabled
          clamp(row.external_ref || null, 100), // $25 external_ref
          channelPartnerId, // $26
        ]
      );

      if (insertRes.rows.length === 0) {
        // ON CONFLICT DO NOTHING => duplicate external_ref, skip this row.
        // (Using ON CONFLICT rather than try/catch is deliberate: a caught error
        //  inside a transaction poisons it, forcing a rollback of the whole batch.)
        skipped.push({
          row: i + 1,
          reason: "duplicate external_ref",
        });
        continue;
      }

      inserted++;
      const leadId = insertRes.rows[0].id;

      // Store any feedback/remarks verbatim as a follow-up note on the new lead.
      const feedback = (row.feedback || "").trim();
      if (feedback) {
        await client.query(
          `INSERT INTO follow_ups (lead_id, message, created_by_name, created_at, followup_date)
           VALUES ($1, $2, $3, $4, NULL)`,
          [leadId, feedback, clamp(uploadedByName, 150), row.enquiry_date]
        );
      }
    }

    // Recalculate gapless Sr. Nos exactly once, after all inserts.
    await recalculateSrNos(client);

    return { inserted, skipped };
  });
}
