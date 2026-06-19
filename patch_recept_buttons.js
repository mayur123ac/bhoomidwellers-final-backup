const fs = require('fs');

function patchReceptionist() {
  let content = fs.readFileSync('src/app/dashboard/receptionist/page.tsx', 'utf8');

  // Mark Closing condition (already fixed partially, but let's make sure mongoVisitDate is gone)
  content = content.replace(
    /\{selectedLead\.mongoVisitDate && selectedLead\.status !== "Closing" && !selectedLead\.is_lost_lead && \(/g,
    '{selectedLead.status !== "Closing" && !selectedLead.is_lost_lead && ('
  );

  // Resize buttons
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{t\.btnPrimary\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${t.btnPrimary}`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{t\.btnSecondary\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${t.btnSecondary}`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{t\.btnWarning\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${t.btnWarning}`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer \$\{t\.btnDanger\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${t.btnDanger}`}'
  );
  content = content.replace(
    /className=\{\`font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 \$\{t\.btnPrimary\}\`\}/g,
    'className={`font-bold px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 ${t.btnPrimary}`}'
  );

  fs.writeFileSync('src/app/dashboard/receptionist/page.tsx', content);
}

patchReceptionist();
console.log("Receptionist buttons resized");
