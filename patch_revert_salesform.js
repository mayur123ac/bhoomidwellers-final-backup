const fs = require('fs');
let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

// Fix row clicks
content = content.replace(
  /onClick=\{\(\) => \{ setSelectedLead\(lead\); setSubView\("detail"\); prefillSalesForm\(lead\); setShowSalesForm\(true\); setShowLoanForm\(false\); \}\}/g,
  'onClick={() => { setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(false); setShowLoanForm(false); }}'
);

content = content.replace(
  /onClick=\{!isEnquiryTable \? \(\) => \{ setIsEnquiryView\(false\); setSelectedLead\(lead\); setSubView\("detail"\); prefillSalesForm\(lead\); setShowSalesForm\(true\); setShowLoanForm\(false\); \} : undefined\}/g,
  'onClick={!isEnquiryTable ? () => { setIsEnquiryView(false); setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(false); setShowLoanForm(false); } : undefined}'
);

// Fix auto-drill handlers
content = content.replace(
  /setSubView\("detail"\);\s*prefillSalesForm\(drillLead\);\s*setShowSalesForm\(true\);\s*setShowLoanForm\(false\);/g,
  'setSubView("detail"); prefillSalesForm(drillLead); setShowSalesForm(false); setShowLoanForm(false);'
);

fs.writeFileSync('src/app/dashboard/page.tsx', content);
console.log("Reverted row clicks to NOT open sales form automatically.");
