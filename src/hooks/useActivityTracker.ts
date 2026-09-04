import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useRealtimeUser } from "@/lib/supabase/useRealtimeUser";
import { useRealtimeOrg } from "@/lib/supabase/useRealtimeOrg";

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

  // Resolve CRM user identity for Supabase Realtime channels
  const crmIdentity = useMemo(() => {
    if (typeof window === "undefined") return { org: null, userId: null };
    try {
      const raw = localStorage.getItem("crmUser");
      if (!raw) return { org: null, userId: null };
      const u = JSON.parse(raw);
      return { org: u?.org || null, userId: u?._id || u?.id || null };
    } catch { return { org: null, userId: null }; }
  }, []);

  const handleForceLogout = useCallback(() => {
    import("@/lib/authSession").then(({ clearCrmSession }) => {
      clearCrmSession();
      window.location.href = "/";
    });
  }, []);

  // User-targeted FORCE_LOGOUT (admin logs out a specific user)
  const userForceLogoutEvents = useMemo(() => ({
    "force_logout": () => handleForceLogout(),
  }), [handleForceLogout]);

  useRealtimeUser({
    organizationId: crmIdentity.org,
    userId: crmIdentity.userId,
    events: userForceLogoutEvents,
  });

  // Org-wide FORCE_LOGOUT (organization suspended)
  const orgForceLogoutEvents = useMemo(() => ({
    "force_logout": () => handleForceLogout(),
  }), [handleForceLogout]);

  useRealtimeOrg({
    organizationId: crmIdentity.org,
    events: orgForceLogoutEvents,
  });
  
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
        // PERF: this used to read `document.body.innerText` unconditionally, every
        // 2 seconds, on every page. `innerText` is layout-dependent — reading it
        // forces a SYNCHRONOUS full-page reflow, and on the enquiry table that is
        // hundreds of rows of layout recomputed 30 times a minute for a scan that
        // usually matches nothing. It was a prime suspect for general screen lag.
        //
        // `textContent` is NOT layout-dependent (no reflow) and is a superset of
        // the text `innerText` returns — innerText only ever ADDS newlines at
        // block boundaries and DROPS hidden text; it never introduces characters
        // textContent lacks. So every newline-free pattern below is a strict
        // necessary condition that can be tested against textContent first, and
        // we only pay for innerText when one of them could actually match.
        //
        // When nothing matches — the overwhelmingly common case, someone browsing
        // a table — no reflow happens at all.
        const flatText = document.body.textContent || "";
        const mightMatch =
          flatText.includes("WhatsApp Lead #") ||
          flatText.includes("Transfer Lead #") ||
          flatText.includes("Re-assign Lead #") ||
          flatText.includes("Mark Lead #") ||
          /Schedule .*?Site Visit/.test(flatText) ||
          flatText.includes("Editing Sales Details") ||
          flatText.includes("Editing Loan Details") ||
          /Lead assigned to .*? Status:/.test(flatText);

        // Only now, and only when a match is possible, take the reflow hit. The
        // newline-dependent patterns (siteVisitMatch, idNameMatch) genuinely need
        // innerText, so the original text source is preserved for matching —
        // textContent is used purely as a cheap gate.
        const bodyText = mightMatch ? document.body.innerText : "";

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

    // A background tab cannot change what the user is looking at, so there is
    // nothing for the scan to discover. Skipping the tick keeps a parked tab from
    // touching the DOM at all.
    const domInterval = setInterval(() => {
      if (document.hidden) return;
      scanDomForActivity();
    }, 2000);
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
