"use client";

// components/admin/AdminMobileDrawer.tsx
//
// The Admin Panel's hamburger sidebar for mobile screens.
//
// This is a direct port of components/sales/MobileNavDrawer.tsx — same
// drawer-from-right pattern, same backdrop, same animation, same close
// behaviour (Escape key, backdrop click, × button, body-scroll lock).
// The only differences are:
//   • It receives the Admin's `menuItems` (with group headings) instead of
//     the Sales Manager's SALES_NAV constant.
//   • It shows "Admin Panel" as the role label.
//   • It renders group headings above runs of items, matching how the
//     AdminSidebar already presents them on desktop.
//
// Desktop: this component is never mounted — the AdminSidebar handles
// everything. This component renders only on screens below the md breakpoint.

import { useEffect, useRef } from "react";
import { FaTimes, FaSun, FaMoon, FaCheckCircle, FaClock, FaSignOutAlt, FaUserCircle } from "react-icons/fa";
import UserAvatar from "@/components/UserAvatar";
import type { AdminNavItem } from "@/components/admin/AdminSidebar";

export default function AdminMobileDrawer<T extends AdminNavItem>({
  open,
  onClose,
  activeId,
  onSelect,
  isDark,
  orgName,
  userName,
  userRole,
  onToggleTheme,
  isMarkedPresent,
  timeIn,
  onLogout,
  menuItems,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  activeId: string | null;
  onSelect: (item: T) => void;
  isDark: boolean;
  orgName?: string | null;
  userName?: string;
  userRole?: string;
  onToggleTheme?: () => void;
  isMarkedPresent?: boolean;
  timeIn?: string | null;
  onLogout?: () => void;
  menuItems: T[];
  groups?: Record<string, string>;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape — same as Sales Manager MobileNavDrawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Prevent body scroll when open — same as Sales Manager MobileNavDrawer
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  // Split into non-pinned (main) and pinned (bottom) items
  const mainItems = menuItems.filter((i) => !i.pinned);
  const pinnedItems = menuItems.filter((i) => i.pinned);

  // Render a single nav button, optionally preceded by a group heading.
  const renderItem = (item: T, prevItem?: T) => {
    const isActive = activeId === item.id;
    const group = groups?.[item.id];
    const prevGroup = prevItem ? groups?.[prevItem.id] : undefined;
    const showGroupLabel = group && group !== prevGroup;
    const Icon = item.icon;
    return (
      <div key={item.id}>
        {showGroupLabel && (
          <p className={`text-[9px] font-bold uppercase tracking-widest px-3 pt-3 pb-1 ${isDark ? "text-gray-600" : "text-gray-400"}`}>
            {group}
          </p>
        )}
        <button
          onClick={() => {
            onSelect(item);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 text-left min-h-[44px] relative ${isActive
            ? isDark
              ? "text-[#d946a8] bg-[#9E217B]/15"
              : "text-[#9E217B] bg-[#9E217B]/10"
            : isDark
              ? "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              : "text-gray-600 hover:text-gray-900 hover:bg-black/5"
            }`}
          style={
            isActive
              ? {
                boxShadow: isDark
                  ? "inset 0 0 0 1px rgba(217,70,168,0.28)"
                  : "inset 0 0 0 1px rgba(158,33,123,0.2)",
              }
              : {}
          }
        >
          {isActive && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d946a8]"
              style={{ boxShadow: "0 0 8px rgba(217,70,168,0.6)" }}
            />
          )}
          <Icon className="w-[18px] h-[18px] flex-shrink-0" />
          <span className="text-[13px] font-semibold">{item.label}</span>
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop — same as Sales Manager: fixed inset-0, z-[200], opacity transition */}
      <div
        className={`fixed inset-0 z-[200] transition-opacity duration-300 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Drawer — slides in from right, same as Sales Manager */}
      <aside
        ref={drawerRef}
        className={`fixed top-0 right-0 z-[201] h-full flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? "translate-x-0" : "translate-x-full"
          }`}
        style={{
          width: "min(280px, 80vw)",
          background: isDark
            ? "linear-gradient(180deg, #0f0f1a 0%, #111128 40%, #0f0f1a 100%)"
            : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
          borderLeft: isDark
            ? "1px solid rgba(158,33,123,0.15)"
            : "1px solid rgba(0,0,0,0.08)",
          boxShadow: open ? "-8px 0 32px rgba(0,0,0,0.3)" : "none",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-3">
          <div className="flex items-center gap-3">
            <img
              src="/assets/logobrowser_trans.png"
              alt="Logo"
              className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
            />
            <div>
              <p className={`font-bold text-sm leading-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                Bhoomi CRM
              </p>
              <p className="text-[10px] font-semibold text-[#d946a8]">
                {userRole || "Admin Panel"}
              </p>
              {orgName && (
                <p className={`text-[9px] font-medium truncate max-w-[140px] ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                  {orgName}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${isDark
              ? "text-gray-400 hover:text-white hover:bg-white/10"
              : "text-gray-500 hover:text-gray-900 hover:bg-black/5"
              }`}
            aria-label="Close menu"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <div
          className="mx-4 h-px"
          style={{
            background: isDark
              ? "linear-gradient(90deg, transparent, rgba(158,33,123,0.4), transparent)"
              : "linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent)",
          }}
        />

        {/* User info */}
        {userName && (
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 flex-shrink-0 rounded-full overflow-hidden border border-[#d946a8]/30 flex items-center justify-center bg-black/10">
              <UserAvatar name={userName} fallbackNode={<FaUserCircle className="w-full h-full text-gray-400" />} alt={userName} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-[11px] font-medium truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                Signed in as
              </p>
              <p className={`text-[13.5px] font-bold truncate tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
                {userName}
              </p>
            </div>
          </div>
        )}

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
          {/* Main (non-pinned) items with group headings */}
          {mainItems.map((item, idx) => renderItem(item, mainItems[idx - 1]))}

          {/* Pinned items (Bhoomi AI, Settings) — at the bottom */}
          {pinnedItems.length > 0 && (
            <>
              <div
                className="mx-0 h-px my-2"
                style={{
                  background: isDark
                    ? "linear-gradient(90deg, transparent, rgba(158,33,123,0.25), transparent)"
                    : "linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)",
                }}
              />
              {pinnedItems.map((item, idx) => renderItem(item, pinnedItems[idx - 1]))}
            </>
          )}
        </nav>

        {/* Footer controls — identical structure to Sales Manager */}
        <div className="px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2">
          <div
            className="h-px mb-3"
            style={{
              background: isDark
                ? "linear-gradient(90deg, transparent, rgba(158,33,123,0.35), transparent)"
                : "linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)",
            }}
          />

          {/* Sign Out */}
          {onLogout && (
            <button
              onClick={onLogout}
              className={`w-full flex items-center gap-2 px-3 py-2 mb-3 rounded-xl text-sm font-semibold transition-colors min-h-[44px] group ${isDark
                ? "text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20"
                : "text-red-600 bg-red-50 hover:bg-red-100 border border-red-200"
                }`}
            >
              <FaSignOutAlt className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              Sign Out
            </button>
          )}

          {/* Theme toggle + Attendance status row */}
          <div className="flex items-center justify-between gap-3 mb-3">
            {onToggleTheme && (
              <button
                onClick={onToggleTheme}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors min-h-[44px] ${isDark
                  ? "text-gray-300 bg-white/5 hover:bg-white/10"
                  : "text-gray-600 bg-black/5 hover:bg-black/10"
                  }`}
              >
                {isDark ? <FaSun className="w-3.5 h-3.5 text-amber-400" /> : <FaMoon className="w-3.5 h-3.5 text-indigo-500" />}
                {isDark ? "Light Mode" : "Dark Mode"}
              </button>
            )}

            {isMarkedPresent !== undefined && (
              <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg ${isMarkedPresent
                ? isDark ? "text-green-400 bg-green-500/10" : "text-green-600 bg-green-50"
                : isDark ? "text-gray-500 bg-white/5" : "text-gray-400 bg-gray-100"
                }`}>
                {isMarkedPresent ? <FaCheckCircle className="w-3 h-3" /> : <FaClock className="w-3 h-3" />}
                {isMarkedPresent ? (timeIn ? `In: ${timeIn}` : "Present") : "Not checked in"}
              </div>
            )}
          </div>

          <span className={`text-[9px] font-mono tracking-widest uppercase ${isDark ? "text-gray-600" : "text-gray-400"}`}>
            Bhoomi CRM · Admin
          </span>
        </div>
      </aside>
    </>
  );
}
