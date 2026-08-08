"use client";

// components/admin/AdminSidebar.tsx — the Admin Panel's global navigation rail.
//
// The Admin Dashboard, the Employee Management page and the Settings panel are
// three separate routes that must present one continuous application shell.
// They used to carry three copies of this markup; the rail now lives here once
// so the collapsed width, hover expansion, active glow and animation timings
// cannot drift apart between them.
//
// Bottom-pinned items are declared with `pinned: true` rather than inferred
// from position. The old code pinned `menuItems[menuItems.length - 1]` and
// rendered `menuItems.slice(0, -1)` above it, which silently made "whatever is
// last" the pinned entry — appending a new item would have stolen Bhoomi AI's
// place. Pinned entries render in array order, so Bhoomi AI stays put and
// Settings sits below it as the final button.

import { AnimatePresence, motion } from "framer-motion";
import type { IconType } from "react-icons";
import { useState } from "react";

export interface AdminNavItem {
  id: string;
  icon: IconType;
  label: string;
  pinned?: boolean;
}

/** Width of the rail when collapsed. Main content is offset by this. */
export const ADMIN_RAIL_WIDTH = 72;

export default function AdminSidebar<T extends AdminNavItem>({
  items,
  activeId,
  onSelect,
  isHovered,
  onHoverChange,
  groups,
  logoSrc = "/assets/logobrowser_trans.png",
}: {
  items: T[];
  /** id of the item to render active, or null when nothing in the rail is. */
  activeId: string | null;
  onSelect: (item: T) => void;
  isHovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  /** item id → group heading, shown above the first item of each run. */
  groups?: Record<string, string>;
  logoSrc?: string;
}) {
  // Quick Jump lives with the rail: it only ever filtered this list, and keeping
  // it here means the three host pages don't each need the state.
  const [navSearch, setNavSearch] = useState("");

  const matches = (item: T) => item.label.toLowerCase().includes(navSearch.toLowerCase());
  const mainItems = items.filter((i) => !i.pinned).filter(matches);
  const pinnedItems = items.filter((i) => i.pinned).filter(matches);

  const renderItem = (item: T) => {
    const isActive = activeId === item.id;
    return (
      <div
        key={item.id}
        title={!isHovered ? item.label : undefined}
        className="relative cursor-pointer group"
        onClick={() => onSelect(item)}
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
          className={`flex items-center gap-3 px-4.5 py-2.5 rounded-xl transition-all duration-200 relative overflow-hidden ${
            isActive ? "text-[#d946a8]" : "text-gray-500 hover:text-gray-200"
          }`}
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
            className={`flex-shrink-0 transition-all duration-200 ${
              isActive ? "text-[#d946a8]" : "text-gray-600 group-hover:text-gray-300"
            }`}
            style={isActive ? { filter: "drop-shadow(0 0 5px rgba(217,70,168,0.65))" } : {}}
          >
            <item.icon style={{ width: "17px", height: "17px" }} />
          </div>
          <span
            className={`text-[12.5px] font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ${
              isActive ? "text-[#d946a8]" : "text-gray-400 group-hover:text-gray-100"
            }`}
            style={{
              maxWidth: isHovered ? "140px" : "0px",
              opacity: isHovered ? 1 : 0,
              transform: isHovered ? "translateX(0)" : "translateX(-6px)",
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
      <AnimatePresence>
        {isHovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-40 pointer-events-none backdrop-blur-[1px]"
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={{ width: "72px" }}
        animate={{ width: isHovered ? "248px" : "72px" }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        className="fixed left-0 top-0 h-screen z-50 flex flex-col overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #0f0f1a 0%, #111128 40%, #0f0f1a 100%)",
          borderRight: "1px solid rgba(158,33,123,0.15)",
          boxShadow: "4px 0 24px rgba(0,0,0,0.4), inset -1px 0 0 rgba(158,33,123,0.08)",
        }}
      >
        <div className="flex items-center px-4 py-5 mb-2 whitespace-nowrap flex-shrink-0">
          <img
            src={logoSrc}
            alt="Logo"
            className="w-10 h-10 min-w-[40px] rounded-xl object-cover flex-shrink-0"
          />
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: isHovered ? 1 : 0, x: isHovered ? 0 : -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="ml-3 overflow-hidden"
          >
            <p className="font-black text-white text-[15px] leading-tight tracking-wide whitespace-nowrap">
              Bhoomi CRM
            </p>
            <p
              className="text-[10px] font-medium whitespace-nowrap"
              style={{ color: "rgba(217,70,168,0.7)" }}
            >
              Admin Panel
            </p>
          </motion.div>
        </div>

        <div
          className="mx-4 mb-4 flex-shrink-0"
          style={{
            height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(158,33,123,0.3), transparent)",
          }}
        />

        {isHovered && (
          <div className="px-4 mb-2 flex-shrink-0 animate-fadeIn">
            <input
              type="text"
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Quick jump..."
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder:text-gray-600 outline-none focus:border-[#9E217B]/50"
            />
          </div>
        )}

        <nav className="flex flex-col gap-2 px-2 flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll">
          <div className="flex flex-col gap-2">
            {mainItems.map((item, idx) => {
              const group = groups?.[item.id];
              // Compare against the previous *visible* item — comparing against
              // the unfiltered array makes headings vanish while searching.
              const showGroupLabel = group && group !== groups?.[mainItems[idx - 1]?.id];
              return (
                <div key={`wrap-${item.id}`}>
                  {showGroupLabel && (
                    <p
                      className="text-[10px] font-bold uppercase tracking-wider text-gray-600 px-4 pt-3 pb-1 overflow-hidden whitespace-nowrap transition-opacity duration-200"
                      style={{ opacity: isHovered ? 1 : 0 }}
                    >
                      {group}
                    </p>
                  )}
                  {renderItem(item)}
                </div>
              );
            })}
          </div>

          {/* Pinned block — anchored to the bottom, rendered in array order. */}
          {pinnedItems.length > 0 && (
            <div className="mt-auto flex flex-col gap-2 pt-3">{pinnedItems.map(renderItem)}</div>
          )}
        </nav>

        <div
          className="flex-shrink-0"
          style={{ height: "60px", background: "linear-gradient(0deg, #0f0f1a 0%, transparent 100%)" }}
        />
      </motion.aside>

      {/* Rail-local CSS. Each host page used to declare these itself; keeping
          them with the rail means a new host works without copying them. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .sidebar-scroll::-webkit-scrollbar{width:4px}
        .sidebar-scroll::-webkit-scrollbar-track{background:transparent}
        .sidebar-scroll::-webkit-scrollbar-thumb{background:rgba(217,70,168,0.25);border-radius:10px}
        .sidebar-scroll::-webkit-scrollbar-thumb:hover{background:rgba(217,70,168,0.5)}
        @keyframes sm-glow-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
      `,
        }}
      />
    </>
  );
}
