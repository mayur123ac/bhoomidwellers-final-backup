const fs = require('fs');

let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

// GlobalEnquiriesView Name Click Patch
let nameClickRegex = /onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*setIsEnquiryView\(true\);\s*setSelectedLead\(lead\);\s*setSubView\("detail"\);\s*\}\}/;

let nameClickReplacement = `onClick={(e) => {
                        e.stopPropagation();
                        setIsEnquiryView(true);
                        setSelectedLead(lead);
                        setSubView("detail");
                        prefillSalesForm(lead);
                        setShowSalesForm(false);
                        setShowLoanForm(false);
                      }}`;

content = content.replace(nameClickRegex, nameClickReplacement);

fs.writeFileSync('src/app/dashboard/page.tsx', content);

console.log("Patched GlobalEnquiriesView name click");
