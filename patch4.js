const fs = require('fs');

let content = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');

// 1. AdminSalesView fix
let adminSalesRegex = /const drillLead = JSON\.parse\(raw\);\s*if \(drillLead\._drillTab !== "site_head"\) return;\s*localStorage\.removeItem\("crm_drill_lead"\);\s*const sh = managers\.find\(\(s: any\) => s\.name === drillLead\.assigned_to\);\s*if \(sh\) \{\s*setSelectedManager\(sh\);\s*setSelectedLead\(drillLead\);\s*setSubView\("detail"\);\s*\}/;

let adminSalesReplacement = `const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "sales") return;
      localStorage.removeItem("crm_drill_lead");
      const sh = managers.find((s: any) => s.name === drillLead.assigned_to);
      if (sh) {
        setSelectedManager(sh);
        setSelectedLead(drillLead);
        setSubView("detail");
        prefillSalesForm(drillLead);
        setShowSalesForm(true);
        setShowLoanForm(false);
      }`;

// 2. AdminSiteHeadView fix
let siteHeadRegex = /const drillLead = JSON\.parse\(raw\);\s*if \(drillLead\._drillTab !== "site_head"\) return;\s*localStorage\.removeItem\("crm_drill_lead"\);\s*const sh = siteHeads\.find\(\(s: any\) => s\.name === drillLead\.assigned_to\);\s*if \(sh\) \{\s*setSelectedSiteHead\(sh\);\s*setSelectedLead\(drillLead\);\s*setSubView\("detail"\);\s*\}/;

let siteHeadReplacement = `const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "site_head") return;
      localStorage.removeItem("crm_drill_lead");
      const sh = siteHeads.find((s: any) => s.name === drillLead.assigned_to);
      if (sh) {
        setSelectedSiteHead(sh);
        setSelectedLead(drillLead);
        setSubView("detail");
        prefillSalesForm(drillLead);
        setShowSalesForm(true);
        setShowLoanForm(false);
      }`;

// 3. ReceptionistView fix
let receptionistRegex = /const drillLead = JSON\.parse\(raw\);\s*if \(drillLead\._drillTab !== "receptionist"\) return;\s*localStorage\.removeItem\("crm_drill_lead"\);\s*const recep = receptionists\.find\(\(r: any\) => r\.name === drillLead\.assigned_receptionist\);\s*if \(recep\) \{\s*setSelectedReceptionist\(recep\);\s*setActiveSection\("assignedTable"\);\s*setSelectedLead\(drillLead\);\s*setIsEnquiryView\(false\);\s*setSubView\("detail"\);\s*\}/;

let receptionistReplacement = `const drillLead = JSON.parse(raw);
      if (drillLead._drillTab !== "receptionist") return;
      localStorage.removeItem("crm_drill_lead");
      const recep = receptionists.find((r: any) => r.name === drillLead.assigned_receptionist);
      if (recep) {
        setSelectedReceptionist(recep);
        setActiveSection("assignedTable");
        setSelectedLead(drillLead);
        setIsEnquiryView(false);
        setSubView("detail");
        prefillSalesForm(drillLead);
        setShowSalesForm(true);
        setShowLoanForm(false);
      }`;

content = content.replace(adminSalesRegex, adminSalesReplacement);
content = content.replace(siteHeadRegex, siteHeadReplacement);
content = content.replace(receptionistRegex, receptionistReplacement);

fs.writeFileSync('src/app/dashboard/page.tsx', content);

console.log("Patched successfully");
