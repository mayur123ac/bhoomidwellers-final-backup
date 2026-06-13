const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/dashboard/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add emitActivity to import
content = content.replace(
  /import \{ useActivityTracker \} from "@\/hooks\/useActivityTracker";/,
  'import { useActivityTracker, emitActivity } from "@/hooks/useActivityTracker";'
);

// 2. Instrument Lead Selection from Table Row Clicks
content = content.replace(
  /onClick=\{\(\) => \{ setSelectedLead\(lead\); setSubView\("detail"\); \}\}/g,
  'onClick={() => { setSelectedLead(lead); setSubView("detail"); emitActivity({type: "LEAD_OPENED", leadId: lead.id, leadName: lead.name, module: "Lead Dashboard", action: "Viewing Lead"}); }}'
);

// 3. Instrument Form Opening: Sales Form
content = content.replace(
  /setShowSalesForm\(true\); setShowLoanForm\(false\);/g,
  'setShowSalesForm(true); setShowLoanForm(false); emitActivity({type: "FORM_EDIT_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Sales Form", action: "Editing Closing Form"});'
);

// 4. Instrument Form Opening: Loan Form
content = content.replace(
  /setShowLoanForm\(true\); setShowSalesForm\(false\);/g,
  'setShowLoanForm(true); setShowSalesForm(false); emitActivity({type: "FORM_EDIT_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Loan Form", action: "Editing Loan Form"});'
);

// 5. Instrument Form Opening: Transfer Modal
content = content.replace(
  /setIsTransferModalOpen\(true\)/g,
  'setIsTransferModalOpen(true); emitActivity({type: "FORM_EDIT_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Transfer Modal", action: "Transferring Lead"});'
);

// 6. Instrument Form Opening: Reassign Modal
content = content.replace(
  /setIsReassignModalOpen\(true\)/g,
  'setIsReassignModalOpen(true); emitActivity({type: "FORM_EDIT_STARTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Reassign Modal", action: "Reassigning Lead"});'
);

// 7. Instrument Lost Lead Modal Open
// There are multiple definitions like: const openLostLeadModal = (lead = selectedLead) => {
content = content.replace(
  /const openLostLeadModal = \(lead = selectedLead\) => \{\n\s*setSelectedLead\(lead\);\n\s*setLostReason\(""\);\n\s*setLostError\(""\);\n\s*setShowLostModal\(true\);\n\s*\};/g,
  `const openLostLeadModal = (lead = selectedLead) => {
    setSelectedLead(lead);
    setLostReason("");
    setLostError("");
    setShowLostModal(true);
    emitActivity({type: "FORM_EDIT_STARTED", leadId: lead?.id, leadName: lead?.name, module: "Lost Modal", action: "Marking Lead as Lost"});
  };`
);

// 8. Instrument Form Submissions
// handleMarkLostLead
content = content.replace(
  /const handleMarkLostLead = async \(e: React\.FormEvent<HTMLFormElement>\) => \{\n\s*e\.preventDefault\(\);\n\s*if \(!selectedLead\) return;/g,
  `const handleMarkLostLead = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    emitActivity({type: "FORM_SUBMITTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Lost Modal", action: "Updated Lead"});`
);

// handleMarkAsClosing
content = content.replace(
  /const handleMarkAsClosing = async \(\) => \{\n\s*if \(!selectedLead \|\| selectedLead\.status === "Closing"\) return;/g,
  `const handleMarkAsClosing = async () => {
    if (!selectedLead || selectedLead.status === "Closing") return;
    emitActivity({type: "FORM_SUBMITTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Closing Form", action: "Updated Lead"});`
);

// handleLoanFormSubmit
content = content.replace(
  /const handleLoanFormSubmit = async \(e: React\.FormEvent<HTMLFormElement>\) => \{\n\s*e\.preventDefault\(\);\n\s*if \(!selectedLead\) return;/g,
  `const handleLoanFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    emitActivity({type: "FORM_SUBMITTED", leadId: selectedLead?.id, leadName: selectedLead?.name, module: "Loan Form", action: "Updated Lead"});`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Telemetry instrumentation applied to page.tsx.");
