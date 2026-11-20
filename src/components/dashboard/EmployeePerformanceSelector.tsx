"use client";

import { useRef, useCallback } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import type { EmployeeKpi } from "./useDashboardKpis";

type RoleFilter = "all" | "Sales Manager" | "Site Head" | "Receptionist";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- theme is untyped
type ThemeAny = any;

type Props = {
  employees: EmployeeKpi[];
  selectedId: number | null; // null = All Team
  onSelect: (id: number | null) => void;
  roleFilter: RoleFilter;
  onRoleFilterChange: (filter: RoleFilter) => void;
  theme: ThemeAny;
  isDark: boolean;
};

const ROLE_TABS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Sales Manager", label: "Sales" },
  { value: "Site Head", label: "Site Heads" },
  { value: "Receptionist", label: "Receptionists" },
];

const AVATAR_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#06B6D4", "#EC4899", "#F97316",
];

function normalizeRole(role: string): string {
  return role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function EmployeePerformanceSelector({
  employees,
  selectedId,
  onSelect,
  roleFilter,
  onRoleFilterChange,
  theme,
  isDark,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollBy = useCallback((dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  }, []);

  const filtered = roleFilter === "all"
    ? employees
    : employees.filter(e => normalizeRole(e.role) === roleFilter);

  const totalCount = employees.length;

  return (
    <div className={`${theme.card} rounded-2xl sm:rounded-3xl p-4 sm:p-5 mb-5 lg:mb-6`} style={theme.cardGlass}>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.15em] ${theme.textFaint}`}>
            SHOWING {selectedId === null ? "ALL TEAM" : filtered.find(e => e.id === selectedId)?.name?.toUpperCase() || ""}
          </p>
          <h3 className={`text-sm sm:text-base font-black ${theme.text}`}>Performance</h3>
        </div>

        {/* Role filter tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {ROLE_TABS.map(tab => {
            const isActive = roleFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => onRoleFilterChange(tab.value)}
                className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all cursor-pointer ${
                  isActive
                    ? isDark
                      ? "bg-[#9E217B]/30 text-[#d946a8] ring-1 ring-[#9E217B]/40"
                      : "bg-[#9E217B]/10 text-[#9E217B] ring-1 ring-[#9E217B]/30"
                    : isDark
                      ? "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}

          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-1 ${
            isDark ? "bg-[#9E217B]/20 text-[#d946a8]" : "bg-pink-100 text-[#9E217B]"
          }`}>
            {totalCount}
          </span>
        </div>
      </div>

      {/* Employee chips row */}
      <div className="relative">
        {/* Scroll left arrow */}
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-colors cursor-pointer ${
            isDark ? "bg-[#1a1a1a] text-white/60 hover:text-white" : "bg-white text-slate-400 hover:text-slate-700"
          }`}
          style={{ display: filtered.length > 5 ? undefined : "none" }}
        >
          <FaChevronLeft className="w-2.5 h-2.5" />
        </button>

        <div
          ref={scrollRef}
          className="flex items-center gap-3 overflow-x-auto pb-1 px-1 scrollbar-none scroll-smooth"
        >
          {/* All Team chip */}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex flex-col items-center gap-1 shrink-0 group cursor-pointer"
          >
            <div
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-black text-xs shadow-md transition-all ${
                selectedId === null ? "ring-2 ring-offset-2 ring-[#9E217B]" : "opacity-70 group-hover:opacity-100"
              }`}
              style={{
                background: "linear-gradient(135deg, #9E217B, #d946a8)",
                ...(isDark ? { ringOffsetColor: "#0a0a0f" } : {}),
              }}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
            </div>
            <span className={`text-[9px] sm:text-[10px] font-bold ${
              selectedId === null
                ? isDark ? "text-[#d946a8]" : "text-[#9E217B]"
                : theme.textMuted
            }`}>
              All team
            </span>
          </button>

          {/* Individual employees */}
          {filtered.map((emp, i) => {
            const isSelected = selectedId === emp.id;
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
            const initials = (emp.name || "?")
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            return (
              <button
                key={emp.id}
                type="button"
                onClick={() => onSelect(emp.id)}
                className="flex flex-col items-center gap-1 shrink-0 group cursor-pointer"
              >
                <div
                  className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-black text-xs shadow-md transition-all ${
                    isSelected
                      ? "ring-2 ring-offset-2 ring-[#9E217B]"
                      : "opacity-70 group-hover:opacity-100"
                  }`}
                  style={{
                    background: color,
                    ...(isDark && isSelected ? { ringOffsetColor: "#0a0a0f" } : {}),
                  }}
                >
                  {initials}
                </div>
                <span
                  className={`text-[9px] sm:text-[10px] font-semibold max-w-[56px] truncate ${
                    isSelected
                      ? isDark ? "text-[#d946a8]" : "text-[#9E217B]"
                      : theme.textMuted
                  }`}
                >
                  {emp.name?.split(" ")[0] || "?"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scroll right arrow */}
        <button
          type="button"
          onClick={() => scrollBy(1)}
          className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-colors cursor-pointer ${
            isDark ? "bg-[#1a1a1a] text-white/60 hover:text-white" : "bg-white text-slate-400 hover:text-slate-700"
          }`}
          style={{ display: filtered.length > 5 ? undefined : "none" }}
        >
          <FaChevronRight className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}
