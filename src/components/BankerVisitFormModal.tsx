"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FaTimes, FaUniversity } from "react-icons/fa";
import SearchableSelect, { SelectOption } from "./SearchableSelect";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (data: any) => void;
  user: { name: string; role: string; _id?: string };
  isDark: boolean;
  t: any;
}

const blankForm = {
  banker_name: "",
  contact_number: "",
  bank_name: "",
  branch_name: "",
  designation: "",
  reporting_manager: "",
  assigned_sales_manager_id: "",
  attended_by_name: "",
};

export default function BankerVisitFormModal({
  isOpen,
  onClose,
  onSaved,
  user,
  isDark,
  t,
}: Props) {
  const [form, setForm] = useState({ ...blankForm });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sales Manager lookup
  const [salesManagers, setSalesManagers] = useState<any[]>([]);
  const [smLoading, setSmLoading] = useState(false);

  const fetchSalesManagers = useCallback(async () => {
    setSmLoading(true);
    try {
      const res = await fetch("/api/users/sales-manager");
      if (res.ok) {
        const json = await res.json();
        if (json.success) setSalesManagers(json.data || []);
      }
    } catch {
      /* silent */
    } finally {
      setSmLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSalesManagers();
      setForm({ ...blankForm, attended_by_name: user?.name || "" });
      setError(null);
    }
  }, [isOpen, fetchSalesManagers]);

  const smOptions: SelectOption[] = useMemo(
    () =>
      salesManagers.map((m: any) => ({
        value: String(m.id),
        label: m.name,
        sublabel: `ID ${m.id}${m.username ? ` \u00b7 ${m.username}` : ""}${m.phone ? ` \u00b7 ${m.phone}` : ""}`,
        keywords: `${m.username || ""} ${m.phone || ""} ${m.email || ""}`,
      })),
    [salesManagers]
  );

  const set = (patch: Partial<typeof blankForm>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (
      !form.banker_name.trim() ||
      !form.contact_number.trim() ||
      !form.bank_name.trim() ||
      !form.branch_name.trim() ||
      !form.designation.trim()
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        banker_name: form.banker_name.trim(),
        contact_number: form.contact_number.trim(),
        bank_name: form.bank_name.trim(),
        branch_name: form.branch_name.trim(),
        designation: form.designation.trim(),
        reporting_manager: form.reporting_manager.trim() || null,
        attended_by_name: form.attended_by_name.trim() || undefined,
      };
      if (form.assigned_sales_manager_id) {
        payload.assigned_sales_manager_id = Number(
          form.assigned_sales_manager_id
        );
      }

      const res = await fetch("/api/banker-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || "Failed to save banker visit.");
        return;
      }

      onSaved?.(json.data);
      onClose();
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const inputCls = `w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-all ${
    isDark
      ? "bg-[#1C1C1E] text-white placeholder-gray-500 border border-white/10 focus:border-[#9E217B]/50 focus:bg-[#2C2C2E]"
      : "bg-black/5 text-black placeholder-gray-400 border border-black/5 focus:border-[#9E217B]/40 focus:bg-white"
  }`;

  const labelCls = `block text-[11px] uppercase tracking-wider font-bold mb-1.5 ${t.textMuted}`;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg max-h-[90vh] flex flex-col rounded-[2rem] shadow-2xl overflow-hidden ${
          isDark
            ? "bg-[#1C1C1E]/95 border border-white/10 backdrop-blur-3xl"
            : "bg-white/95 border border-black/5 backdrop-blur-3xl"
        }`}
      >
        {/* Header */}
        <div className={`px-6 pt-5 pb-3 border-b ${t.tableBorder}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FaUniversity className={`text-lg ${t.accentText}`} />
              <div>
                <h2
                  className={`text-base font-bold tracking-tight ${t.text}`}
                >
                  Banker Visit
                </h2>
                <p className={`text-[11px] ${t.textFaint}`}>
                  Record a banker visiting the office
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-full cursor-pointer transition-colors ${
                isDark ? "hover:bg-white/10" : "hover:bg-black/5"
              } ${t.textMuted}`}
            >
              <FaTimes />
            </button>
          </div>
        </div>

        {/* Body */}
        <form
          id="bankerVisitForm"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar"
        >
          <div className="space-y-4">
            {/* Banker Name */}
            <div>
              <label className={labelCls}>
                Banker Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.banker_name}
                onChange={(e) => set({ banker_name: e.target.value })}
                placeholder="Enter banker name"
                className={inputCls}
                required
              />
            </div>

            {/* Contact Number */}
            <div>
              <label className={labelCls}>
                Contact Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                value={form.contact_number}
                onChange={(e) => set({ contact_number: e.target.value })}
                placeholder="Enter contact number"
                className={inputCls}
                required
              />
            </div>

            {/* Bank Name + Branch Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  Bank Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.bank_name}
                  onChange={(e) => set({ bank_name: e.target.value })}
                  placeholder="e.g. HDFC Bank"
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>
                  Branch Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.branch_name}
                  onChange={(e) => set({ branch_name: e.target.value })}
                  placeholder="e.g. Andheri West"
                  className={inputCls}
                  required
                />
              </div>
            </div>

            {/* Designation */}
            <div>
              <label className={labelCls}>
                Designation <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.designation}
                onChange={(e) => set({ designation: e.target.value })}
                placeholder="e.g. Branch Manager"
                className={inputCls}
                required
              />
            </div>

            {/* Reporting Manager */}
            <div>
              <label className={labelCls}>Reporting Manager</label>
              <input
                type="text"
                value={form.reporting_manager}
                onChange={(e) => set({ reporting_manager: e.target.value })}
                placeholder="Optional"
                className={inputCls}
              />
            </div>

            {/* Assign Sales Manager */}
            <div>
              <label className={labelCls}>Assign to Sales Manager</label>
              {smLoading ? (
                <p className={`text-[11px] ${t.textFaint}`}>
                  Loading Sales Managers...
                </p>
              ) : (
                <SearchableSelect
                  value={form.assigned_sales_manager_id}
                  onChange={(v) => set({ assigned_sales_manager_id: v })}
                  options={smOptions}
                  isDark={isDark}
                  t={t}
                  placeholder="Select a Sales Manager..."
                  emptyMessage="No active Sales Managers"
                  ariaLabel="Assign Sales Manager"
                />
              )}
              <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                Optional. The banker visit will appear in the assigned Sales
                Manager's Banking Info tab.
              </p>
            </div>

            {/* Attended By (prefilled with logged-in user, editable) */}
            <div>
              <label className={labelCls}>Attended By</label>
              <input
                type="text"
                value={form.attended_by_name}
                onChange={(e) => set({ attended_by_name: e.target.value })}
                placeholder="Name of the person attending"
                className={inputCls}
              />
              <p className={`text-[10px] mt-1 ${t.textFaint}`}>
                Pre-filled with your name. Change if another receptionist attended.
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-xs bg-red-500/10 border border-red-500/25 text-red-500">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div
          className={`px-6 py-4 border-t flex flex-col-reverse sm:flex-row justify-end gap-2.5 ${t.tableBorder}`}
        >
          <button
            onClick={onClose}
            type="button"
            className={`px-5 py-2.5 rounded-full text-[14px] font-medium cursor-pointer transition-colors ${
              isDark
                ? "text-gray-300 hover:bg-white/[0.06]"
                : "text-gray-600 hover:bg-black/[0.04]"
            }`}
          >
            Cancel
          </button>
          <button
            form="bankerVisitForm"
            type="submit"
            disabled={submitting}
            className={`px-6 py-2.5 rounded-full text-[14px] font-semibold text-white bg-blue-500 transition-all ${
              submitting
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer hover:bg-blue-600 active:scale-[0.98]"
            }`}
          >
            {submitting ? "Saving..." : "Save Banker Visit"}
          </button>
        </div>
      </div>
    </div>
  );
}
