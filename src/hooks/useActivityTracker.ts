import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

let lastEmittedSignature = "";
let lastEmittedTime = 0;

export const emitActivity = ({ type = "USER_ACTION", action, leadId = null, leadName = null, module = "Lead Dashboard" }: { type?: string, action: string, leadId?: string | number | null, leadName?: string | null, module?: string }) => {
  if (typeof window !== "undefined") {
    const signature = `${type}|${action}|${leadId}`;
    const now = Date.now();
    
    // Deduplication window: 3 seconds for identical actions
    if (signature === lastEmittedSignature && now - lastEmittedTime < 3000) {
      return; 
    }
    
    lastEmittedSignature = signature;
    lastEmittedTime = now;

    // Dispatch local event for state sync
    window.dispatchEvent(new CustomEvent('crm-activity', {
      detail: { type, action, leadId, leadName, module }
    }));
    
    // Log meaningful event to permanent audit DB and update Live State instantly
    fetch("/api/attendance/log-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, action, leadId, leadName, module })
    }).catch(() => {});
  }
};

export function useActivityTracker() {
  const pathname = usePathname();
  const lastActivityRef = useRef(Date.now());
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Connect to global SSE stream to receive instant force logouts
    const evtSource = new EventSource("/api/sse/live-activity");
    
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "FORCE_LOGOUT") {
          import("@/lib/authSession").then(({ clearCrmSession }) => {
            clearCrmSession();
            window.location.href = "/";
          });
        }
      } catch (e) {}
    };

    return () => evtSource.close();
  }, []);
  
  // Global telemetry state maintained via events
  const [activeLead, setActiveLead] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const [currentAction, setCurrentAction] = useState<string>("Viewing Dashboard");
  
  const getModuleName = (path: string) => {
    if (path.includes("/dashboard/leads")) return "Lead Dashboard";
    if (path.includes("/dashboard/whatsapp")) return "WhatsApp Panel";
    if (path.includes("/dashboard/calls")) return "Call Interface";
    if (path.includes("/dashboard/settings")) return "Settings";
    return "Dashboard";
  };

  const sendTelemetry = useCallback((actionOverride?: string, isIdle = false) => {
    const current_module = getModuleName(pathname || "/");
    const action = actionOverride || currentAction;
    
    fetch("/api/attendance/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_route: pathname,
        current_module,
        active_lead_id: activeLead.id,
        active_lead_name: activeLead.name,
        current_action: action,
        is_idle: isIdle
      })
    })
    .then(async (res) => {
      if (res.status === 401) {
        const data = await res.json().catch(() => ({}));
        if (data.forceLogout) {
          // Trigger forced logout
          import("@/lib/authSession").then(({ clearCrmSession }) => {
            clearCrmSession();
            window.location.href = "/";
          });
        }
      }
    })
    .catch(() => {});
  }, [pathname, activeLead, currentAction]);

  useEffect(() => {
    // Universal DOM Scanner: Safely extracts operational context without breaking React state
    const scanDomForActivity = () => {
      let action = "Viewing Dashboard";
      let leadId = null;
      let leadName = null;
      
      if (typeof document !== "undefined") {
        const bodyText = document.body.innerText;
        
        // Match specific modal headers in the CRM
        const waMatch = bodyText.match(/WhatsApp Lead #(\d+)/);
        const transferMatch = bodyText.match(/Transfer Lead #(\d+)/);
        const reassignMatch = bodyText.match(/Re-assign Lead #(\d+)/);
        const closingMatch = bodyText.match(/Mark Lead #(\d+) as Closing/);
        const lostMatch = bodyText.match(/Mark Lead #(\d+) as Lost/);
        const siteVisitMatch = bodyText.match(/Schedule .*?Site Visit\nLead #(\d+) - (.*?)\n/);
        const editSalesMatch = bodyText.includes("Editing Sales Details");
        const editLoanMatch = bodyText.includes("Editing Loan Details");
        
        // Determine Action
        if (waMatch) { action = "WhatsApp Action"; leadId = waMatch[1]; }
        else if (transferMatch) { action = "Transferring Lead"; leadId = transferMatch[1]; }
        else if (reassignMatch) { action = "Reassigning Lead"; leadId = reassignMatch[1]; }
        else if (closingMatch) { action = "Editing Closing Form"; leadId = closingMatch[1]; }
        else if (lostMatch) { action = "Marking Lead Lost"; leadId = lostMatch[1]; }
        else if (siteVisitMatch) { action = "Scheduling Site Visit"; leadId = siteVisitMatch[1]; leadName = siteVisitMatch[2]; }
        else if (editSalesMatch) { action = "Editing Sales Form"; }
        else if (editLoanMatch) { action = "Editing Loan Form"; }
        
        // If no modal is open, check if a lead is currently being viewed in the main panel
        if (action === "Viewing Dashboard") {
          // Look for standard lead panel signatures
          const leadPanelMatch = bodyText.match(/Lead assigned to .*? Status:/);
          if (leadPanelMatch) {
             action = "Viewing Lead Details";
             // Extract ID from the top header e.g. "#123 \n John Doe"
             const idNameMatch = bodyText.match(/#(\d+)\n([A-Za-z0-9 ]+)\n/);
             if (idNameMatch) {
               leadId = idNameMatch[1];
               leadName = idNameMatch[2].trim();
             }
          }
        }
      }

      // If state changed mathematically, log as an audit event
      if (action !== currentAction || leadId !== activeLead.id) {
        let type = "VIEW_SWITCH";
        if (action.includes("Editing") || action.includes("Action") || action.includes("Scheduling")) {
          type = "INTERACTION";
        }
        
        emitActivity({
          type,
          action,
          leadId: leadId || activeLead.id,
          leadName: leadName || activeLead.name,
          module: getModuleName(pathname || "/")
        });
      }
    };

    const domInterval = setInterval(scanDomForActivity, 2000);
    return () => clearInterval(domInterval);
  }, [currentAction, activeLead.id, activeLead.name]);

  useEffect(() => {
    // Listen for custom CRM events fired by child components
    const handleCrmEvent = (e: any) => {
      const detail = e.detail || {};
      
      let actionToReport = detail.action || currentAction;
      if (detail.leadId !== undefined) {
        setActiveLead({ id: detail.leadId, name: detail.leadName || null });
        if (detail.leadId) {
          actionToReport = detail.action || "Opened Lead";
        } else {
          actionToReport = "Viewing Dashboard";
        }
      }
      
      setCurrentAction(actionToReport);
      
      // We don't call sendTelemetry directly here because the state update is asynchronous.
      // We will trigger a forced telemetry push with the overrides.
      const current_module = getModuleName(pathname || "/");
      fetch("/api/attendance/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_route: pathname,
          current_module,
          active_lead_id: detail.leadId !== undefined ? detail.leadId : activeLead.id,
          active_lead_name: detail.leadName !== undefined ? detail.leadName : activeLead.name,
          current_action: actionToReport,
          is_idle: false
        })
      }).catch(() => {});
    };

    window.addEventListener("crm-activity", handleCrmEvent);
    return () => window.removeEventListener("crm-activity", handleCrmEvent);
  }, [pathname, activeLead, currentAction]);

  useEffect(() => {
    let lastKnownIdleState = false;

    const handleMeaningfulActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      
      if (lastKnownIdleState) {
        lastKnownIdleState = false;
        // User woke up! Send immediate active telemetry
        sendTelemetry(currentAction, false);
      }
      
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      
      idleTimeoutRef.current = setTimeout(() => {
        lastKnownIdleState = true;
        sendTelemetry("Idle", true);
      }, 5 * 60 * 1000);
    };

    window.addEventListener("keydown", handleMeaningfulActivity);
    window.addEventListener("click", handleMeaningfulActivity);
    window.addEventListener("touchstart", handleMeaningfulActivity);

    // Initial and periodic (every 30s) telemetry push
    sendTelemetry();
    const interval = setInterval(() => {
      const isIdle = Date.now() - lastActivityRef.current > 5 * 60 * 1000;
      lastKnownIdleState = isIdle;
      sendTelemetry(isIdle ? "Idle" : currentAction, isIdle);
    }, 30000);

    return () => {
      window.removeEventListener("keydown", handleMeaningfulActivity);
      window.removeEventListener("click", handleMeaningfulActivity);
      window.removeEventListener("touchstart", handleMeaningfulActivity);
      clearInterval(interval);
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [sendTelemetry, currentAction]);

  return { sendTelemetry };
}
