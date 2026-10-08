"use client";

import React, { useEffect, useState } from "react";
import {
  FaPhoneAlt,
  FaMapMarkerAlt,
  FaHandshake,
  FaCheckCircle,
  FaBuilding,
  FaBullseye,
  FaChartBar,
  FaChevronRight
} from "react-icons/fa";
import { useCrmTheme } from "@/lib/hooks/useCrmTheme";
import { buildTheme } from "@/lib/crmTheme";

interface SalesManagerDashboardSummary {
  callsDue: number;
  visitsToday: number;
  inClosing: number;
  siteVisitsCompleted: {
    thisWeek: number;
    thisMonth: number;
  };
  salesClosed: {
    thisWeek: number;
    thisMonth: number;
  };
}

export default function SalesManagerDashboardSummary() {
  const { isDark } = useCrmTheme();
  const t = buildTheme(isDark);

  const [data, setData] = useState<SalesManagerDashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<boolean>(false);
  const [period, setPeriod] = useState("month");

  useEffect(() => {
    let mounted = true;
    async function fetchSummary() {
      try {
        setIsLoading(true);
        setError(false);
        const res = await fetch("/api/sales-manager/dashboard-summary");
        if (!res.ok) throw new Error("Failed to fetch");

        const json = await res.json();
        if (mounted) {
          setData(json);
        }
      } catch (err: any) {
        if (mounted) setError(true);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    fetchSummary();
    return () => { mounted = false; };
  }, []);

  if (error) {
    return (
      <div className={`w-full p-4 rounded-2xl border text-sm flex items-center justify-between ${isDark ? 'bg-red-950/30 border-red-900/50 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
        <span>Unable to load dashboard summary.</span>
        <button onClick={() => window.location.reload()} className="underline hover:no-underline font-semibold">Retry</button>
      </div>
    );
  }

  // Skeletons (Unchanged structure, subtly updated for the new card style)
  if (isLoading || !data) {
    return (
      <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className={`rounded-[2rem] p-6 border animate-pulse h-[340px] ${t.card}`} style={t.cardGlass}>
          <div className="flex gap-4 mb-6">
            <div className={`w-12 h-12 rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
            <div>
              <div className={`w-40 h-6 rounded-md mb-2 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
              <div className={`w-32 h-4 rounded-md ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
            </div>
          </div>
          <div className={`w-full h-40 rounded-2xl ${isDark ? 'bg-white/10' : 'bg-black/5'}`} />
        </div>
        <div className={`rounded-[2rem] p-6 border animate-pulse h-[340px] ${t.card}`} style={t.cardGlass}>
          <div className="flex gap-4 mb-6">
            <div className={`w-12 h-12 rounded-full ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
            <div>
              <div className={`w-40 h-6 rounded-md mb-2 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
              <div className={`w-32 h-4 rounded-md ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
            </div>
          </div>
          <div className="space-y-4">
            <div className={`w-full h-[68px] rounded-xl ${isDark ? 'bg-white/10' : 'bg-black/5'}`} />
            <div className={`w-full h-[68px] rounded-xl ${isDark ? 'bg-white/10' : 'bg-black/5'}`} />
          </div>
        </div>
      </div>
    );
  }

  // Custom colors derived from the image
  const magentaColor = "#B01A79";
  const innerBgClass = isDark ? "bg-slate-900/50 border-white/5" : "bg-white border-slate-100/50 shadow-sm";

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

      {/* CARD 1 — TODAY'S PRIORITIES */}
      <div
        className={`rounded-[2rem] p-5 sm:p-6 border relative overflow-hidden flex flex-col ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-[#FAFAFD] border-slate-200/60 shadow-sm'}`}
      >
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-sm shrink-0"
            style={{ backgroundColor: magentaColor }}
          >
            <FaBullseye size={20} />
          </div>
          <div>
            <h3 className={`text-[17px] sm:text-lg font-bold ${t.text}`}>Today's Priorities</h3>
            <p className={`text-[13px] ${t.textFaint}`}>What needs your attention</p>
          </div>
        </div>

        {/* List Group Container */}
        <div className={`rounded-2xl border flex flex-col flex-grow justify-center ${innerBgClass}`}>

          {/* Calls Due */}
          <div className="flex items-center justify-between p-4 border-b border-inherit">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center bg-pink-100 text-[#B01A79] dark:bg-[#B01A79]/20 dark:text-pink-400">
                <FaPhoneAlt size={14} />
              </div>
              <span className={`text-[15px] font-semibold ${t.text}`}>Calls Due</span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className="text-[22px] font-black"
                style={{ color: magentaColor }}
              >
                {data.callsDue}
              </span>
              <FaChevronRight size={14} className="text-slate-400" />
            </div>
          </div>

          {/* Visits Today */}
          <div className="flex items-center justify-between p-4 border-b border-inherit">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-100 text-[#1E77E4] dark:bg-blue-500/20 dark:text-blue-400">
                <FaMapMarkerAlt size={15} />
              </div>
              <span className={`text-[15px] font-semibold ${t.text}`}>Visits Today</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[22px] font-black text-[#1E77E4] dark:text-blue-500">
                {data.visitsToday}
              </span>
              <FaChevronRight size={14} className="text-slate-400" />
            </div>
          </div>

          {/* In Closing */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center bg-orange-100 text-[#F49A25] dark:bg-orange-500/20 dark:text-orange-400">
                <FaHandshake size={16} />
              </div>
              <span className={`text-[15px] font-semibold ${t.text}`}>In Closing</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[22px] font-black text-[#F49A25] dark:text-orange-400">
                {data.inClosing}
              </span>
              <FaChevronRight size={14} className="text-slate-400" />
            </div>
          </div>

        </div>
      </div>

      {/* CARD 2 — WORK COMPLETED */}
      <div
        className={`rounded-[2rem] p-5 sm:p-6 border relative overflow-hidden flex flex-col ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-[#FAFAFD] border-slate-200/60 shadow-sm'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#039953] flex items-center justify-center text-white shadow-sm shrink-0">
              <FaChartBar size={18} />
            </div>
            <div>
              <h3 className={`text-[17px] sm:text-lg font-bold ${t.text}`}>Work Completed</h3>
              <p className={`text-[13px] ${t.textFaint}`}>Your results and achievements</p>
            </div>
          </div>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border outline-none cursor-pointer ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-700 shadow-sm'}`}
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>

        <div className="flex flex-col space-y-4 flex-grow justify-center">

          {/* Site Visits Completed */}
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-2 px-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-100 text-[#039953] dark:bg-emerald-500/20 dark:text-emerald-400">
                <FaBuilding size={11} />
              </div>
              <span className={`text-[14px] font-bold ${t.text}`}>Site Visits Completed</span>
            </div>

            <div className={`flex items-center p-3 rounded-2xl border ${innerBgClass}`}>
              <div className="flex flex-col items-center justify-center w-1/2">
                <div className={`text-[12px] font-medium mb-1 ${t.textFaint}`}>This Week</div>
                <div className={`text-xl font-bold ${t.text}`}>{data.siteVisitsCompleted.thisWeek}</div>
              </div>
              <div className={`w-[1px] h-8 ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}></div>
              <div className="flex flex-col items-center justify-center w-1/2">
                <div className={`text-[12px] font-medium mb-1 ${t.textFaint}`}>This Month</div>
                <div className="text-xl font-bold text-[#039953] dark:text-emerald-400">{data.siteVisitsCompleted.thisMonth}</div>
              </div>
            </div>
          </div>

          {/* Sales Closed */}
          <div className="flex flex-col">
            <div className="flex items-center gap-3 mb-2 px-1">
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
                <FaCheckCircle size={13} />
              </div>
              <span className={`text-[14px] font-bold ${t.text}`}>Sales Closed</span>
            </div>

            <div className={`flex items-center p-3 rounded-2xl border ${innerBgClass}`}>
              <div className="flex flex-col items-center justify-center w-1/2">
                <div className={`text-[12px] font-medium mb-1 ${t.textFaint}`}>This Week</div>
                <div className={`text-xl font-bold ${t.text}`}>{data.salesClosed.thisWeek}</div>
              </div>
              <div className={`w-[1px] h-8 ${isDark ? 'bg-white/10' : 'bg-slate-200'}`}></div>
              <div className="flex flex-col items-center justify-center w-1/2">
                <div className={`text-[12px] font-medium mb-1 ${t.textFaint}`}>This Month</div>
                <div
                  className="text-xl font-bold"
                  style={{ color: magentaColor }}
                >
                  {data.salesClosed.thisMonth}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}