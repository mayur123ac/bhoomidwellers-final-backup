"use client";

/**
 * HRCharts.tsx
 * Recharts chart components for the HR Phase 1 Dashboard.
 * Loaded via next/dynamic (ssr:false) from page.tsx — mirrors AdminDashboardCharts pattern.
 *
 * Charts included:
 *   Overview section:
 *     A. Attendance Trend     — LineChart  (Present / Absent over N days)
 *     B. Today's Workforce    — PieChart   (Present / Absent / On Leave)
 *     C. Workforce by Role    — BarChart   (headcount per role)
 *     D. Live Workforce       — PieChart   (Active / Idle / Offline / Logged Out)
 *   Analytics section:
 *     E. Working Hours        — BarChart   (avg hrs by role)
 *     F. Attendance by Role   — BarChart   (stacked Present + Absent)
 */

import { useMemo } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip as ReTooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Colour tokens ──────────────────────────────────────────────────────────
const C = {
  present:   "#10B981",
  absent:    "#F43F5E",
  on_leave:  "#F59E0B",
  active:    "#10B981",
  idle:      "#F59E0B",
  offline:   "#6B7280",
  logged_out:"#3B82F6",
  hours:     "#6366F1",
  role1:     "#10B981",
  role2:     "#3B82F6",
  role3:     "#F59E0B",
  role4:     "#EC4899",
};
const ROLE_COLORS = [C.role1, C.role2, C.role3, C.role4];

// ─── Tooltip wrappers ───────────────────────────────────────────────────────
function Tooltip({ isDark, children }: { isDark: boolean; children?: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-3 py-2 shadow-xl text-xs border ${isDark ? "bg-[#2C2C2E] border-[#38383A] text-white" : "bg-white border-[#E5E5EA] text-[#1D1D1F]"}`}>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label, isDark }: any) {
  if (!active || !payload?.length) return null;
  return (
    <Tooltip isDark={isDark}>
      <p className="font-bold mb-1">{label}</p>
      {payload.map((e: any) => (
        <p key={e.name} style={{ color: e.color }} className="font-medium">
          {e.name}: {e.value}
        </p>
      ))}
    </Tooltip>
  );
}

function PieTooltip({ active, payload, isDark }: any) {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <Tooltip isDark={isDark}>
      <p style={{ color: e.payload.fill }} className="font-bold">{e.name}</p>
      <p className="text-[11px]">{e.value}</p>
    </Tooltip>
  );
}

// ─── Chart wrapper card ──────────────────────────────────────────────────────
function ChartCard({ title, subtitle, isDark, children, minH = "h-64" }: {
  title: string; subtitle?: string; isDark: boolean; children: React.ReactNode; minH?: string;
}) {
  const card = isDark ? "bg-[#1C1C1E] border border-[#38383A]" : "bg-white border border-[#E5E5EA] shadow-sm";
  const tp   = isDark ? "text-white" : "text-[#1D1D1F]";
  const ts   = isDark ? "text-[#98989D]" : "text-[#86868B]";
  return (
    <div className={`rounded-3xl p-5 flex flex-col gap-4 ${card}`}>
      <div>
        <h3 className={`text-sm font-bold ${tp}`}>{title}</h3>
        {subtitle && <p className={`text-[11px] mt-0.5 ${ts}`}>{subtitle}</p>}
      </div>
      <div className={`w-full ${minH}`}>{children}</div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function Empty({ isDark }: { isDark: boolean }) {
  return (
    <div className={`flex items-center justify-center h-full text-xs font-medium ${isDark ? "text-[#48484A]" : "text-[#C7C7CC]"}`}>
      No data for this period
    </div>
  );
}

// ─── Axis tick style ──────────────────────────────────────────────────────────
function tickStyle(isDark: boolean) {
  return { fontSize: 11, fill: isDark ? "#98989D" : "#86868B" };
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface DashboardData {
  trendDays: number;
  attendanceTrend: { date: string; present: number; absent: number }[];
  todayWorkforce: { present: number; absent: number; on_leave: number };
  workforceByRole: { role: string; count: number }[];
  liveWorkforce: { active: number; idle: number; offline: number; logged_out: number };
  workingHoursByRole: { role: string; avgHours: number }[];
  attendanceByRole: { role: string; present: number; absent: number }[];
  liveTable: any[];
}

interface Props {
  section: "overview" | "analytics";
  data: DashboardData;
  trendDays: number;
  isDark: boolean;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function HRCharts({ section, data, trendDays, isDark }: Props) {
  // Shorten dates for trend axis
  const trendData = useMemo(
    () =>
      data.attendanceTrend.map((r) => ({
        ...r,
        label: new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      })),
    [data.attendanceTrend]
  );

  // Donut data
  const todayPie = useMemo(() => [
    { name: "Present",  value: data.todayWorkforce.present,  fill: C.present  },
    { name: "Absent",   value: data.todayWorkforce.absent,   fill: C.absent   },
    { name: "On Leave", value: data.todayWorkforce.on_leave, fill: C.on_leave },
  ].filter((d) => d.value > 0), [data.todayWorkforce]);

  const livePie = useMemo(() => [
    { name: "Active",     value: data.liveWorkforce.active,     fill: C.active     },
    { name: "Idle",       value: data.liveWorkforce.idle,       fill: C.idle       },
    { name: "Offline",    value: data.liveWorkforce.offline,    fill: C.offline    },
    { name: "Logged Out", value: data.liveWorkforce.logged_out, fill: C.logged_out },
  ].filter((d) => d.value > 0), [data.liveWorkforce]);

  if (section === "overview") {
    return (
      <div className="grid md:grid-cols-2 gap-6">
        {/* A. Attendance Trend */}
        <div className="md:col-span-2">
          <ChartCard
            title="Attendance Trend"
            subtitle={`Last ${trendDays} days — Present vs Absent`}
            isDark={isDark}
            minH="h-64"
          >
            {trendData.length === 0 ? <Empty isDark={isDark} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                  <XAxis dataKey="label" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                  <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                  <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px", marginTop: "8px" }} />
                  <Line type="monotone" dataKey="present" name="Present" stroke={C.present} strokeWidth={2.5} dot={{ r: 3, fill: C.present }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="absent"  name="Absent"  stroke={C.absent}  strokeWidth={2.5} dot={{ r: 3, fill: C.absent  }} activeDot={{ r: 5 }} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* B. Today's Workforce */}
        <ChartCard title="Today's Workforce" subtitle="Present / Absent / On Leave" isDark={isDark}>
          {todayPie.length === 0 ? <Empty isDark={isDark} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={todayPie} cx="50%" cy="45%" innerRadius="50%" outerRadius="72%" paddingAngle={3} dataKey="value">
                  {todayPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <ReTooltip content={<PieTooltip isDark={isDark} />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* C. Workforce by Role */}
        <ChartCard title="Workforce by Role" subtitle="Headcount — Sales, Sourcing Manager, Receptionist, Site Head" isDark={isDark}>
          {data.workforceByRole.every((r) => r.count === 0) ? <Empty isDark={isDark} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.workforceByRole} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                <XAxis dataKey="role" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                <Bar dataKey="count" name="Employees" radius={[6, 6, 0, 0]}>
                  {data.workforceByRole.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* D. Live Workforce */}
        <div className="md:col-span-2">
          <ChartCard title="Live Workforce" subtitle="Current session states — Active / Idle / Offline / Logged Out" isDark={isDark}>
            {livePie.length === 0 ? <Empty isDark={isDark} /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={livePie} cx="50%" cy="45%" innerRadius="45%" outerRadius="70%" paddingAngle={3} dataKey="value">
                    {livePie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <ReTooltip content={<PieTooltip isDark={isDark} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    );
  }

  // ── Analytics section ────────────────────────────────────────────────────
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* E. Working Hours by Role */}
      <div className="md:col-span-2">
        <ChartCard title="Working Hours by Role" subtitle="Average hours logged today per role group" isDark={isDark}>
          {data.workingHoursByRole.every((r) => r.avgHours === 0) ? <Empty isDark={isDark} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.workingHoursByRole} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                <XAxis dataKey="role" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} unit="h" />
                <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                <Bar dataKey="avgHours" name="Avg Hours" radius={[6, 6, 0, 0]}>
                  {data.workingHoursByRole.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* F. Attendance by Role */}
      <div className="md:col-span-2">
        <ChartCard title="Attendance by Role" subtitle="Present vs Absent across role groups — today" isDark={isDark}>
          {data.attendanceByRole.every((r) => r.present === 0 && r.absent === 0) ? <Empty isDark={isDark} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.attendanceByRole} margin={{ left: -8, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#2C2C2E" : "#F5F5F7"} />
                <XAxis dataKey="role" tick={tickStyle(isDark)} tickLine={false} axisLine={false} />
                <YAxis tick={tickStyle(isDark)} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReTooltip content={<CustomTooltip isDark={isDark} />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="present" name="Present" stackId="a" fill={C.present} radius={[0, 0, 0, 0]} />
                <Bar dataKey="absent"  name="Absent"  stackId="a" fill={C.absent}  radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
