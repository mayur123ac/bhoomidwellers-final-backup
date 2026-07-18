const fs = require('fs');

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Remove mongoVisitDate check for "Mark Closing" / "Mark as Closing"
  // In page.tsx:
  content = content.replace(
    /\{selectedLead\.mongoVisitDate && selectedLead\.status !== "Closing" && !selectedLead\.is_lost_lead && \(/g,
    '{selectedLead.status !== "Closing" && !selectedLead.is_lost_lead && ('
  );

  // 2. Make buttons smaller
  // "Fill Salesform" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{theme\.btnPrimary\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary}`}'
  );
  // "Track Loan" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{theme\.btnSecondary\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${theme.btnSecondary}`}'
  );
  // "Mark Closing" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{theme\.btnWarning\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${theme.btnWarning}`}'
  );
  // "Lost Lead" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{theme\.btnDanger\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${theme.btnDanger}`}'
  );
  // "Restore Lead" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{theme\.btnPrimary\} disabled:opacity-60\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${theme.btnPrimary} disabled:opacity-60`}'
  );
  // "Transfer" button
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{isDark \? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${isDark ? "bg-purple-600 hover:bg-purple-500 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"}`}'
  );

  // In sales/page.tsx:
  content = content.replace(
    /className=\{\`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center \$\{t\.btnPrimary\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnPrimary}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center \$\{t\.btnSecondary\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnSecondary}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center \$\{t\.btnDanger\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnDanger}`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 sm:px-5 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-lg flex-1 sm:flex-none justify-center \$\{t\.btnWarning\} shadow-amber-600\/20\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md flex-1 sm:flex-none justify-center ${t.btnWarning} shadow-amber-600/20`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-xs sm:text-sm flex items-center gap-2 flex-1 sm:flex-none justify-center \$\{t\.btnClosingBadge\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 flex-1 sm:flex-none justify-center ${t.btnClosingBadge}`}'
  );

  fs.writeFileSync(filePath, content);
}

patchFile('src/app/dashboard/page.tsx');
patchFile('src/app/dashboard/sales/page.tsx');
// Check receptionist page as well
patchFile('src/app/dashboard/receptionist/page.tsx');

console.log("Buttons resized and Mark Closing condition updated.");
