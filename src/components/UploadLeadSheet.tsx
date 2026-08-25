"use client";
// components/UploadLeadSheet.tsx
// Self-contained bulk Excel lead import: trigger button + modal with preview,
// optional "Assign To" dropdown, and confirm. Used by Admin & Site Head (mode="assign")
// and wrapped by SelfUploadLeadSheet for Sales Managers (mode="self").
import { useEffect, useRef, useState } from "react";
import { FaFileExcel, FaUpload, FaTimes, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";

type Mode = "assign" | "self";

const MAX_IMPORT_ROWS = 500;
const ROW_CAP_MESSAGE = "Please split into files of 500 rows or fewer.";

interface PreviewResult {
  validCount: number;
  errorCount: number;
  sampleRows: any[];
  errorRows: { rowNum: number; errors: string[]; raw: Record<string, any> }[];
}

interface Manager {
  id: number | string;
  name: string;
}

interface UploadLeadSheetProps {
  mode: Mode;
  isDark?: boolean;
  /** Called after a successful import so the parent can refetch leads. */
  onImported?: () => void;
  /** Extra classes for the trigger button (to match surrounding toolbar). */
  buttonClassName?: string;
  buttonLabel?: string;
}

const ENDPOINT = "/api/walkin_enquiries/bulk-import";

export default function UploadLeadSheet({
  mode,
  isDark = false,
  onImported,
  buttonClassName,
  buttonLabel = "Bulk Import",
}: UploadLeadSheetProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [siteHeads, setSiteHeads] = useState<Manager[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch sales managers + site heads for the Assign To dropdown (assign mode only).
  useEffect(() => {
    if (!open || mode !== "assign") return;
    fetch("/api/users/sales-manager")
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setManagers(data.data);
      })
      .catch(() => {});
    fetch("/api/users/site-head")
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && Array.isArray(data.data)) setSiteHeads(data.data);
      })
      .catch(() => {});
  }, [open, mode]);

  const resetState = () => {
    setFile(null);
    setPreview(null);
    setAssignTo("");
    setLoadingPreview(false);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeModal = () => {
    setOpen(false);
    resetState();
  };

  const runPreview = async (selected: File) => {
    setLoadingPreview(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      const res = await fetch(`${ENDPOINT}?preview=true`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: "error", msg: data.message || "Failed to read file." });
        setPreview(null);
      } else {
        const errorRows = data.errorRows || [];
        setPreview({
          validCount: data.validRows ?? 0,
          errorCount: errorRows.length,
          sampleRows: data.sample || [],
          errorRows,
        });
      }
    } catch (err: any) {
      setToast({ type: "error", msg: err.message || "Failed to read file." });
    } finally {
      setLoadingPreview(false);
    }
  };

  // Fast client-side row count so oversized files fail before any upload.
  //
  // PERF: xlsx is by far the heaviest dependency this component pulls in, and it
  // was reaching every dashboard that renders the import button — paid on first
  // paint by every operator, including the ones who never import a sheet. It is
  // only needed once a file has actually been chosen, and this function was
  // already async and already awaiting the file read, so loading it here costs
  // nothing that wasn't already a wait. Behaviour is unchanged.
  const countDataRows = async (selected: File): Promise<number> => {
    const buf = await selected.arrayBuffer();
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return 0;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
    }) as any[][];
    return Math.max(0, rows.length - 1); // exclude header
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setToast(null);
    setPreview(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!/\.xlsx$/i.test(selected.name)) {
      setToast({ type: "error", msg: "Only .xlsx files are supported." });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const dataRows = await countDataRows(selected);
      if (dataRows > MAX_IMPORT_ROWS) {
        setToast({ type: "error", msg: ROW_CAP_MESSAGE });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    } catch {
      // If the quick count fails, let the server be the authority.
    }
    setFile(selected);
    runPreview(selected);
  };

  const confirmImport = async () => {
    if (!file) return;
    if (mode === "assign" && !assignTo) {
      setToast({ type: "error", msg: "Please choose an assignee (Sales Manager or Site Head)." });
      return;
    }
    setImporting(true);
    setToast(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (mode === "assign") fd.append("assignedTo", assignTo);
      const res = await fetch(ENDPOINT, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: "error", msg: data.message || "Import failed." });
      } else {
        const skippedCount = data.skipped?.length || 0;
        const errCount = data.errorRows?.length || 0;
        setToast({
          type: "success",
          msg: `Imported ${data.inserted} lead(s).` +
            (skippedCount ? ` Skipped ${skippedCount} duplicate(s).` : "") +
            (errCount ? ` ${errCount} row(s) had errors.` : ""),
        });
        onImported?.();
        // Close shortly after showing success.
        setTimeout(() => closeModal(), 1800);
      }
    } catch (err: any) {
      setToast({ type: "error", msg: err.message || "Import failed." });
    } finally {
      setImporting(false);
    }
  };

  const panelBg = isDark ? "#15151f" : "#ffffff";
  const panelBorder = isDark ? "#2a2a3a" : "#e5e7eb";
  const textColor = isDark ? "#e5e7eb" : "#1f2937";
  const mutedColor = isDark ? "#9ca3af" : "#6b7280";
  const subtleBg = isDark ? "#1e1e2b" : "#f9fafb";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          buttonClassName ||
          `flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border rounded-lg transition-colors hover:opacity-80 ${
            isDark ? "bg-[#222] border-[#333] text-white" : "bg-white border-emerald-200 text-emerald-600"
          }`
        }
      >
        <FaFileExcel size={12} /> {buttonLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ background: panelBg, border: `1px solid ${panelBorder}`, maxHeight: "90vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: `1px solid ${panelBorder}` }}
            >
              <div className="flex items-center gap-2.5" style={{ color: textColor }}>
                <FaFileExcel className="text-emerald-500" />
                <span className="font-bold text-sm">Bulk Import Leads (.xlsx)</span>
              </div>
              <button onClick={closeModal} style={{ color: mutedColor }} className="hover:opacity-70">
                <FaTimes />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 overflow-y-auto" style={{ color: textColor }}>
              {/* File picker */}
              <label
                className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl cursor-pointer transition-colors"
                style={{ border: `2px dashed ${panelBorder}`, background: subtleBg }}
              >
                <FaUpload style={{ color: mutedColor }} />
                <span className="text-xs font-semibold" style={{ color: mutedColor }}>
                  {file ? file.name : "Click to choose an .xlsx file"}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={onFileChange}
                />
              </label>

              {loadingPreview && (
                <p className="mt-4 text-xs font-semibold" style={{ color: mutedColor }}>
                  Reading file…
                </p>
              )}

              {/* Preview */}
              {preview && (
                <div className="mt-4">
                  <div className="flex items-center gap-4 text-xs font-bold mb-3">
                    <span className="flex items-center gap-1.5 text-emerald-500">
                      <FaCheckCircle /> {preview.validCount} valid
                    </span>
                    {preview.errorCount > 0 && (
                      <span className="flex items-center gap-1.5 text-amber-500">
                        <FaExclamationTriangle /> {preview.errorCount} with errors
                      </span>
                    )}
                  </div>

                  {preview.sampleRows.length > 0 && (
                    <div
                      className="rounded-lg overflow-x-auto mb-3"
                      style={{ border: `1px solid ${panelBorder}` }}
                    >
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr style={{ background: subtleBg }}>
                            {["Name", "Phone", "Form No", "Date", "Source", "CP", "Config", "Budget"].map((h) => (
                              <th key={h} className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sampleRows.map((r, i) => (
                            <tr key={i} style={{ borderTop: `1px solid ${panelBorder}` }}>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.name}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.phone}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.external_ref || "—"}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">
                                {r.enquiry_date ? new Date(r.enquiry_date).toLocaleDateString() : "—"}
                              </td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.source || "—"}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.cp_name || "—"}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.configuration || "—"}</td>
                              <td className="px-2.5 py-1.5 whitespace-nowrap">{r.budget || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {preview.validCount > preview.sampleRows.length && (
                    <p className="text-[11px] mb-3" style={{ color: mutedColor }}>
                      Showing first {preview.sampleRows.length} of {preview.validCount} valid rows.
                    </p>
                  )}

                  {/* Error rows */}
                  {preview.errorRows.length > 0 && (
                    <div
                      className="rounded-lg p-3 mb-3 text-[11px]"
                      style={{ background: isDark ? "#3b1d1d" : "#fef2f2", border: "1px solid #fca5a5" }}
                    >
                      <p className="font-bold text-red-500 mb-1.5">Rows with errors (skipped on import):</p>
                      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                        {preview.errorRows.slice(0, 20).map((er) => (
                          <li key={er.rowNum} className="text-red-400">
                            Row {er.rowNum}: {er.errors.join("; ")}
                          </li>
                        ))}
                      </ul>
                      {preview.errorRows.length > 20 && (
                        <p className="text-red-400 mt-1">…and {preview.errorRows.length - 20} more.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Assign To dropdown (assign mode only) */}
              {mode === "assign" && (
                <div className="mt-4">
                  <label className="block text-xs font-bold mb-1.5" style={{ color: mutedColor }}>
                    Assign all imported leads to:
                  </label>
                  <select
                    value={assignTo}
                    onChange={(e) => setAssignTo(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold rounded-lg outline-none"
                    style={{ background: subtleBg, color: textColor, border: `1px solid ${panelBorder}` }}
                  >
                    <option value="">— Select Assignee —</option>
                    {managers.length > 0 && (
                      <optgroup label="Sales Managers">
                        {managers.map((m) => (
                          <option key={`sm-${m.id}`} value={m.name}>
                            {m.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {siteHeads.length > 0 && (
                      <optgroup label="Site Heads">
                        {siteHeads.map((sh) => (
                          <option key={`sh-${sh.id}`} value={sh.name}>
                            {sh.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              )}

              {mode === "self" && (
                <p className="mt-4 text-[11px]" style={{ color: mutedColor }}>
                  All imported leads will be assigned to you.
                </p>
              )}

              {toast && (
                <div
                  className="mt-4 rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{
                    background: toast.type === "success" ? (isDark ? "#12301f" : "#ecfdf5") : (isDark ? "#3b1d1d" : "#fef2f2"),
                    color: toast.type === "success" ? "#10b981" : "#ef4444",
                    border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fca5a5"}`,
                  }}
                >
                  {toast.msg}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-2 px-5 py-4"
              style={{ borderTop: `1px solid ${panelBorder}` }}
            >
              <button
                onClick={closeModal}
                className="px-4 py-2 text-xs font-bold rounded-lg"
                style={{ color: mutedColor, border: `1px solid ${panelBorder}` }}
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                disabled={!file || !preview || preview.validCount === 0 || importing || (mode === "assign" && !assignTo)}
                className="px-4 py-2 text-xs font-bold rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "#059669" }}
              >
                {importing ? "Importing…" : `Import ${preview?.validCount ?? 0} Lead(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
