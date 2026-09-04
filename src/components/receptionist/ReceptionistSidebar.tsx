"use client";

// components/receptionist/ReceptionistSidebar.tsx — the Receptionist's global
// navigation rail.
//
// Extracted verbatim from app/dashboard/receptionist/page.tsx, where it was
// inline JSX. That is exactly why opening Settings used to strip a Receptionist
// of their navigation: the Admin rail was a component any route could mount
// (components/admin/AdminSidebar.tsx) and this one was not, so /dashboard/
// settings had nothing else to render and fell back to the cut-down admin rail
// — "Back to workspace / Settings", two icons where there had been eight.
//
// This is the same fix SalesSidebar already applied for the Sales Manager; see
// the header comment on components/RoleSidebar.tsx for the original diagnosis.
// Both hosts now mount this same file, so the markup is not copied anywhere and
// the rail cannot say one thing on the dashboard and another in Settings.
//
// Same contract as SalesSidebar and AdminSidebar on purpose (items / activeId /
// onSelect / expanded state), so RoleSidebar can choose between them without
// either host caring which one it gets.
//
// `onSelect` decides what a click means, which is the whole reason the rail can
// live in two places. On /dashboard/receptionist it switches the in-page tab; in
// Settings it navigates back to /dashboard/receptionist with that tab queued.

import type { IconType } from "react-icons";
import {
  FaCalendarAlt,
  FaChartPie,
  FaCheckCircle,
  FaClock,
  FaCog,
  FaHandshake,
  FaThLarge,
  FaUniversity,
  FaUsers,
} from "react-icons/fa";
import { BhoomiAiGlyph } from "@/components/bhoomi-ai/BhoomiAiIcon";

export interface ReceptionistNavItem {
  id: string;
  icon: IconType;
  label: string;
  /** Renders in the bottom-anchored block rather than the main run. */
  pinned?: boolean;
}

/** Width of the rail when collapsed. Hosts offset their main content by this. */
export const RECEPTIONIST_RAIL_WIDTH = 72;

/**
 * The Receptionist's navigation, declared once.
 *
 * Ids match the dashboard's `activeTab` values — that is what lets Settings hand
 * one back through `return_tab` and have the dashboard open on the right tab.
 * "settings" is pinned to the bottom and is a route rather than a tab.
 */
export const RECEPTIONIST_NAV: ReceptionistNavItem[] = [
  { id: "overview", icon: FaThLarge, label: "Dashboard" },
  { id: "analytics", icon: FaChartPie, label: "Analytics" },
  { id: "recep-leads", icon: FaUsers, label: "Receptionist Leads" },
  { id: "cp-enquiries", icon: FaHandshake, label: "CP Linked with Leads" },
  { id: "cp-enquiry-records", icon: FaHandshake, label: "CP Enquiry" },
  { id: "banking_info", icon: FaUniversity, label: "Banking Info" },
  { id: "closed-leads", icon: FaCheckCircle, label: "Closed Leads" },
  // Sits with the lead tabs because that is what it is a view of: the visits
  // booked against this receptionist's own leads, not the site's diary.
  { id: "site_visits", icon: FaCalendarAlt, label: "Site Visit Overview" },
  { id: "attendance", icon: FaClock, label: "My Attendance" },
  // Was FaRobot / "CRM AI Assistant" — a generic robot for what was a mock chat
  // panel. It is the real assistant now, so it carries the same mark and the
  // same name it has in the Admin and Sales rails. One assistant, one identity.
  { id: "assistant", icon: BhoomiAiGlyph, label: "Bhoomi AI" },
  { id: "settings", icon: FaCog, label: "Settings", pinned: true },
];

export default function ReceptionistSidebar({
  items = RECEPTIONIST_NAV,
  activeId,
  onSelect,
  expanded,
  onExpandedChange,
  hideOnMobile = true,
  orgName,
}: {
  items?: ReceptionistNavItem[];
  /** id to render active, or null when nothing in the rail is. */
  activeId: string | null;
  onSelect: (item: ReceptionistNavItem) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /**
   * The dashboard hides the rail below `md` because it has a bottom nav bar
   * there. Settings has no bottom nav, so it opts out — otherwise a Receptionist
   * on a phone would have no way out of Settings at all.
   */
  hideOnMobile?: boolean;
  /** Organisation display name shown beneath "Receptionist" in the header. */
  orgName?: string | null;
}) {
  const mainItems = items.filter((i) => !i.pinned);
  const pinnedItems = items.filter((i) => i.pinned);

  const renderItem = (item: ReceptionistNavItem, pinned: boolean) => {
    const isActive = activeId === item.id;
    const Icon = item.icon;
    return (
      <div
        key={item.id}
        onClick={() => onSelect(item)}
        title={!expanded ? item.label : undefined}
        className={`relative cursor-pointer group rp-nav-item${pinned ? " mt-auto" : ""}`}
      >
        {isActive && (
          <div
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
            }}
          />
        )}
        <div
          className={`flex items-center gap-3 rounded-xl transition-all duration-200 relative overflow-hidden ${pinned ? "px-3 py-2.5" : "px-3.5 py-3"
            } ${isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"}`}
          style={
            isActive
              ? {
                background:
                  "linear-gradient(135deg, rgba(158,33,123,0.22) 0%, rgba(217,70,168,0.07) 100%)",
                boxShadow:
                  "inset 0 0 0 1px rgba(217,70,168,0.28), 0 2px 16px rgba(158,33,123,0.12)",
              }
              : {}
          }
        >
          {isActive && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
              style={{ boxShadow: "0 0 10px rgba(217,70,168,0.9), 0 0 4px rgba(217,70,168,0.6)" }}
            />
          )}
          {!isActive && (
            <div className="absolute inset-0 rounded-xl bg-white/0 group-hover:bg-white/[0.04] transition-colors duration-200" />
          )}
          <div
            className={`flex-shrink-0 transition-all duration-200 ${isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"
              }`}
            style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
          >
            <Icon className={pinned ? "w-[20px] h-[20px] flex-shrink-0" : "w-5 h-5 flex-shrink-0"} />
          </div>
          <span
            className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"
              }`}
            style={{
              maxWidth: expanded ? "140px" : "0px",
              opacity: expanded ? 1 : 0,
              transform: expanded ? "translateX(0)" : "translateX(-6px)",
              letterSpacing: "0.01em",
            }}
          >
            {item.label}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <aside
        onMouseEnter={() => onExpandedChange(true)}
        onMouseLeave={() => onExpandedChange(false)}
        className={`${hideOnMobile ? "hidden md:flex" : "flex"} flex-col py-5 px-1 z-50 overflow-hidden fixed left-0 top-0 h-full`}
        style={{
          width: expanded ? "248px" : "72px",
          transition: "width 320ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 320ms ease",
          background: "linear-gradient(180deg, #0f0f1a 0%, #111128 40%, #0f0f1a 100%)",
          borderRight: "1px solid rgba(158,33,123,0.15)",
          boxShadow: expanded
            ? "4px 0 24px rgba(0,0,0,0.4), inset -1px 0 0 rgba(158,33,123,0.08)"
            : "2px 0 16px rgba(0,0,0,0.5)",
        }}
      >
        <div className="flex items-center px-3 mb-6 mt-1 overflow-hidden">
          <img
            src="/assets/logobrowser_trans.svg"
            alt="Logo"
            className="w-10 h-10 rounded-xl object-cover flex-shrink-0 cursor-pointer transition-all duration-300"
          />
          <div
            className="ml-3 overflow-hidden transition-all duration-300"
            style={{
              maxWidth: expanded ? "130px" : "0px",
              opacity: expanded ? 1 : 0,
              transform: expanded ? "translateX(0)" : "translateX(-8px)",
            }}
          >
            <p className="text-white font-bold text-[16px] whitespace-nowrap leading-tight">
              Bhoomi CRM
            </p>
            <p className="text-[#d946a8] text-[10px] font-semibold whitespace-nowrap opacity-80">
              Receptionist
            </p>
            {orgName && (
              <p
                className="text-[9.5px] font-semibold mt-0.5"
                style={{
                  color: "rgba(255,255,255,0.45)",
                  maxWidth: "120px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: "0.02em",
                }}
                title={orgName}
              >
                {orgName}
              </p>
            )}
          </div>
        </div>
        <div
          className="mx-3 mb-5 h-px transition-all duration-300"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.4), transparent)",
            opacity: expanded ? 1 : 0.4,
          }}
        />
        <nav className="flex flex-col gap-2 w-full px-2 flex-1">
          <div className="flex flex-col gap-2 flex-1">
            {mainItems.map((item) => renderItem(item, false))}
          </div>
          {pinnedItems.map((item) => renderItem(item, true))}
        </nav>
        <div className="px-3 mt-4">
          <div
            className="h-px mb-3"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.35), transparent)",
            }}
          />
          <div
            className="overflow-hidden transition-all duration-300 flex items-center justify-center"
            style={{
              opacity: expanded ? 0.5 : 0,
              maxHeight: expanded ? "24px" : "0px",
            }}
          >
            <span className="text-[8px] text-gray-300 whitespace-nowrap font-mono tracking-widest uppercase">
              Bhoomi CRM · v2
            </span>
          </div>
        </div>
      </aside>

      {/* Dim + blur behind the expanded rail. Pointer-events off so it never
          intercepts a click meant for the page underneath. */}
      <div
        className={`${hideOnMobile ? "hidden md:block" : "block"} fixed inset-0 pointer-events-none`}
        style={{
          zIndex: 45,
          left: "72px",
          background: "rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          opacity: expanded ? 1 : 0,
          transition: "opacity 320ms ease",
        }}
      />

      {/* Rail-local CSS, so a new host works without copying it — the collapsed
          state's tooltip used to be declared only in the receptionist
          dashboard's style block, which is exactly the kind of thing that goes
          missing when a component moves. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rp-nav-item{user-select:none}
        .rp-nav-item [title]:hover::after{
          content:attr(title);position:absolute;left:calc(100% + 12px);top:50%;
          transform:translateY(-50%);background:#1a1a2e;
          border:1px solid rgba(217,70,168,0.3);color:#e2e8f0;font-size:11px;
          font-weight:600;padding:5px 10px;border-radius:8px;white-space:nowrap;
          pointer-events:none;z-index:100;
          box-shadow:0 4px 16px rgba(0,0,0,0.5),0 0 0 1px rgba(217,70,168,0.1);
        }
      `,
        }}
      />
    </>
  );
}
