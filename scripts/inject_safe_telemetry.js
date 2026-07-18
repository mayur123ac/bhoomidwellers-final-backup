const fs = require('fs');
const path = require('path');

const targetFiles = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/receptionist/page.tsx",
  "src/app/dashboard/employees/page.tsx",
  "src/app/dashboard/caller/page.tsx"
];

const selectedLeadEffect = `
  const emitCrmAction = (action: string) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent('crm-activity', {
        detail: { action, leadId: selectedLead?.id || null, leadName: selectedLead?.name || null }
      }));
    }
  };

  useEffect(() => {
    emitCrmAction(selectedLead ? "Viewing Lead Details" : "Viewing Dashboard");
  }, [selectedLead]);
`;

targetFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Inject selectedLead telemetry
  const targetHook = 'const [selectedLead, setSelectedLead] = useState<any>(null);';
  if (content.includes(targetHook) && !content.includes('emitCrmAction(')) {
    content = content.replace(new RegExp(targetHook.replace(/[.*+?^$\/{}()|[\\]\\\\]/g, '\\\\$&'), 'g'), targetHook + '\n' + selectedLeadEffect);
    modified = true;
  }

  // 2. Wrap state setters
  const wrappers = [
    { name: "showSalesForm", action: "Editing Sales Form" },
    { name: "showLoanForm", action: "Editing Loan Form" },
    { name: "isWaModalOpen", action: "WhatsApp Action" },
    { name: "isClosingModalOpen", action: "Editing Closing Form" },
    { name: "showLostModal", action: "Marking Lead Lost" },
    { name: "isTransferModalOpen", action: "Transferring Lead" },
    { name: "isReassignModalOpen", action: "Reassigning Lead" }
  ];

  wrappers.forEach(w => {
    const hookRegex = new RegExp(`const \\\[${w.name}, set${w.name.charAt(0).toUpperCase() + w.name.slice(1)}\\\] = useState\\((false|true)\\);`, 'g');
    if (hookRegex.test(content) && !content.includes(`_${w.name}`)) {
      content = content.replace(hookRegex, (match, val) => {
        const setterName = `set${w.name.charAt(0).toUpperCase() + w.name.slice(1)}`;
        return `const [${w.name}, _${setterName}] = useState(${val});\n  const ${setterName} = (v: any) => { _${setterName}(v); if (v && typeof emitCrmAction === "function") emitCrmAction("${w.action}"); else if (!v && typeof emitCrmAction === "function") emitCrmAction(selectedLead ? "Viewing Lead Details" : "Viewing Dashboard"); };`;
      });
      modified = true;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Safely Injected: ${file}`);
  }
});
