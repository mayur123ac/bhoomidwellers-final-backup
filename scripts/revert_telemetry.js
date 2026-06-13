const fs = require('fs');
const path = require('path');

const targetFiles = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/receptionist/page.tsx",
  "src/app/dashboard/employees/page.tsx",
  "src/app/dashboard/caller/page.tsx"
];

targetFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');

  // Revert state wrappers
  const wrapperRegex = /const \[([a-zA-Z0-9_]+), _set[a-zA-Z0-9_]+\] = useState\((false|true)\);\n\s*const set[a-zA-Z0-9_]+ = \(v: any\) => \{ _set[a-zA-Z0-9_]+\(v\); if \(v && typeof emitCrmAction === "function"\) emitCrmAction\(".*?"\); else if \(!v && typeof emitCrmAction === "function"\) emitCrmAction\(selectedLead \? "Viewing Lead Details" : "Viewing Dashboard"\); \};/g;
  
  content = content.replace(wrapperRegex, (match, stateName, defaultVal) => {
    const setterName = "set" + stateName.charAt(0).toUpperCase() + stateName.slice(1);
    return `const [${stateName}, ${setterName}] = useState(${defaultVal});`;
  });

  // Revert selectedLead telemetry
  const effectBlock = `  const emitCrmAction = (action: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent('crm-activity', {
        detail: { action, leadId: selectedLead?.id || null, leadName: selectedLead?.name || null }
      }));
    }
  };

  useEffect(() => {
    emitCrmAction(selectedLead ? "Viewing Lead Details" : "Viewing Dashboard");
  }, [selectedLead]);`;

  content = content.replace(effectBlock, "");
  // Because it might be duplicated, remove globally just in case
  content = content.split(effectBlock).join("");

  // Fix the hook declaration spacing if needed
  content = content.replace(/const \[selectedLead, setSelectedLead\] = useState<any>\(null\);\n\s*\n/g, "const [selectedLead, setSelectedLead] = useState<any>(null);\n");

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Reverted: ${file}`);
});
