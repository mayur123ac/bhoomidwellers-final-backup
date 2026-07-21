"use client";
// PddChecklist.tsx — Phase D5. Post-Disbursement Documents tracker, shown once a
// loan is fully disbursed. The checklist is auto-seeded server-side when the final
// tranche lands (Phase C4); this component seeds on demand too if it's still empty.
import React, { useCallback, useEffect, useState } from "react";
import { FaCheck } from "react-icons/fa";

interface PddRow {
  id: number;
  document_name: string;
  required_by_date: string | null;
  submitted: boolean;
  submitted_date: string | null;
  submitted_to: string | null;
  acknowledgement_no: string | null;
}

interface Props {
  bookingId: number | string | null;
  userName: string;
  userRole: string;
  isDark: boolean;
  t: any;
  disbursementDate?: string | null;
}

const fmt = (d: string | null) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return d; }
};

export default function PddChecklist({ bookingId, userName, userRole, isDark, t, disbursementDate }: Props) {
  const [rows, setRows] = useState<PddRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canManage = ["admin", "sales manager", "sales_manager", "site_head", "site head"].includes((userRole || "").trim().toLowerCase());

  const load = useCallback(async () => {
    if (!bookingId) return;
    try {
      const res = await fetch(`/api/booking-applications/${bookingId}/pdd`);
      const json = await res.json();
      if (json.success) {
        // Empty + allowed → seed the standard checklist, then reload.
        if ((json.data || []).length === 0 && canManage) {
          const seedRes = await fetch(`/api/booking-applications/${bookingId}/pdd`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_name: userName, user_role: userRole, disbursement_date: disbursementDate || null }),
          });
          const seedJson = await seedRes.json();
          if (seedJson.success) { setRows(seedJson.data); return; }
        }
        setRows(json.data);
      }
    } catch { /* non-blocking */ }
  }, [bookingId, canManage, userName, userRole, disbursementDate]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (row: PddRow) => {
    if (!canManage || busyId) return;
    setBusyId(row.id);
    try {
      const next = !row.submitted;
      const res = await fetch(`/api/booking-applications/${bookingId}/pdd/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submitted: next,
          submitted_date: next ? new Date().toISOString().split("T")[0] : null,
          user_name: userName, user_role: userRole,
        }),
      });
      const json = await res.json();
      if (json.success) setRows(prev => prev.map(r => (r.id === row.id ? json.data : r)));
    } finally { setBusyId(null); }
  };

  if (!bookingId) {
    return (
      <div className={`rounded-lg p-3 text-xs ${t.innerBlock} ${t.textMuted}`}>
        Post-disbursement documents become trackable once a booking is created for this lead.
      </div>
    );
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div>
      <p className={`text-[11px] mb-2.5 ${t.textFaint}`}>
        Due within 30 days of full disbursement — late submission may trigger bank penalty interest.
      </p>
      <div className={`rounded-lg border divide-y ${t.innerBlock}`}>
        {rows.length === 0 ? (
          <p className={`px-3 py-2.5 text-xs italic ${t.textFaint}`}>Checklist not seeded yet.</p>
        ) : rows.map(r => {
          const overdue = !r.submitted && r.required_by_date != null && String(r.required_by_date).split("T")[0] < today;
          return (
            <div key={r.id} className="flex items-center justify-between px-3 py-2.5 gap-2">
              <button
                type="button"
                onClick={() => toggle(r)}
                disabled={!canManage || busyId === r.id}
                className="flex items-center gap-2 min-w-0 text-left disabled:opacity-60"
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${r.submitted ? "bg-green-500 border-green-500" : `${t.innerBlock} border-gray-400`}`}>
                  {r.submitted && <FaCheck className="text-white text-[8px]" />}
                </span>
                <span className={`text-xs font-medium truncate ${t.text}`}>{r.document_name}</span>
              </button>
              <span className={`text-[10px] font-semibold flex-shrink-0 ${r.submitted ? "text-green-500" : overdue ? "text-red-500" : t.textMuted}`}>
                {r.submitted ? `Submitted ${fmt(r.submitted_date)}` : `Due ${fmt(r.required_by_date)}${overdue ? " ⚠" : ""}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
