import { NextResponse } from 'next/server';
import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import fs from 'fs/promises';
import path from 'path';

async function getBase64Image(url: string | null) {
  if (!url) return null;
  try {
    const filePath = path.join(process.cwd(), 'public', url);
    const data = await fs.readFile(filePath);
    let ext = path.extname(filePath).substring(1).toLowerCase() || 'png';
    if (ext === 'jpg') ext = 'jpeg';
    
    // For PDFs, we might just want to show a placeholder since we can't easily embed a PDF inside an image tag in a PDF
    if (ext === 'pdf') {
      return null;
    }

    return `data:image/${ext};base64,${data.toString('base64')}`;
  } catch (err) {
    console.error("Failed to read image:", url);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking, lead } = body;

    if (!booking) {
      return NextResponse.json({ success: false, message: "Missing booking data" }, { status: 400 });
    }

    // Process joint applicants
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
        occupation: booking.joint_occupation, nationality: booking.joint_nationality
      }];
    }

    // Load images
    const primaryPanBase64 = await getBase64Image(booking.primary_pan_url);
    const primaryAadhaarBase64 = await getBase64Image(booking.primary_aadhaar_front_url);
    
    // Convert logo
    let logoBase64 = null;
    try {
      const logoPath = path.join(process.cwd(), 'public', 'assets', 'bhoomidwellersLogo.png');
      const logoData = await fs.readFile(logoPath);
      logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;
    } catch(e) {}

    const parseVal = (val: any) => {
      if (!val) return 0;
      let str = String(val).toLowerCase().replace(/[₹\s,]/g, "");
      if (str.includes("lakh")) return (parseFloat(str) || 0) * 100000;
      if (str.includes("cr")) return (parseFloat(str) || 0) * 10000000;
      return parseFloat(str) || 0;
    };
    
    let paymentRowsHtml = '';
    let totalReceived = 0;
    let paymentDetailsArr = [];
    try {
      paymentDetailsArr = typeof booking.payment_details === 'string' ? JSON.parse(booking.payment_details) : (booking.payment_details || []);
    } catch (e) {}

    if (paymentDetailsArr.length > 0) {
      paymentDetailsArr.forEach((p: any, idx: number) => {
        const amt = parseVal(p.amount);
        totalReceived += amt;
        paymentRowsHtml += `
          <tr>
            <td>${idx + 1}</td>
            <td>${p.date || '-'}</td>
            <td>${p.transaction_type || '-'}</td>
            <td>${amt.toLocaleString('en-IN')}</td>
          </tr>
        `;
      });
    } else {
      paymentRowsHtml = `<tr><td colspan="4" style="text-align: center;">No payments recorded</td></tr>`;
    }

    // Build Joint Applicants HTML
    let jointApplicantsHtml = '';
    for (let i = 0; i < jointApplicants.length; i++) {
      const ja = jointApplicants[i];
      const jaPanBase64 = await getBase64Image(ja.pan_url);
      const jaAadhaarBase64 = await getBase64Image(ja.aadhaar_front_url);

      jointApplicantsHtml += `
      <div class="section-title">2.${i + 1} JOINT APPLICANT DETAILS - ${i + 1}</div>
      <div class="grid-container applicant-container">
        <div class="details-grid">
          <div class="field-row"><div class="field-label">Full Name</div><div class="field-colon">:</div><div class="field-val">${ja.name || ''}</div></div>
          <div class="field-row"><div class="field-label">Email ID</div><div class="field-colon">:</div><div class="field-val">${ja.email || ''}</div></div>
          <div class="field-row"><div class="field-label">Mobile Number</div><div class="field-colon">:</div><div class="field-val">${ja.mobile || ''}</div></div>
          <div class="field-row"><div class="field-label">PAN Number</div><div class="field-colon">:</div><div class="field-val">${ja.pan || ''}</div></div>
          <div class="field-row"><div class="field-label">Aadhaar Number</div><div class="field-colon">:</div><div class="field-val">${ja.aadhaar || ''}</div></div>
          <div class="field-row"><div class="field-label">Occupation</div><div class="field-colon">:</div><div class="field-val">${ja.occupation || ''}</div></div>
          <div class="field-row"><div class="field-label">Nationality</div><div class="field-colon">:</div><div class="field-val">${ja.nationality || ''}</div></div>
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

        .header-logo {
          height: 50px;
          object-fit: contain;
        }

        .header-title {
          font-size: 18px;
          font-weight: 700;
          color: #9E217B;
          text-align: center;
          flex-grow: 1;
        }

        .header-info {
          text-align: right;
          font-size: 10px;
          line-height: 1.4;
        }
        
        .header-info strong {
          color: #555;
        }

        .info-bar {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
          font-size: 11px;
        }

        .section-title {
          color: #9E217B;
          font-weight: 700;
          font-size: 12px;
          margin-top: 15px;
          margin-bottom: 10px;
          text-transform: uppercase;
        }

        .grid-container {
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 15px;
          margin-bottom: 15px;
        }

        .applicant-container {
          display: flex;
          gap: 20px;
        }

        .details-grid {
          flex: 2;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-row {
          display: flex;
        }

        .field-label {
          width: 140px;
          font-weight: 600;
          color: #555;
        }

        .field-colon {
          width: 20px;
        }

        .field-val {
          flex: 1;
        }

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

        .doc-title {
          font-size: 10px;
          font-weight: 600;
          margin-bottom: 5px;
        }

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
        }
        
        .sign-area {
          text-align: center;
        }
        
        .sign-line {
          width: 200px;
          border-bottom: 1px solid #000;
          margin-bottom: 5px;
          height: 60px;
        }
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
        <div><strong>Date of Application:</strong> ${new Date(booking.application_date || new Date()).toLocaleDateString('en-GB')}</div>
        <div><strong>Sales Manager:</strong> ${booking.lead_assigned_to || lead?.assigned_to || 'N/A'}</div>
        <div><strong>Status:</strong> ${booking.booking_status || 'Pending'}</div>
      </div>

      <!-- PRIMARY APPLICANT -->
      <div class="section-title">1. PRIMARY APPLICANT DETAILS</div>
      <div class="grid-container">
        <div class="applicant-container">
          <div class="details-grid">
            <div class="field-row"><div class="field-label">Full Name</div><div class="field-colon">:</div><div class="field-val">${booking.primary_name || ''}</div></div>
            <div class="field-row"><div class="field-label">Email ID</div><div class="field-colon">:</div><div class="field-val">${booking.primary_email || ''}</div></div>
            <div class="field-row"><div class="field-label">Mobile Number</div><div class="field-colon">:</div><div class="field-val">${booking.primary_mobile || ''}</div></div>
            <div class="field-row"><div class="field-label">PAN Number</div><div class="field-colon">:</div><div class="field-val">${booking.primary_pan || ''}</div></div>
            <div class="field-row"><div class="field-label">Aadhaar Number</div><div class="field-colon">:</div><div class="field-val">${booking.primary_aadhaar || ''}</div></div>
            <div class="field-row"><div class="field-label">Occupation</div><div class="field-colon">:</div><div class="field-val">${booking.primary_occupation || ''}</div></div>
            <div class="field-row"><div class="field-label">Nationality</div><div class="field-colon">:</div><div class="field-val">${booking.primary_nationality || ''}</div></div>
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
          <div class="field-val">${booking.address || ''}</div>
        </div>
        <div class="address-row" style="border:none; margin-top:5px; padding-top:0;">
          <div style="flex:1"><span class="field-label" style="width:auto">Pin:</span> ${booking.pin || ''}</div>
          <div style="flex:1"><span class="field-label" style="width:auto">State:</span> ${booking.state || ''}</div>
          <div style="flex:1"><span class="field-label" style="width:auto">Country:</span> ${booking.country || ''}</div>
        </div>
      </div>

      <!-- JOINT APPLICANTS -->
      ${jointApplicantsHtml}

      <!-- UNIT DETAILS -->
      <div class="section-title">3. UNIT / PROPERTY DETAILS</div>
      <div class="grid-container property-grid">
        <div class="field-row"><div class="field-label">Type</div><div class="field-colon">:</div><div class="field-val">${booking.property_type || ''}</div></div>
        <div class="field-row"><div class="field-label">Flat No.</div><div class="field-colon">:</div><div class="field-val">${booking.flat_number || ''}</div></div>
        <div class="field-row"><div class="field-label">Floor</div><div class="field-colon">:</div><div class="field-val">${booking.floor_number || ''}</div></div>
        <div class="field-row"><div class="field-label">Carpet Area</div><div class="field-colon">:</div><div class="field-val">${booking.carpet_area || ''} sq.ft</div></div>
        <div class="field-row"><div class="field-label">Consideration Value</div><div class="field-colon">:</div><div class="field-val">₹ ${booking.consideration_value || ''}</div></div>
        <div class="field-row"><div class="field-label">In Words</div><div class="field-colon">:</div><div class="field-val">${booking.consideration_value_words || ''}</div></div>
        <div class="field-row"><div class="field-label">Parking Details</div><div class="field-colon">:</div><div class="field-val">${booking.parking_details || 'N/A'}</div></div>
      </div>

      <!-- PAYMENT DETAILS -->
      <div class="section-title">4. PAYMENT DETAILS</div>
      <table>
        <thead>
          <tr>
            <th width="10%">Sr. No.</th>
            <th width="30%">Date</th>
            <th width="40%">Transaction Detail</th>
            <th width="20%">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRowsHtml}
          <tr>
            <td colspan="3" style="text-align: right; font-weight: bold;">Total Received Amount</td>
            <td style="font-weight: bold;">${totalReceived.toLocaleString('en-IN')}</td>
          </tr>
        </tbody>
      </table>

      <!-- DECLARATION -->
      <div class="section-title">5. DECLARATION</div>
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
      <div class="section-title">6. SIGNATURE</div>
      <div class="signature-box">
        <div>
          <div style="margin-bottom: 10px;"><strong>Date:</strong> ${new Date(booking.application_date || new Date()).toLocaleDateString('en-GB')}</div>
          <div><strong>Place:</strong> Mumbai</div>
        </div>
        <div class="sign-area">
          ${booking.signature_data ? `<img src="${booking.signature_data}" style="max-width: 200px; max-height: 60px; display: block; margin: 0 auto 5px auto;" />` : `<div class="sign-line"></div>`}
          <div style="border-top: 1px solid #000; width: 200px; margin: 0 auto; padding-top: 5px;">Signature of Primary Applicant</div>
        </div>
      </div>

    </body>
    </html>
    `;

    // Launch puppeteer (Vercel-compatible using @sparticuz/chromium-min)
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(
        'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
      ),
      headless: true,
    });

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
      }
    });

    await browser.close();

    // Return PDF
    return new NextResponse(Buffer.from(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${booking.booking_number || 'Booking_Form'}.pdf"`,
      },
    });

  } catch (error: any) {
    console.error("PDF Generation Error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
