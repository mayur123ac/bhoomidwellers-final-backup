const fs = require('fs');
let lines = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8').split('\n');
let out = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('onClick={() => { setSelectedLead(lead); setSubView("detail"); }}')) {
    out.push(lines[i].replace(
      'onClick={() => { setSelectedLead(lead); setSubView("detail"); }}',
      'onClick={() => { setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(true); setShowLoanForm(false); }}'
    ));
  } else if (lines[i].includes('onClick={!isEnquiryTable ? () => { setIsEnquiryView(false); setSelectedLead(lead); setSubView("detail"); } : undefined}')) {
    out.push(lines[i].replace(
      'onClick={!isEnquiryTable ? () => { setIsEnquiryView(false); setSelectedLead(lead); setSubView("detail"); } : undefined}',
      'onClick={!isEnquiryTable ? () => { setIsEnquiryView(false); setSelectedLead(lead); setSubView("detail"); prefillSalesForm(lead); setShowSalesForm(true); setShowLoanForm(false); } : undefined}'
    ));
  } else {
    out.push(lines[i]);
  }
}
fs.writeFileSync('src/app/dashboard/page.tsx', out.join('\n'));
