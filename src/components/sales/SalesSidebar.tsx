"use client";

// components/sales/SalesSidebar.tsx — the Sales Manager's global navigation rail.
//
// Extracted verbatim from app/dashboard/sales/page.tsx, where it was inline JSX.
// That is why Settings used to swap a Sales Manager onto the Admin rail: the
// Admin rail was a component any route could mount (components/admin/
// AdminSidebar.tsx) and this one was not, so /dashboard/settings had nothing
// else to render. It is a component now, and both hosts mount this same file —
// the markup is not copied anywhere.
//
// Same contract as AdminSidebar on purpose (items / activeId / onSelect /
// hover state), so components/RoleSidebar.tsx can choose between them without
// either host caring which one it gets. The visual differences are real and
// preserved: this rail has no Quick Jump, larger nav items, a version footer,
// and says "Sales Manager" under the wordmark.
//
// `onSelect` decides what a click means, which is the whole reason the rail can
// live in two places. On /dashboard/sales it switches the in-page view; in
// Settings it navigates back to /dashboard/sales with that view queued.

import type { IconType } from "react-icons";
import {
  FaBuilding,
  FaCalendarAlt,
  FaCheckCircle,
  FaClock,
  FaCog,
  FaFileInvoice,
  FaHandshake,
  FaRobot,
  FaThLarge,
  FaUniversity,
} from "react-icons/fa";

export interface SalesNavItem {
  id: string;
  icon: IconType;
  label: string;
  /** Renders in the bottom-anchored block rather than the main run. */
  pinned?: boolean;
}

/** Width of the rail when collapsed. Hosts offset their main content by this. */
export const SALES_RAIL_WIDTH = 72;

/**
 * The Sales Manager's navigation, declared once.
 *
 * Both hosts render this exact list, so the rail cannot say one thing on the
 * dashboard and another in Settings. Ids match the dashboard's `activeView`
 * values — that is what lets Settings hand one back through `return_tab` and
 * have the dashboard open on the right view.
 */
export const SALES_NAV: SalesNavItem[] = [
  { id: "overview", icon: FaThLarge, label: "Dashboard" },
  { id: "closed-leads", icon: FaCheckCircle, label: "Your Closed Sales" },
  { id: "inventory", icon: FaBuilding, label: "Inventory" },
  { id: "site_visits", icon: FaCalendarAlt, label: "Site Visits" },
  { id: "cp_enquiry", icon: FaHandshake, label: "Active CP Info" },
  { id: "banking_info", icon: FaUniversity, label: "Bankers Info" },
  { id: "attendance", icon: FaClock, label: "My Attendance" },
  { id: "assistant", icon: FaRobot, label: "Bhoomi AI" },
  { id: "settings", icon: FaCog, label: "Settings", pinned: true },
];

export default function SalesSidebar({
  items = SALES_NAV,
  activeId,
  onSelect,
  expanded,
  onExpandedChange,
  hideOnMobile = true,
  orgName,
}: {
  items?: SalesNavItem[];
  /** id to render active, or null when nothing in the rail is. */
  activeId: string | null;
  onSelect: (item: SalesNavItem) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /**
   * The dashboard hides the rail below `md` because it has a bottom nav bar
   * there. Settings has no bottom nav, so it opts out — otherwise a Sales
   * Manager on a phone would have no way out of Settings at all.
   */
  hideOnMobile?: boolean;
  /** Organisation display name shown beneath "Sales Manager" in the header. */
  orgName?: string | null;
}) {
  const mainItems = items.filter((i) => !i.pinned);
  const pinnedItems = items.filter((i) => i.pinned);

  const renderItem = (item: SalesNavItem, pinned: boolean) => {
    const isActive = activeId === item.id;
    const Icon = item.icon;
    return (
      <div
        key={item.id}
        onClick={() => onSelect(item)}
        title={!expanded ? item.label : undefined}
        className={`relative cursor-pointer group sm-nav-item${pinned ? " mt-auto" : ""}`}
      >
        {isActive && (
          <div
            className="absolute inset-0 rounded-xl pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at left center, rgba(217,70,168,0.12) 0%, transparent 70%)",
              animation: "sm-glow-pulse 3s ease-in-out infinite",
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
            <Icon className={pinned ? "w-[20px] h-[20px] flex-shrink-0" : "w-[18px] h-[18px] flex-shrink-0"} />
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
        <div
          className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full blur-3xl opacity-20 transition-opacity duration-500"
          style={{
            background: "radial-gradient(circle, #9E217B 0%, transparent 70%)",
            opacity: expanded ? 0.28 : 0.14,
          }}
        />
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
              Sales Manager
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

      {/* Rail-local CSS, so a new host works without copying it — the active
          glow and the collapsed-state tooltip both used to be declared only in
          the sales dashboard's style block, which is exactly the kind of thing
          that goes missing when a component moves. sm-glow-pulse is also
          declared by AdminSidebar and by the two dashboards; every definition is
          identical, and only one rail is ever mounted at a time. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes sm-glow-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
        .sm-nav-item{user-select:none}
        .sm-nav-item [title]:hover::after{
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
