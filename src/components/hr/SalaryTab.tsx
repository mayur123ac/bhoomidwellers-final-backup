"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

// ── Types ───────────────────────────────────────────────────────────────────
interface CurrentSalary {
  baseSalary: number;
  effectiveFrom: string;
  revisionReason: string | null;
}

interface LatestPay {
  periodYear: number;
  periodMonth: number;
  netPayable: number;
  totalPaid: number;
  outstanding: number;
  status: string;
  periodStatus: string;
}

interface PayrollRecord {
  id: number;
  periodYear: number;
  periodMonth: number;
  baseSalary: number;
  grossSalary: number;
  totalAdditions: number;
  totalDeductions: number;
  netPayable: number;
  incentiveTotal: number;
  status: string;
  totalPaid: number;
  outstanding: number;
}

interface SalaryHistoryEntry {
  baseSalary: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  revisionReason: string | null;
}

interface CompensationData {
  year: number;
  currentSalary: CurrentSalary | null;
  salaryHistory: SalaryHistoryEntry[];
  latestPay: LatestPay | null;
  payrollRecords: PayrollRecord[];
  incentiveSummary: Record<string, { count: number; total: number }>;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function inr(n: number) {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

// ── Main Component ──────────────────────────────────────────────────────────
export default function SalaryTab({ isDark }: { isDark: boolean }) {
  const router = useRouter();

  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const textPri = isDark ? "text-white" : "text-[#1D1D1F]";
  const textSec = isDark ? "text-[#98989D]" : "text-[#86868B]";
  const inputCls = `w-full rounded-xl px-3 py-2.5 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white placeholder:text-[#636366]" : "bg-white border-[#D1D1D6] text-[#1D1D1F] placeholder:text-[#AEAEB2]"}`;
  const btnPrimary = `px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${isDark ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-700 text-white"}`;
  const btnSecondary = `px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${isDark ? "border-[#38383A] text-[#98989D] hover:border-[#58585A]" : "border-[#D1D1D6] text-[#86868B] hover:border-[#AEAEB2]"}`;

  // ── State ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<"overview" | "verifying" | "detailed">("overview");
  const [salaryToken, setSalaryToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number>(0);

  // Verify modal
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Compensation data
  const [data, setData] = useState<CompensationData | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataYear, setDataYear] = useState(new Date().getFullYear());

  // ── Verify password ───────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!password.trim()) {
      setVerifyError("Please enter your password.");
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch("/api/me/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await res.json();
      if (!res.ok) {
        setVerifyError(j.message || "Verification failed.");
        return;
      }
      const token = j.salaryViewToken;
      const expiresAt = Date.now() + (j.expiresInSeconds || 300) * 1000;
      setSalaryToken(token);
      setTokenExpiresAt(expiresAt);
      setPassword("");
      setPhase("detailed");
      // Fetch compensation data
      fetchCompensation(token, dataYear);
    } catch (e: any) {
      setVerifyError(e.message || "Network error.");
    } finally {
      setVerifying(false);
    }
  };

  // ── Fetch compensation ────────────────────────────────────────────────────
  const fetchCompensation = useCallback(async (token: string, year: number) => {
    setDataLoading(true);
    setDataError(null);
    try {
      const res = await fetch(`/api/me/compensation?year=${year}`, {
        headers: { "x-salary-token": token },
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.code === "SALARY_AUTH_REQUIRED" || j.code === "SALARY_AUTH_INVALID") {
          // Token expired or invalid — go back to verify
          setPhase("overview");
          setSalaryToken(null);
          setDataError("Session expired. Please verify your password again.");
          return;
        }
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      setData(j.data);
      setDataYear(j.data.year);
    } catch (e: any) {
      setDataError(e.message);
    } finally {
      setDataLoading(false);
    }
  }, []);

  const handleYearChange = (year: number) => {
    if (!salaryToken || Date.now() > tokenExpiresAt) {
      setPhase("overview");
      setSalaryToken(null);
      setDataError("Session expired. Please verify your password again.");
      return;
    }
    setDataYear(year);
    fetchCompensation(salaryToken, year);
  };

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = data?.payrollRecords
    .slice()
    .sort((a, b) => a.periodMonth - b.periodMonth)
    .map((r) => ({
      month: MONTHS[r.periodMonth - 1],
      "Base Salary": r.baseSalary,
      Additions: r.totalAdditions,
      Deductions: r.totalDeductions,
      "Net Pay": r.netPayable,
    })) || [];

  // ── OVERVIEW PHASE ────────────────────────────────────────────────────────
  if (phase === "overview" || phase === "verifying") {
    return (
      <div className="space-y-6">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
            Compensation
          </p>
          <h2 className={`text-xl font-black ${textPri}`}>My Salary</h2>
          <p className={`text-sm mt-0.5 ${textSec}`}>Click to verify your identity and view details</p>
        </div>

        {dataError && (
          <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium">
            {dataError}
          </div>
        )}

        {/* Salary overview card */}
        <button
          onClick={() => setPhase("verifying")}
          className={`w-full text-left rounded-2xl p-6 transition-all cursor-pointer hover:scale-[1.01] ${card}`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Salary</p>
          <p className={`text-3xl font-black ${textPri}`}>
            <span className={isDark ? "text-[#48484A]" : "text-[#D1D1D6]"}>Tap to reveal</span>
          </p>
          <p className={`text-xs mt-2 ${textSec}`}>Password verification required</p>
        </button>

        {/* Your Pay card */}
        <button
          onClick={() => setPhase("verifying")}
          className={`w-full text-left rounded-2xl p-6 transition-all cursor-pointer hover:scale-[1.01] ${card}`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Pay</p>
          <p className={`text-3xl font-black ${textPri}`}>
            <span className={isDark ? "text-[#48484A]" : "text-[#D1D1D6]"}>Tap to reveal</span>
          </p>
          <p className={`text-xs mt-2 ${textSec}`}>View your latest payslip and payment details</p>
        </button>

        {/* Verification modal */}
        {phase === "verifying" && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className={`w-full max-w-md rounded-3xl p-6 space-y-5 ${isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-2xl"}`}>
              <div>
                <h3 className={`text-lg font-black ${textPri}`}>Verify Your Identity</h3>
                <p className={`text-sm mt-1 ${textSec}`}>
                  Enter your CRM login password to view your detailed salary information.
                </p>
              </div>

              {verifyError && (
                <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
                  {verifyError}
                </div>
              )}

              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                  placeholder="Enter your password"
                  className={inputCls}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold cursor-pointer ${textSec}`}
                  tabIndex={-1}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className={btnPrimary}
                >
                  {verifying ? "Verifying..." : "Continue"}
                </button>
                <button
                  onClick={() => { setPhase("overview"); setPassword(""); setVerifyError(null); }}
                  className={btnSecondary}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── DETAILED PHASE ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 text-emerald-${isDark ? "400" : "600"}`}>
            Compensation
          </p>
          <h2 className={`text-xl font-black ${textPri}`}>My Salary Details</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={dataYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className={`rounded-xl px-3 py-2 text-sm border outline-none ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#D1D1D6] text-[#1D1D1F]"}`}
          >
            {[0, 1, 2].map((offset) => {
              const y = new Date().getFullYear() - offset;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
          <button onClick={() => { setPhase("overview"); setSalaryToken(null); setData(null); }} className={btnSecondary}>
            Lock
          </button>
        </div>
      </div>

      {dataError && (
        <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium">
          {dataError}
        </div>
      )}

      {dataLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`rounded-2xl animate-pulse h-24 ${isDark ? "bg-[#1C1C1E]" : "bg-gray-100"}`} />
          ))}
        </div>
      ) : !data ? (
        <div className={`rounded-2xl p-8 text-center ${card}`}>
          <p className={textSec}>No compensation data available.</p>
        </div>
      ) : (
        <>
          {/* A. Current Compensation Card */}
          <div className={`rounded-2xl p-6 ${card}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>
              Current Monthly Salary
            </p>
            {data.currentSalary ? (
              <>
                <p className={`text-3xl font-black ${textPri}`}>
                  {inr(data.currentSalary.baseSalary)}
                  <span className={`text-sm font-medium ml-2 ${textSec}`}>/ month</span>
                </p>
                <p className={`text-xs mt-2 ${textSec}`}>
                  Effective from {new Date(data.currentSalary.effectiveFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  {data.currentSalary.revisionReason && ` — ${data.currentSalary.revisionReason}`}
                </p>
              </>
            ) : (
              <p className={`text-sm ${textSec}`}>No salary configured. Contact HR.</p>
            )}
          </div>

          {/* Your Pay card */}
          {data.latestPay ? (
            <div className={`rounded-2xl p-6 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>
                Your Pay — {MONTHS[data.latestPay.periodMonth - 1]} {data.latestPay.periodYear}
              </p>
              <div className="flex items-baseline gap-4 flex-wrap">
                <p className={`text-3xl font-black text-emerald-${isDark ? "400" : "600"}`}>
                  {inr(data.latestPay.netPayable)}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  data.latestPay.status === "approved"
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                }`}>
                  {data.latestPay.periodStatus}
                </span>
              </div>
              <div className={`mt-3 flex gap-6 text-xs ${textSec}`}>
                <span>Paid: <strong className={textPri}>{inr(data.latestPay.totalPaid)}</strong></span>
                {data.latestPay.outstanding > 0 && (
                  <span>Outstanding: <strong className="text-amber-400">{inr(data.latestPay.outstanding)}</strong></span>
                )}
              </div>
            </div>
          ) : (
            <div className={`rounded-2xl p-6 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${textSec}`}>Your Pay</p>
              <p className={`text-sm ${textSec}`}>No finalized payroll available for {dataYear}.</p>
            </div>
          )}

          {/* B. Salary + Incentive Graph */}
          {chartData.length > 0 && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-4 ${textSec}`}>
                Monthly Compensation — {dataYear}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} barCategoryGap="20%">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? "#2C2C2E" : "#E5E5EA"}
                  />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: isDark ? "#98989D" : "#86868B" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: isDark ? "#98989D" : "#86868B" }}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#1C1C1E" : "#fff",
                      border: `1px solid ${isDark ? "#38383A" : "#E5E5EA"}`,
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(value) => inr(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Base Salary" fill={isDark ? "#3B82F6" : "#2563EB"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Additions" fill={isDark ? "#34D399" : "#059669"} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Deductions" fill={isDark ? "#F87171" : "#DC2626"} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* C. Monthly Payroll History */}
          {data.payrollRecords.length > 0 && (
            <div className={`rounded-2xl overflow-hidden border ${isDark ? "border-[#38383A]" : "border-[#E5E5EA]"}`}>
              <div className={`px-5 py-3 ${isDark ? "bg-[#1C1C1E]" : "bg-[#F5F5F7]"}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>
                  Monthly Payroll History
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={isDark ? "bg-[#1C1C1E] text-[#98989D]" : "bg-[#F5F5F7] text-[#86868B]"}>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Period</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Base</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Additions</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Deductions</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Net</th>
                      <th className="text-right text-[10px] font-bold uppercase tracking-wider px-4 py-3">Paid</th>
                      <th className="text-left text-[10px] font-bold uppercase tracking-wider px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payrollRecords.map((r, i) => (
                      <tr key={r.id} className={`border-t ${isDark ? "border-[#2C2C2E]" : "border-[#F5F5F7]"} ${
                        i % 2 === 0 ? (isDark ? "bg-[#0A0A0A]" : "bg-white") : (isDark ? "bg-[#111]" : "bg-[#FAFAFA]")
                      }`}>
                        <td className={`px-4 py-3 font-semibold text-xs ${textPri}`}>
                          {MONTHS[r.periodMonth - 1]} {r.periodYear}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${textSec}`}>{inr(r.baseSalary)}</td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalAdditions > 0 ? "text-emerald-400" : textSec}`}>
                          {r.totalAdditions > 0 ? `+${inr(r.totalAdditions)}` : "—"}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalDeductions > 0 ? "text-red-400" : textSec}`}>
                          {r.totalDeductions > 0 ? `-${inr(r.totalDeductions)}` : "—"}
                        </td>
                        <td className={`px-4 py-3 text-right text-xs font-mono font-semibold ${textPri}`}>{inr(r.netPayable)}</td>
                        <td className={`px-4 py-3 text-right text-xs font-mono ${r.totalPaid > 0 ? "text-emerald-400" : textSec}`}>
                          {r.totalPaid > 0 ? inr(r.totalPaid) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            r.status === "approved"
                              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                              : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                          }`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* D. Incentives */}
          {(data.incentiveSummary.approved || data.incentiveSummary.paid) && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${textSec}`}>
                Incentives — {dataYear}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {data.incentiveSummary.approved && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Approved</p>
                    <p className={`text-lg font-black text-emerald-400`}>{inr(data.incentiveSummary.approved.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.approved.count} entries</p>
                  </div>
                )}
                {data.incentiveSummary.paid && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Paid</p>
                    <p className={`text-lg font-black ${textPri}`}>{inr(data.incentiveSummary.paid.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.paid.count} entries</p>
                  </div>
                )}
                {data.incentiveSummary.pending && (
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${textSec}`}>Pending Review</p>
                    <p className={`text-lg font-black text-amber-400`}>{inr(data.incentiveSummary.pending.total)}</p>
                    <p className={`text-xs ${textSec}`}>{data.incentiveSummary.pending.count} entries</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* E. Salary Revision History */}
          {data.salaryHistory && data.salaryHistory.length > 1 && (
            <div className={`rounded-2xl p-5 ${card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${textSec}`}>
                Salary Revision History
              </p>
              <div className="space-y-2">
                {data.salaryHistory.map((s: any, i: number) => (
                  <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-xl ${isDark ? "bg-[#2C2C2E]" : "bg-[#F5F5F7]"}`}>
                    <div>
                      <p className={`text-sm font-semibold ${textPri}`}>{inr(s.baseSalary)}</p>
                      <p className={`text-[10px] ${textSec}`}>
                        {new Date(s.effectiveFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {s.effectiveTo && ` — ${new Date(s.effectiveTo).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    {s.revisionReason && (
                      <p className={`text-xs ${textSec} max-w-[200px] text-right truncate`} title={s.revisionReason}>
                        {s.revisionReason}
                      </p>
                    )}
                    {i === 0 && !s.effectiveTo && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty states */}
          {data.payrollRecords.length === 0 && (
            <div className={`rounded-2xl p-8 text-center ${card}`}>
              <p className={`text-sm ${textSec}`}>No finalized payroll records for {dataYear}.</p>
              <p className={`text-xs mt-1 ${textSec}`}>Payroll records appear here after HR processes and approves them.</p>
            </div>
          )}

          {!data.incentiveSummary.approved && !data.incentiveSummary.paid && (
            <div className={`rounded-2xl p-6 text-center ${card}`}>
              <p className={`text-sm ${textSec}`}>No incentives recorded for {dataYear}.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
