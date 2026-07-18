const fs = require('fs');
const path = require('path');

const targetFiles = [
  "src/app/dashboard/page.tsx",
  "src/app/dashboard/sales/page.tsx",
  "src/app/dashboard/receptionist/page.tsx",
  "src/app/dashboard/employees/page.tsx",
  "src/app/dashboard/caller/page.tsx"
];

const telemetryEffect = `
  // --- INJECTED GLOBAL TELEMETRY EMITTER ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      let action = "Viewing Dashboard";
      if (typeof selectedLead !== "undefined" && selectedLead) {
        if (typeof showSalesForm !== "undefined" && showSalesForm) action = "Editing Sales Form";
        else if (typeof showLoanForm !== "undefined" && showLoanForm) action = "Editing Loan Form";
        else if (typeof isClosingModalOpen !== "undefined" && isClosingModalOpen) action = "Editing Closing Form";
        else if (typeof isWaModalOpen !== "undefined" && isWaModalOpen) action = "WhatsApp Action";
        else if (typeof showLostModal !== "undefined" && showLostModal) action = "Marking Lead Lost";
        else if (typeof isTransferModalOpen !== "undefined" && isTransferModalOpen) action = "Transferring Lead";
        else if (typeof isReassignModalOpen !== "undefined" && isReassignModalOpen) action = "Reassigning Lead";
        else action = "Viewing Lead Details";
      }
      
      const leadObj = typeof selectedLead !== "undefined" ? selectedLead : null;
      window.dispatchEvent(new CustomEvent('crm-activity', {
        detail: { action, leadId: leadObj?.id || null, leadName: leadObj?.name || null }
      }));
    }
  }, [
    typeof selectedLead !== "undefined" ? selectedLead : null,
    typeof showSalesForm !== "undefined" ? showSalesForm : false,
    typeof showLoanForm !== "undefined" ? showLoanForm : false,
    typeof isClosingModalOpen !== "undefined" ? isClosingModalOpen : false,
    typeof isWaModalOpen !== "undefined" ? isWaModalOpen : false,
    typeof showLostModal !== "undefined" ? showLostModal : false,
    typeof isTransferModalOpen !== "undefined" ? isTransferModalOpen : false,
    typeof isReassignModalOpen !== "undefined" ? isReassignModalOpen : false
  ]);
  // ------------------------------------------
`;

targetFiles.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skip (not found): ${file}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Inject useActivityTracker import
  if (!content.includes('useActivityTracker')) {
    content = content.replace(/(import .* from ['"]next\/navigation['"];)/, "$1\nimport { useActivityTracker } from \"@/hooks/useActivityTracker\";");
    modified = true;
  }

  // 2. Inject useActivityTracker() inside the main Dashboard component
  // Regex looks for "export default function XDashboard() {"
  const mainComponentMatch = content.match(/export default function \w+Dashboard\(\) {/);
  if (mainComponentMatch && !content.includes('useActivityTracker();')) {
    content = content.replace(mainComponentMatch[0], mainComponentMatch[0] + "\n  useActivityTracker();");
    modified = true;
  }

  // 3. Inject Telemetry useEffect right after state declarations in child views
  // We look for setOptimisticLeadOverrides, setSiteHeads, setSalesManagers which are usually at the end of state blocks
  const stateHooks = [
    "const [optimisticLeadOverrides, setOptimisticLeadOverrides] = useState<Record<string, any>>({});",
    "const [siteHeads, setSiteHeads] = useState<any[]>([]);",
    "const [salesManagers, setSalesManagers] = useState<any[]>([]);",
    "const [callers, setCallers] = useState<any[]>([]);",
    "const [reassignTarget, setReassignTarget] = useState(\"\");"
  ];

  stateHooks.forEach(hook => {
    // Only inject once per component block
    let pos = 0;
    while ((pos = content.indexOf(hook, pos)) !== -1) {
      const hookEnd = pos + hook.length;
      // Check if we already injected telemetry right after
      if (!content.substring(hookEnd, hookEnd + 500).includes('INJECTED GLOBAL TELEMETRY EMITTER')) {
        content = content.slice(0, hookEnd) + "\n" + telemetryEffect + content.slice(hookEnd);
        modified = true;
      }
      pos = hookEnd + telemetryEffect.length;
    }
  });
  
  // Special fallback for selectedLead if none of the above states exist
  if (!content.includes('INJECTED GLOBAL TELEMETRY EMITTER') && content.includes('const [selectedLead, setSelectedLead] = useState<any>(null);')) {
    let pos = 0;
    const targetHook = 'const [selectedLead, setSelectedLead] = useState<any>(null);';
    while ((pos = content.indexOf(targetHook, pos)) !== -1) {
      const hookEnd = pos + targetHook.length;
      if (!content.substring(hookEnd, hookEnd + 500).includes('INJECTED GLOBAL TELEMETRY EMITTER')) {
        content = content.slice(0, hookEnd) + "\n" + telemetryEffect + content.slice(hookEnd);
        modified = true;
      }
      pos = hookEnd + telemetryEffect.length;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${file}`);
  } else {
    console.log(`No changes needed for: ${file}`);
  }
});
