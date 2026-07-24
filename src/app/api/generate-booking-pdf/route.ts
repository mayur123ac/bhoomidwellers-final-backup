import { NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import fs from 'fs/promises';
import path from 'path';
import { generatePresignedUrl } from '@/lib/r2';

/**
 * Fetch an image from Cloudflare R2 by object key and return a base64 data URI.
 * Falls back gracefully to null so the PDF still generates without the image.
 */
async function getBase64FromR2(objectKey: string | null): Promise<string | null> {
  if (!objectKey) return null;
  // Skip keys that look like local paths (legacy data)
  if (objectKey.startsWith('data:')) return objectKey;
  try {
    const url = await generatePresignedUrl(objectKey, 60);
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (contentType.includes('pdf')) return null;
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpeg') || 'jpeg';
    return `data:image/${ext};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────
// Kept small and safe so nothing in the template ever throws on missing values.
const safeVal = (v: any, fallback = '—') => {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
};

const parseVal = (val: any) => {
  if (!val) return 0;
  let str = String(val).toLowerCase().replace(/[₹\s,]/g, '');
  if (str.includes('lakh')) return (parseFloat(str) || 0) * 100000;
  if (str.includes('cr')) return (parseFloat(str) || 0) * 10000000;
  return parseFloat(str) || 0;
};

const formatINR = (v: any, showDash = true) => {
  const n = parseVal(v);
  if (!n && showDash) return '—';
  return `₹ ${n.toLocaleString('en-IN')}`;
};

const formatDate = (v: any) => {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return String(v);
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking, lead } = body;

    if (!booking) {
      return NextResponse.json({ success: false, message: 'Missing booking data' }, { status: 400 });
    }

    // ── Joint applicants ────────────────────────────────────────────────────
    let jointApplicants: any[] = [];
    if (booking.joint_applicants) {
      try {
        jointApplicants = typeof booking.joint_applicants === 'string'
          ? JSON.parse(booking.joint_applicants)
          : booking.joint_applicants;
      } catch (e) { }
    }
    if (jointApplicants.length === 0 && booking.joint_name) {
      jointApplicants = [{
        name: booking.joint_name, email: booking.joint_email, mobile: booking.joint_mobile,
        pan: booking.joint_pan, aadhaar: booking.joint_aadhaar,
        occupation: booking.joint_occupation, nationality: booking.joint_nationality,
      }];
    }

    // ── Images from R2 ──────────────────────────────────────────────────────
    const primaryPanBase64 = await getBase64FromR2(booking.primary_pan_url);
    const primaryAadhaarBase64 = await getBase64FromR2(booking.primary_aadhaar_front_url);
    const signatureBase64 = await getBase64FromR2(booking.signature_data);

    // ── Logo from local public directory ────────────────────────────────────
    let logoBase64 = null;
    try {
      const logoPath = path.join(process.cwd(), 'public', 'assets', 'bhoomidwellersLogo.png');
      const logoData = await fs.readFile(logoPath);
      logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;
    } catch (e) { }

    // ── Payment rows ────────────────────────────────────────────────────────
    let paymentRowsHtml = '';
    let totalReceived = 0;
    let paymentDetailsArr: any[] = [];
    try {
      paymentDetailsArr = typeof booking.payment_details === 'string'
        ? JSON.parse(booking.payment_details)
        : (booking.payment_details || []);
    } catch (e) { }

    if (paymentDetailsArr.length > 0) {
      paymentDetailsArr.forEach((p: any, idx: number) => {
        const amt = parseVal(p.amount);
        totalReceived += amt;
        paymentRowsHtml += `
          <tr>
            <td>${idx + 1}</td>
            <td>${p.date ? formatDate(p.date) : '-'}</td>
            <td>${p.transaction_type || p.mode || '-'}</td>
            <td style="text-align:right;">${amt.toLocaleString('en-IN')}</td>
          </tr>
        `;
      });
    } else {
      paymentRowsHtml = `<tr><td colspan="4" style="text-align: center; color:#999;">No payments recorded</td></tr>`;
    }

    // Balance receivable calc — based on agreement value if present, else consideration.
    const consideration = parseVal(booking.agreement_value || booking.consideration_value);
    const balanceReceivable = Math.max(0, consideration - totalReceived);

    // ── Joint Applicants HTML ───────────────────────────────────────────────
    let jointApplicantsHtml = '';
    for (let i = 0; i < jointApplicants.length; i++) {
      const ja = jointApplicants[i];
      const jaPanBase64 = await getBase64FromR2(ja.pan_url);
      const jaAadhaarBase64 = await getBase64FromR2(ja.aadhaar_front_url);

      jointApplicantsHtml += `
      <div class="section-title">2.${i + 1} JOINT APPLICANT DETAILS - ${i + 1}</div>
      <div class="grid-container applicant-container">
        <div class="details-grid">
          <div class="field-row"><div class="field-label">Full Name</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.name, '')}</div></div>
          <div class="field-row"><div class="field-label">Email ID</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.email, '')}</div></div>
          <div class="field-row"><div class="field-label">Mobile Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.mobile, '')}</div></div>
          <div class="field-row"><div class="field-label">PAN Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.pan, '')}</div></div>
          <div class="field-row"><div class="field-label">Aadhaar Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.aadhaar, '')}</div></div>
          <div class="field-row"><div class="field-label">Occupation</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.occupation, '')}</div></div>
          <div class="field-row"><div class="field-label">Nationality</div><div class="field-colon">:</div><div class="field-val">${safeVal(ja.nationality, '')}</div></div>
        </div>
        <div class="docs-column">
          <div class="doc-box">
            <div class="doc-title">PAN Card</div>
            ${jaPanBase64 ? `<img src="${jaPanBase64}" class="doc-img"/>` : `<div class="doc-placeholder">No Image Available</div>`}
          </div>
          <div class="doc-box">
            <div class="doc-title">Aadhaar Card</div>
            ${jaAadhaarBase64 ? `<img src="${jaAadhaarBase64}" class="doc-img"/>` : `<div class="doc-placeholder">No Image Available</div>`}
          </div>
        </div>
      </div>
      `;
    }

    // ── Section flags — sections render only if there's meaningful data ─────
    const loanRequired = booking.loan_required === true || String(booking.loan_required).toLowerCase() === 'true';
    const hasRegistration = booking.expected_registration_date || booking.actual_registration_date || booking.registration_number || booking.registration_status;
    const isCancelled = String(booking.booking_status || '').toLowerCase() === 'cancelled' || booking.cancelled_at;

    // ── Section numbering — track dynamically so removing a section doesn't leave gaps ─
    let sectionNo = 3; // 1 = primary, 2.x = joint, 3 = unit
    const unitSectionNo = sectionNo++;
    const financialSectionNo = sectionNo++;
    const loanSectionNo = loanRequired ? sectionNo++ : null;
    const registrationSectionNo = hasRegistration ? sectionNo++ : null;
    const paymentSectionNo = sectionNo++;
    const cancellationSectionNo = isCancelled ? sectionNo++ : null;
    const declarationSectionNo = sectionNo++;
    const signatureSectionNo = sectionNo++;

    // ── Unit / Property section ─────────────────────────────────────────────
    // Show every unit identity field the booking has, in a fixed order.
    // Falls back gracefully to '—' so blank fields don't create weird empty rows.
    const projectLine = [booking.project_name, booking.apartment_name].filter(Boolean).join(' — ') || '—';
    const towerWingLine = [
      booking.tower ? `Tower ${booking.tower}` : null,
      booking.wing ? `Wing ${booking.wing}` : null,
    ].filter(Boolean).join(' · ') || '—';

    const unitSectionHtml = `
      <div class="section-title">${unitSectionNo}. UNIT / PROPERTY DETAILS</div>
      <div class="grid-container property-grid">
        <div class="field-row"><div class="field-label">Project</div><div class="field-colon">:</div><div class="field-val">${projectLine}</div></div>
        <div class="field-row"><div class="field-label">Tower / Wing</div><div class="field-colon">:</div><div class="field-val">${towerWingLine}</div></div>
        <div class="field-row"><div class="field-label">Flat No.</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.flat_number || booking.flat_no)}</div></div>
        <div class="field-row"><div class="field-label">Floor</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.floor_number || booking.floor)}</div></div>
        <div class="field-row"><div class="field-label">Unit Type</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.unit_type || booking.property_type)}</div></div>
        <div class="field-row"><div class="field-label">Facing</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.facing)}</div></div>
        <div class="field-row"><div class="field-label">Carpet Area</div><div class="field-colon">:</div><div class="field-val">${booking.carpet_area || booking.carpet_area_sqft ? `${booking.carpet_area || booking.carpet_area_sqft} sq.ft` : '—'}</div></div>
        <div class="field-row"><div class="field-label">Built-up Area</div><div class="field-colon">:</div><div class="field-val">${booking.built_up_area_sqft ? `${booking.built_up_area_sqft} sq.ft` : '—'}</div></div>
        <div class="field-row"><div class="field-label">Rate / sq.ft</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.rate_per_sqft)}</div></div>
        <div class="field-row"><div class="field-label">Base Price</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.base_price)}</div></div>
        <div class="field-row"><div class="field-label">Consideration Value</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.consideration_value)}</div></div>
        <div class="field-row"><div class="field-label">Parking Details</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.parking_details, 'N/A')}</div></div>
        <div class="field-row" style="grid-column: 1 / -1;"><div class="field-label">In Words</div><div class="field-colon">:</div><div class="field-val" style="font-style: italic;">${safeVal(booking.consideration_value_words, '')}</div></div>
      </div>
    `;

    // ── Financial breakdown section ─────────────────────────────────────────
    // Contract-level financial commitments (charges, deposits) as opposed to
    // payments actually received (which stay in the Payment History section below).
    const financialSectionHtml = `
      <div class="section-title">${financialSectionNo}. FINANCIAL BREAKDOWN</div>
      <div class="grid-container property-grid">
        <div class="field-row"><div class="field-label">Agreement Value</div><div class="field-colon">:</div><div class="field-val"><strong>${formatINR(booking.agreement_value)}</strong></div></div>
        <div class="field-row"><div class="field-label">Booking Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.booking_amount)}</div></div>
        <div class="field-row"><div class="field-label">Token Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.token_amount)}</div></div>
        <div class="field-row"><div class="field-label">GST Rate</div><div class="field-colon">:</div><div class="field-val">${booking.gst_rate ? `${booking.gst_rate}%` : '—'}</div></div>
        <div class="field-row"><div class="field-label">Stamp Duty</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.stamp_duty_amount)}${booking.stamp_duty_status ? ` <span style="color:#666;">(${booking.stamp_duty_status})</span>` : ''}</div></div>
        <div class="field-row"><div class="field-label">Registration Fee</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.registration_fee_amount)}${booking.registration_fee_status ? ` <span style="color:#666;">(${booking.registration_fee_status})</span>` : ''}</div></div>
        <div class="field-row"><div class="field-label">Legal Charges</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.legal_charges)}</div></div>
        <div class="field-row"><div class="field-label">Maintenance Deposit</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.maintenance_deposit)}</div></div>
        <div class="field-row"><div class="field-label">Cash Component</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.cash_component)}</div></div>
      </div>
    `;

    // ── Loan section (conditional) ──────────────────────────────────────────
    // Only rendered when the customer opted for a loan. All sub-groups shown
    // even if empty so absent values are visibly '—' rather than misleading blanks.
    const loanSectionHtml = loanRequired ? `
      <div class="section-title">${loanSectionNo}. LOAN DETAILS</div>
      <div class="grid-container">
        <div class="subsection-title">Bank &amp; Application</div>
        <div class="property-grid" style="margin-bottom:12px;">
          <div class="field-row"><div class="field-label">Bank Name</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.bank_name)}</div></div>
          <div class="field-row"><div class="field-label">Loan Type</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.loan_type)}</div></div>
          <div class="field-row"><div class="field-label">Loan Executive</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.loan_executive)}</div></div>
          <div class="field-row"><div class="field-label">Reference No.</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.loan_reference_no)}</div></div>
          <div class="field-row"><div class="field-label">Loan Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.loan_amount)}</div></div>
          <div class="field-row"><div class="field-label">Overall Status</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.loan_status)}</div></div>
        </div>
        <div class="subsection-title">Sanction</div>
        <div class="property-grid" style="margin-bottom:12px;">
          <div class="field-row"><div class="field-label">Sanction Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.sanction_amount)}</div></div>
          <div class="field-row"><div class="field-label">Sanction Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.sanction_date)}</div></div>
          <div class="field-row"><div class="field-label">Sanction Status</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.sanction_status)}</div></div>
          <div class="field-row"><div class="field-label">Interest Rate</div><div class="field-colon">:</div><div class="field-val">${booking.interest_rate ? `${booking.interest_rate}%` : '—'}</div></div>
          <div class="field-row"><div class="field-label">Tenure</div><div class="field-colon">:</div><div class="field-val">${booking.loan_tenure_months ? `${booking.loan_tenure_months} months` : '—'}</div></div>
        </div>
        <div class="subsection-title">Disbursement</div>
        <div class="property-grid" style="margin-bottom:12px;">
          <div class="field-row"><div class="field-label">Expected Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.expected_disbursement_date)}</div></div>
          <div class="field-row"><div class="field-label">Expected Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.expected_disbursement_amount)}</div></div>
          <div class="field-row"><div class="field-label">Actual Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.actual_disbursement_date)}</div></div>
          <div class="field-row"><div class="field-label">Amount Disbursed</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.disbursement_amount)}</div></div>
          <div class="field-row"><div class="field-label">Disbursement Status</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.disbursement_status)}</div></div>
        </div>
        <div class="subsection-title">EMI</div>
        <div class="property-grid">
          <div class="field-row"><div class="field-label">Payment Type</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.payment_type)}</div></div>
          <div class="field-row"><div class="field-label">EMI Start Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.emi_start_date)}</div></div>
          <div class="field-row"><div class="field-label">Pre-EMI Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.pre_emi_amount)}</div></div>
          <div class="field-row"><div class="field-label">Full EMI Amount</div><div class="field-colon">:</div><div class="field-val">${formatINR(booking.emi_amount)}</div></div>
        </div>
      </div>
    ` : '';

    // ── Registration section (conditional) ──────────────────────────────────
    const registrationSectionHtml = hasRegistration ? `
      <div class="section-title">${registrationSectionNo}. REGISTRATION DETAILS</div>
      <div class="grid-container property-grid">
        <div class="field-row"><div class="field-label">Registration No.</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.registration_number)}</div></div>
        <div class="field-row"><div class="field-label">Status</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.registration_status, 'Pending')}</div></div>
        <div class="field-row"><div class="field-label">Expected Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.expected_registration_date)}</div></div>
        <div class="field-row"><div class="field-label">Actual Date</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.actual_registration_date)}</div></div>
        ${booking.registration_remarks ? `<div class="field-row" style="grid-column: 1 / -1;"><div class="field-label">Remarks</div><div class="field-colon">:</div><div class="field-val">${booking.registration_remarks}</div></div>` : ''}
      </div>
    ` : '';

    // ── Cancellation section (conditional) ──────────────────────────────────
    // Shown only if the booking is Cancelled. Uses red accents so a cancelled
    // booking's PDF can never be mistaken for an active one at a glance.
    const cancellationSectionHtml = isCancelled ? `
      <div class="section-title" style="color:#c53030;">${cancellationSectionNo}. CANCELLATION DETAILS</div>
      <div class="grid-container" style="border-color:#feb2b2; background:#fff5f5;">
        <div class="property-grid">
          <div class="field-row"><div class="field-label">Reason</div><div class="field-colon">:</div><div class="field-val"><strong>${safeVal(booking.cancellation_reason)}</strong></div></div>
          <div class="field-row"><div class="field-label">Cancelled On</div><div class="field-colon">:</div><div class="field-val">${formatDate(booking.cancelled_at)}</div></div>
          <div class="field-row"><div class="field-label">Cancelled By</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.cancelled_by)}</div></div>
        </div>
        ${booking.cancellation_remarks ? `<div style="margin-top:10px; padding-top:10px; border-top:1px solid #feb2b2;"><span class="field-label">Remarks:</span> ${booking.cancellation_remarks}</div>` : ''}
      </div>
    ` : '';

    // ── HTML Document ───────────────────────────────────────────────────────
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Booking Application Form</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

        body {
          font-family: 'Inter', sans-serif;
          margin: 0;
          padding: 20px 40px;
          color: #333;
          font-size: 11px;
          background-color: white;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #9E217B;
          padding-bottom: 10px;
          margin-bottom: 20px;
        }

        .header-logo { height: 50px; object-fit: contain; }

        .header-title {
          font-size: 18px;
          font-weight: 700;
          color: #9E217B;
          text-align: center;
          flex-grow: 1;
        }

        .header-info { text-align: right; font-size: 10px; line-height: 1.4; }
        .header-info strong { color: #555; }

        .info-bar {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
          font-size: 11px;
          padding: 8px 12px;
          background: #fdf4fa;
          border-radius: 4px;
          border-left: 3px solid #9E217B;
        }

        .section-title {
          color: #9E217B;
          font-weight: 700;
          font-size: 12px;
          margin-top: 15px;
          margin-bottom: 10px;
          text-transform: uppercase;
          page-break-after: avoid;
        }

        .subsection-title {
          color: #555;
          font-weight: 600;
          font-size: 11px;
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px dashed #e5e7eb;
          text-transform: uppercase;
        }

        .grid-container {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 15px;
          margin-bottom: 15px;
          page-break-inside: avoid;
        }

        .applicant-container { display: flex; gap: 20px; }

        .details-grid {
          flex: 2;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-row { display: flex; }
        .field-label { width: 140px; font-weight: 600; color: #555; }
        .field-colon { width: 20px; }
        .field-val { flex: 1; }

        .docs-column {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .doc-box {
          border: 1px solid #eee;
          padding: 8px;
          border-radius: 4px;
          text-align: center;
        }

        .doc-title { font-size: 10px; font-weight: 600; margin-bottom: 5px; }

        .doc-img {
          width: 100%;
          max-height: 120px;
          object-fit: contain;
          border-radius: 4px;
        }

        .doc-placeholder {
          height: 100px;
          background: #f9fafb;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
          font-size: 10px;
          border: 1px dashed #d1d5db;
        }

        .address-row {
          display: flex;
          gap: 20px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #eee;
        }

        .property-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
          font-size: 10px;
        }

        th, td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: left;
        }

        th {
          background-color: #f8fafc;
          font-weight: 600;
          color: #555;
        }

        .declaration-text {
          font-size: 10px;
          line-height: 1.5;
          margin-bottom: 10px;
        }

        .checkbox-row {
          display: flex;
          gap: 20px;
          font-size: 10px;
          font-weight: 600;
        }

        .signature-box {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 15px;
          margin-top: 20px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          page-break-inside: avoid;
        }

        .sign-area { text-align: center; }

        .sign-line {
          width: 200px;
          border-bottom: 1px solid #000;
          margin-bottom: 5px;
          height: 60px;
        }

        .status-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 600;
        }
        .status-approved { background: #dcfce7; color: #166534; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-cancelled { background: #fee2e2; color: #991b1b; }
      </style>
    </head>
    <body>

      <div class="header">
        <div>
          ${logoBase64 ? `<img src="${logoBase64}" class="header-logo" />` : `<h2 style="color:#9E217B; margin:0;">Bhoomi CRM</h2>`}
        </div>
        <div class="header-title">BOOKING APPLICATION FORM</div>
        <div class="header-info">
          <div><strong>Booking No:</strong> ${booking.booking_number || 'N/A'}</div>
          <div><strong>Lead No:</strong> #${booking.lead_id || 'N/A'}</div>
        </div>
      </div>

      <div class="info-bar">
        <div><strong>Date of Application:</strong> ${formatDate(booking.application_date || new Date())}</div>
        <div><strong>Sales Manager:</strong> ${safeVal(booking.lead_assigned_to || lead?.assigned_to, 'N/A')}</div>
        <div><strong>Status:</strong> <span class="status-pill ${isCancelled ? 'status-cancelled' : (String(booking.booking_status).toLowerCase() === 'approved' ? 'status-approved' : 'status-pending')}">${booking.booking_status || 'Pending'}</span></div>
      </div>

      <!-- PRIMARY APPLICANT -->
      <div class="section-title">1. PRIMARY APPLICANT DETAILS</div>
      <div class="grid-container">
        <div class="applicant-container">
          <div class="details-grid">
            <div class="field-row"><div class="field-label">Full Name</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_name, '')}</div></div>
            <div class="field-row"><div class="field-label">Email ID</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_email, '')}</div></div>
            <div class="field-row"><div class="field-label">Mobile Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_mobile, '')}</div></div>
            <div class="field-row"><div class="field-label">PAN Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_pan, '')}</div></div>
            <div class="field-row"><div class="field-label">Aadhaar Number</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_aadhaar, '')}</div></div>
            <div class="field-row"><div class="field-label">Occupation</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_occupation, '')}</div></div>
            <div class="field-row"><div class="field-label">Nationality</div><div class="field-colon">:</div><div class="field-val">${safeVal(booking.primary_nationality, '')}</div></div>
          </div>
          <div class="docs-column">
            <div class="doc-box">
              <div class="doc-title">PAN Card</div>
              ${primaryPanBase64 ? `<img src="${primaryPanBase64}" class="doc-img"/>` : `<div class="doc-placeholder">No Image Available</div>`}
            </div>
            <div class="doc-box">
              <div class="doc-title">Aadhaar Card</div>
              ${primaryAadhaarBase64 ? `<img src="${primaryAadhaarBase64}" class="doc-img"/>` : `<div class="doc-placeholder">No Image Available</div>`}
            </div>
          </div>
        </div>
        <div class="address-row">
          <div class="field-label">Address:</div>
          <div class="field-val">${safeVal(booking.address, '')}</div>
        </div>
        <div class="address-row" style="border:none; margin-top:5px; padding-top:0;">
          <div style="flex:1"><span class="field-label" style="width:auto">Pin:</span> ${safeVal(booking.pin, '')}</div>
          <div style="flex:1"><span class="field-label" style="width:auto">State:</span> ${safeVal(booking.state, '')}</div>
          <div style="flex:1"><span class="field-label" style="width:auto">Country:</span> ${safeVal(booking.country, '')}</div>
        </div>
      </div>

      <!-- JOINT APPLICANTS -->
      ${jointApplicantsHtml}

      <!-- UNIT / PROPERTY -->
      ${unitSectionHtml}

      <!-- FINANCIAL BREAKDOWN -->
      ${financialSectionHtml}

      <!-- LOAN DETAILS (conditional) -->
      ${loanSectionHtml}

      <!-- REGISTRATION (conditional) -->
      ${registrationSectionHtml}

      <!-- PAYMENT HISTORY -->
      <div class="section-title">${paymentSectionNo}. PAYMENT HISTORY</div>
      <table>
        <thead>
          <tr>
            <th width="10%">Sr. No.</th>
            <th width="20%">Date</th>
            <th width="50%">Transaction Detail</th>
            <th width="20%" style="text-align:right;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRowsHtml}
          <tr>
            <td colspan="3" style="text-align: right; font-weight: bold; background:#f8fafc;">Total Received</td>
            <td style="font-weight: bold; text-align:right; background:#f8fafc;">${totalReceived.toLocaleString('en-IN')}</td>
          </tr>
          ${consideration > 0 ? `
          <tr>
            <td colspan="3" style="text-align: right; font-weight: bold; background:#f8fafc;">Balance Receivable</td>
            <td style="font-weight: bold; text-align:right; background:#f8fafc; color:${balanceReceivable > 0 ? '#c53030' : '#166534'};">${balanceReceivable.toLocaleString('en-IN')}</td>
          </tr>
          ` : ''}
        </tbody>
      </table>

      <!-- CANCELLATION (conditional) -->
      ${cancellationSectionHtml}

      <!-- DECLARATION -->
      <div class="section-title">${declarationSectionNo}. DECLARATION</div>
      <div class="grid-container">
        <div class="declaration-text">
          I/We hereby confirm that the above details are true and correct to the best of my knowledge.<br/>
          I/We have read, understood and agree to all the terms and conditions.<br/>
          I/We authorize the company to verify my/our details and documents.
        </div>
        <div class="checkbox-row">
          <div>☑ Declaration Accepted</div>
          <div>☑ Terms Accepted</div>
          <div>☑ Consent Accepted</div>
        </div>
      </div>

      <!-- SIGNATURE -->
      <div class="section-title">${signatureSectionNo}. SIGNATURE</div>
      <div class="signature-box">
        <div>
          <div style="margin-bottom: 10px;"><strong>Date:</strong> ${formatDate(booking.application_date || new Date())}</div>
          <div><strong>Place:</strong> Mumbai</div>
        </div>
        <div class="sign-area">
          ${signatureBase64 ? `<img src="${signatureBase64}" style="max-width: 200px; max-height: 60px; display: block; margin: 0 auto 5px auto;" />` : `<div class="sign-line"></div>`}
          <div style="border-top: 1px solid #000; width: 200px; margin: 0 auto; padding-top: 5px;">Signature of Primary Applicant</div>
        </div>
      </div>

    </body>
    </html>
    `;

    // ── Environment-aware browser launch ──────────────────────────────────
    let browser;
    const isDevMode = process.env.NODE_ENV === 'development';

    if (isDevMode) {
      const localPaths = [
        process.env.CHROME_EXECUTABLE_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ].filter(Boolean) as string[];

      let executablePath: string | undefined;
      for (const p of localPaths) {
        try { await fs.access(p); executablePath = p; break; } catch { }
      }

      if (!executablePath) {
        throw new Error(
          'Could not find Chrome. Add CHROME_EXECUTABLE_PATH to your .env.local pointing to your Chrome executable.'
        );
      }

      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    } else {
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(
          'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
        ),
        headless: true,
      });
    }

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'load' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px',
      },
    });

    await browser.close();

    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${booking.booking_number || 'Booking_Form'}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error('PDF Generation Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}