import { query } from "@/lib/db";

const cleanStr = (s: any) => (s ? String(s).trim() : "");
const n = (v: any) => {
    if (!v) return 0;
    const s = String(v).replace(/,/g, "");
    const parsed = parseFloat(s);
    return isNaN(parsed) ? 0 : parsed;
};

export async function getRevenueSummary(args?: { month?: string }) {
    // Collect stats from booking_applications, booking_payments, etc.
    // For simplicity, we aggregate from booking_applications directly based on current schema
    let sql = `
        SELECT 
            SUM(agreement_value) as total_agreement_value,
            SUM(own_contribution_received) as total_ocr_received,
            SUM(disbursement_received) as total_disbursement_received
        FROM booking_applications
        WHERE status NOT IN ('Cancelled', 'Dropped')
    `;

    const result = await query<any>(sql);
    if (!result || result.length === 0) return { error: "No revenue data found" };

    const data = result[0];
    const totalAv = n(data.total_agreement_value);
    const totalOcr = n(data.total_ocr_received);
    const totalDisb = n(data.total_disbursement_received);
    const balance = totalAv - (totalOcr + totalDisb);

    return {
        totalAgreementValue: totalAv,
        totalOcrCollected: totalOcr,
        totalDisbursementCollected: totalDisb,
        totalCollected: totalOcr + totalDisb,
        balanceReceivable: balance,
        note: "SDR and other taxes are not included in developer revenue.",
    };
}

export async function getLoanSummary() {
    let sql = `
        SELECT loan_status, SUM(loan_amount_requested) as amount_requested, SUM(loan_amount_approved) as amount_approved
        FROM booking_applications
        WHERE loan_planned = 'Yes' AND status NOT IN ('Cancelled', 'Dropped')
        GROUP BY loan_status
    `;

    const result = await query<any>(sql);
    let applied = 0;
    let sanctioned = 0;
    let pending = 0;
    let rejected = 0;
    let disbursed = 0; // Requires disbursement_tranches, but we'll approximate from booking_applications if not joined

    // Also get disbursed
    const disbSql = `SELECT SUM(disbursement_received) as total_disb FROM booking_applications WHERE loan_planned = 'Yes'`;
    const disbResult = await query<any>(disbSql);
    disbursed = disbResult[0] ? n(disbResult[0].total_disb) : 0;

    for (const row of result) {
        const status = cleanStr(row.loan_status).toLowerCase();
        const req = n(row.amount_requested);
        const app = n(row.amount_approved);
        applied += req;
        if (status === 'approved') sanctioned += app;
        if (status === 'in progress' || status === 'pending') pending += req;
        if (status === 'rejected') rejected += req;
    }

    return {
        totalApplied: applied,
        totalSanctioned: sanctioned,
        totalPending: pending,
        totalRejected: rejected,
        totalDisbursed: disbursed,
        pendingLoanAmount: sanctioned - disbursed
    };
}

export async function getSalesManagerPerformance() {
    const sql = `
        SELECT sales_manager, COUNT(id) as bookings, SUM(agreement_value) as total_revenue
        FROM booking_applications
        WHERE status NOT IN ('Cancelled', 'Dropped')
        GROUP BY sales_manager
        ORDER BY total_revenue DESC
    `;
    const result = await query<any>(sql);
    return result.map(r => ({
        manager: cleanStr(r.sales_manager) || "Unassigned",
        bookingsCount: parseInt(r.bookings, 10),
        totalAgreementValue: n(r.total_revenue)
    }));
}

export async function getRegistrationSummary() {
    const sql = `
        SELECT b.id, b.customer_name, b.flat_no, r.registration_status
        FROM booking_applications b
        LEFT JOIN booking_registration_details r ON b.id = r.booking_id
        WHERE b.status NOT IN ('Cancelled', 'Dropped')
    `;
    const result = await query<any>(sql);
    
    let totalCompleted = 0;
    let totalPending = 0;
    const pendingList: any[] = [];

    for (const r of result) {
        const status = cleanStr(r.registration_status).toLowerCase();
        if (status === 'completed' || status === 'registered') {
            totalCompleted++;
        } else {
            totalPending++;
            pendingList.push({ customer: r.customer_name, flat: r.flat_no, status: r.registration_status || 'Pending' });
        }
    }

    return {
        totalCompleted,
        totalPending,
        pendingRegistrations: pendingList.slice(0, 20), // limit to 20 for prompt size
        note: pendingList.length > 20 ? `+${pendingList.length - 20} more pending registrations not listed.` : ""
    };
}

export async function getInventorySummary() {
    const sql = `
        SELECT prop_type, COUNT(id) as sold_count
        FROM booking_applications
        WHERE status NOT IN ('Cancelled', 'Dropped')
        GROUP BY prop_type
    `;
    const result = await query<any>(sql);
    return result.map(r => ({
        propertyType: cleanStr(r.prop_type) || 'Unknown',
        soldCount: parseInt(r.sold_count, 10)
    }));
}

export const adminServices: Record<string, Function> = {
    getRevenueSummary,
    getLoanSummary,
    getSalesManagerPerformance,
    getRegistrationSummary,
    getInventorySummary
};
