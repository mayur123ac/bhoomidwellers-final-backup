const fs = require('fs');
let lines = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8').split('\n');
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const prefillSalesForm = () => {')) {
    out.push('  const prefillSalesForm = (targetLead?: any) => {');
    out.push('    const l = targetLead || selectedLead;');
    out.push('    if (!l) return;');
    out.push('    const fups = followUps.filter((f: any) => String(f.leadId) === String(l.id));');
    out.push('    const sf = fups.filter((f: any) => f.message?.includes("Detailed Salesform Submitted"));');
    out.push('    if (sf.length === 0) return;');
    out.push('    const msg = sf[sf.length - 1].message;');
    out.push('    const g = (label: string) => { const m = msg.match(new RegExp(`• ${label}: (.*)`)); return m && m[1].trim() !== "N/A" ? m[1].trim() : ""; };');
    out.push('    setSalesForm({ propertyType: g("Property Type"), location: g("Location"), budget: g("Budget"), useType: g("Use Type"), purchaseDate: g("Planning to Purchase"), loanPlanned: g("Loan Planned"), leadStatus: g("Lead Status"), siteVisit: "" });');
    out.push('  };');
    
    // The original prefillSalesForm function spans EXACTLY 8 lines from the start line.
    // Let's just skip the next 7 lines.
    i += 7;
  } else {
    out.push(lines[i]);
  }
}
fs.writeFileSync('src/app/dashboard/page.tsx', out.join('\n'));
