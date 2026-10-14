"use client";
// AdminCpChatWrapper — Sourcing Manager selection screen before CP Chat.
//
// When Admin opens CP Chat, they first pick a Sourcing Manager from a
// tenant-scoped list. After selection, the existing CpChatPanel renders
// with the partner list filtered to that manager's assigned partners.
//
// The wrapper does NOT touch the chat implementation — it only controls
// which partner-list URL CpChatPanel receives.

import React, { useState, useDeferredValue, useMemo } from "react";
import { FaSearch, FaUserTie } from "react-icons/fa";
import { IoChevronForwardOutline } from "react-icons/io5";
import { useCpResource } from "@/lib/hooks/useCpResource";
import CpChatPanel from "./CpChatPanel";

type SourcingManager = {
  id: number;
  name: string;
  username?: string;
  email?: string;
  phone?: string;
  presence?: "ONLINE" | "OFFLINE";
};

const NO_MANAGERS: SourcingManager[] = [];

export default function AdminCpChatWrapper({
  user, isDark, t,
}: { user: any; isDark: boolean; t: any }) {
  const [selectedMgr, setSelectedMgr] = useState<SourcingManager | null>(null);
  const [search, setSearch] = useState("");

  const {
    data: managers, loading, error, refetch,
  } = useCpResource<SourcingManager[]>("/api/users/sourcing-manager", { initial: NO_MANAGERS });

  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return managers;
    return managers.filter(m =>
      `${m.name || ""} ${m.email || ""} ${m.username || ""}`.toLowerCase().includes(q)
    );
  }, [managers, deferredSearch]);

  // Style tokens matching the CRM Apple UI
  const bgApp = isDark ? "bg-[#000000]" : "bg-[#F5F5F7]";
  const bgCard = isDark ? "bg-[#1C1C1E]" : "bg-white";
  const borderSubtle = isDark ? "border-[#38383A]" : "border-[#E5E5EA]";
  const textPrimary = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSecondary = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const bgSubtle = isDark ? "bg-[#2C2C2E]" : "bg-[#F2F2F7]";

  // ── Selected: render CpChatPanel with scoped partner list ──
  if (selectedMgr) {
    return (
      <CpChatPanel
        user={user}
        isDark={isDark}
        t={t}
        isAdmin
        partnerListUrl={`/api/channel-partners?assigned_sourcing_manager_id=${selectedMgr.id}`}
        headerLabel={`Sourcing Manager: ${selectedMgr.name}`}
        onBack={() => setSelectedMgr(null)}
      />
    );
  }

  // ── Selection screen ──
  return (
    <div className={`h-full flex flex-col ${bgApp} font-sans`}>
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <FaUserTie className={`text-lg ${isDark ? "text-[#9E217B]" : "text-[#9E217B]"}`} />
          <h2 className={`text-xl font-semibold tracking-tight ${textPrimary}`}>
            CP Chat
          </h2>
        </div>
        <p className={`text-[13px] mb-4 ${textSecondary}`}>
          Select a Sourcing Manager to view their channel partner conversations.
        </p>

        <label className="relative block">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FaSearch className={textSecondary} size={13} />
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className={`w-full max-w-md pl-9 pr-3 py-2.5 rounded-xl text-[14px] focus:outline-none transition-colors ${bgSubtle} ${textPrimary} placeholder:text-[#86868B]`}
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`rounded-2xl p-4 border ${borderSubtle} ${bgCard} animate-pulse`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${bgSubtle}`} />
                  <div className="flex-1 space-y-2">
                    <div className={`h-3.5 w-32 rounded ${bgSubtle}`} />
                    <div className={`h-3 w-48 rounded ${bgSubtle}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-red-500 text-sm">{error}</p>
            <button
              onClick={refetch}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-[#9E217B] text-white hover:bg-[#8A1C6B] transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FaUserTie className={`text-3xl mb-3 ${textSecondary}`} />
            <p className={`text-sm font-medium ${textPrimary}`}>
              {managers.length === 0 ? "No Sourcing Managers" : "No matches found"}
            </p>
            <p className={`text-xs mt-1 ${textSecondary}`}>
              {managers.length === 0
                ? "Add a Sourcing Manager in the Employee section first."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-w-2xl">
            {filtered.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMgr(m)}
                className={`w-full text-left rounded-2xl p-4 border transition-all cursor-pointer group ${borderSubtle} ${bgCard} ${isDark ? "hover:bg-[#2C2C2E]" : "hover:bg-[#F2F2F7]"}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-medium ${isDark ? "bg-[#2C2C2E] text-white" : "bg-[#E5E5EA] text-[#1D1D1F]"}`}>
                    {(m.name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-[15px] font-medium truncate ${textPrimary}`}>{m.name}</p>
                      {m.presence === "ONLINE" && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Online" />
                      )}
                    </div>
                    <p className={`text-[12px] truncate ${textSecondary}`}>
                      Sourcing Manager{m.email ? ` \u00B7 ${m.email}` : ""}
                    </p>
                  </div>
                  <IoChevronForwardOutline className={`text-sm flex-shrink-0 ${textSecondary} group-hover:translate-x-0.5 transition-transform`} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
