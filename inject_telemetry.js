const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/sales/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Inject into openLostLeadModal
content = content.replace(
  /const openLostLeadModal = \(\) => {[\s\S]*?setShowLostModal\(true\);/m,
  "const openLostLeadModal = () => {\n    setLostReason(\"\");\n    setLostError(\"\");\n    setShowLostModal(true);\n    emitActivity({type: 'LEAD_INTERACTION', action: 'Marking Lead as Lost', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Lost Modal'});"
);

// Inject into prefillSalesForm
content = content.replace(
  /setShowSalesForm\(true\); setShowLoanForm\(false\);/g,
  "setShowSalesForm(true); setShowLoanForm(false); emitActivity({type: 'LEAD_INTERACTION', action: 'Editing Closing Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Sales Form'});"
);

// Inject into prefillLoanForm
content = content.replace(
  /setShowLoanForm\(true\); setShowSalesForm\(false\);/g,
  "setShowLoanForm(true); setShowSalesForm(false); emitActivity({type: 'LEAD_INTERACTION', action: 'Editing Loan Form', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Loan Form'});"
);

// Inject into Site Visit Modal open
content = content.replace(
  /setVisitDate\(""\); setVisitNotes\(""\); setShowModal\(true\);/g,
  "setVisitDate(\"\"); setVisitNotes(\"\"); setShowModal(true); emitActivity({type: 'LEAD_INTERACTION', action: 'Updating Site Visit', leadId: selectedLead?.id, leadName: selectedLead?.name, module: 'Site Visit Modal'});"
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Injected telemetry into sales/page.tsx");
