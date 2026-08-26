"use client";
// components/UploadLeadSheet.tsx
// Self-contained bulk Excel lead import using the staged import pipeline.
// Phase 2 flow: select assignee -> pick file -> analyze -> sheet select -> mapping wizard -> stage -> preview -> commit.
// Used by Admin & Site Head (mode="assign") and wrapped by SelfUploadLeadSheet
// for Sales Managers (mode="self").
import { useEffect, useRef, useState } from "react";
import { FaFileExcel, FaUpload, FaTimes, FaCheckCircle, FaExclamationTriangle, FaHistory, FaSave } from "react-icons/fa";

type Mode = "assign" | "self";
type ImportStep = "select" | "analyze" | "mapping" | "staging" | "preview" | "committed";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const CRM_FIELDS = [
  { value: "", label: "— Ignore —" },
  { value: "name", label: "Name", required: true },
  { value: "phone", label: "Phone", required: true },
  { value: "enquiry_date", label: "Enquiry Date", required: true },
  { value: "external_ref", label: "Form No / External Ref" },
  { value: "source", label: "Source" },
  { value: "cp_name", label: "Channel Partner Name" },
  { value: "cp_phone", label: "CP Phone" },
  { value: "feedback", label: "Feedback / Remarks" },
  { value: "configuration", label: "Configuration" },
  { value: "budget", label: "Budget" },
  { value: "alt_phone", label: "Alt Phone" },
  { value: "booking_status", label: "Booking Status" },
  { value: "booking_date", label: "Booking Date" },
  { value: "booking_amount", label: "Booking Amount" },
  { value: "booking_reference", label: "Booking Reference" },
] as const;

const REQUIRED_CRM_FIELDS = CRM_FIELDS.filter((f) => "required" in f && f.required).map((f) => f.value);

interface MappingSuggestion {
  excelColumn: string;
  excelColumnIndex: number;
  suggestedField: string;
  confidence: number;
  matchType: string;
  distance: number;
  alternatives: { field: string; confidence: number }[];
}

interface SheetInfo {
  name: string;
  rowCount: number;
  isHidden: boolean;
  isEmpty: boolean;
  headers: string[];
}

interface SheetAnalysis {
  sheet: SheetInfo;
  mappings: MappingSuggestion[];
  unmappedRequired: string[];
  bookingFieldsDetected: boolean;
}

interface WorkbookAnalysis {
  sheets: SheetAnalysis[];
}

interface Template {
  id: string;
  name: string;
  mappings: Record<string, string>;
  is_default: boolean;
}

interface ImportRow {
  id: string;
  source_row_number: number;
  raw_data: Record<string, any>;
  normalized_data: {
    name?: string;
    phone?: string;
    external_ref?: string;
    enquiry_date?: string;
    source?: string;
    cp_name?: string;
    configuration?: string;
    budget?: string;
  };
  validation_status: "valid" | "invalid";
  proposed_action: string;
  user_override_action: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  matched_record_id: number | null;
  errors: string[];
  warnings: string[];
}

interface StageResult {
  jobId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  sheetName: string;
  dedupSummary?: {
    creates: number;
    updates: number;
    skips: number;
    manualReview: number;
  };
}

interface PreviewData {
  rows: ImportRow[];
  total: number;
}

interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
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

export default function UploadLeadSheet({
  mode,
  isDark = false,
  onImported,
  buttonClassName,
  buttonLabel = "Bulk Import",
}: UploadLeadSheetProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stageResult, setStageResult] = useState<StageResult | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [siteHeads, setSiteHeads] = useState<Manager[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [staging, setStaging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase 2 state
  const [step, setStep] = useState<ImportStep>("select");
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [confirmedMapping, setConfirmedMapping] = useState<Record<string, string> | null>(null);
  const [mappingSuggestions, setMappingSuggestions] = useState<MappingSuggestion[]>([]);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateIsDefault, setTemplateIsDefault] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

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
    setJobId(null);
    setStageResult(null);
    setPreviewData(null);
    setAssignTo("");
    setStaging(false);
    setImporting(false);
    setCommitResult(null);
    setToast(null);
    setStep("select");
    setAnalysis(null);
    setAnalyzing(false);
    setSelectedSheet("");
    setConfirmedMapping(null);
    setMappingSuggestions([]);
    setMappingOverrides({});
    setTemplates([]);
    setShowSaveTemplate(false);
    setTemplateName("");
    setTemplateIsDefault(false);
    setSavingTemplate(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const cancelJob = (id: string) => {
    // Fire and forget — don't block the close.
    fetch(`/api/import/${id}/cancel`, { method: "POST" }).catch(() => {});
  };

  const closeModal = () => {
    // Cancel any staged-but-uncommitted job.
    if (jobId && !commitResult) {
      cancelJob(jobId);
    }
    setOpen(false);
    resetState();
  };

  const fetchPreview = async (id: string) => {
    try {
      const res = await fetch(`/api/import/${id}?limit=5&offset=0&filter=all`);
      const data = await res.json();
      if (res.ok && data.success) {
        setPreviewData(data.preview);
      }
    } catch {
      // Preview fetch failure is non-fatal; stage counts are still visible.
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/import/templates");
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.templates)) {
        setTemplates(data.templates);
      }
    } catch {
      // Non-fatal.
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !confirmedMapping) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/import/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          mappings: confirmedMapping,
          isDefault: templateIsDefault,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToast({ type: "success", msg: `Template "${templateName.trim()}" saved.` });
        setShowSaveTemplate(false);
        setTemplateName("");
        setTemplateIsDefault(false);
        await fetchTemplates();
      } else {
        setToast({ type: "error", msg: data.message || "Failed to save template." });
      }
    } catch {
      setToast({ type: "error", msg: "Failed to save template." });
    } finally {
      setSavingTemplate(false);
    }
  };

  // --- Phase 2: Analyze file ---
  const analyzeFile = async (selected: File) => {
    setAnalyzing(true);
    setStep("analyze");
    setToast(null);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      const res = await fetch("/api/import/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: "error", msg: data.message || "Failed to analyze file." });
        setFile(null);
        setStep("select");
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setAnalysis(data.analysis);
        const validSheets = data.analysis.sheets.filter(
          (s: SheetAnalysis) => !s.sheet.isHidden && !s.sheet.isEmpty
        );
        if (validSheets.length === 0) {
          setToast({ type: "error", msg: "No non-empty sheets found in the file." });
          setFile(null);
          setStep("select");
          if (fileInputRef.current) fileInputRef.current.value = "";
        } else if (validSheets.length === 1) {
          // Auto-select the only valid sheet
          setSelectedSheet(validSheets[0].sheet.name);
          setMappingSuggestions(validSheets[0].mappings);
          initMappingOverrides(validSheets[0].mappings);
          setStep("mapping");
        } else {
          // Multiple sheets — user must pick
          setStep("mapping");
        }
        fetchTemplates();
      }
    } catch (err: any) {
      setToast({ type: "error", msg: err.message || "Failed to analyze file." });
      setFile(null);
      setStep("select");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setAnalyzing(false);
    }
  };

  const initMappingOverrides = (suggestions: MappingSuggestion[]) => {
    const overrides: Record<string, string> = {};
    for (const s of suggestions) {
      overrides[s.excelColumn] = s.suggestedField || "";
    }
    setMappingOverrides(overrides);
  };

  const onSheetSelect = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (!analysis) return;
    const sheetAnalysis = analysis.sheets.find((s) => s.sheet.name === sheetName);
    if (sheetAnalysis) {
      setMappingSuggestions(sheetAnalysis.mappings);
      initMappingOverrides(sheetAnalysis.mappings);
    }
  };

  const applyTemplate = (template: Template) => {
    if (!mappingSuggestions.length) return;
    const overrides: Record<string, string> = {};
    for (const s of mappingSuggestions) {
      // Template stores { excelColumn: crmField }
      overrides[s.excelColumn] = template.mappings[s.excelColumn] ?? "";
    }
    setMappingOverrides(overrides);
  };

  // Build mapping from overrides, excluding ignored columns
  const buildMapping = (): Record<string, string> => {
    const mapping: Record<string, string> = {};
    for (const [excelCol, crmField] of Object.entries(mappingOverrides)) {
      if (crmField) {
        mapping[excelCol] = crmField;
      }
    }
    return mapping;
  };

  // Check which required fields are unmapped
  const unmappedRequired = (): string[] => {
    const mappedCrmFields = new Set(Object.values(mappingOverrides).filter(Boolean));
    return REQUIRED_CRM_FIELDS.filter((f) => !mappedCrmFields.has(f));
  };

  const canConfirmMapping = (): boolean => {
    return selectedSheet !== "" && unmappedRequired().length === 0;
  };

  // --- Phase 2: Upload with mapping ---
  const uploadWithMapping = async () => {
    if (!file || !selectedSheet) return;
    const mapping = buildMapping();
    setConfirmedMapping(mapping);
    setStaging(true);
    setStep("staging");
    setStageResult(null);
    setPreviewData(null);
    setCommitResult(null);
    setToast(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (mode === "assign") fd.append("assignedTo", assignTo);
      fd.append("sheetName", selectedSheet);
      fd.append("mapping", JSON.stringify(mapping));
      const res = await fetch("/api/import/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: "error", msg: data.message || "Failed to stage file." });
        setStep("mapping");
      } else {
        const result: StageResult = {
          jobId: data.jobId,
          totalRows: data.totalRows,
          validRows: data.validRows,
          invalidRows: data.invalidRows,
          sheetName: data.sheetName,
          dedupSummary: data.dedupSummary,
        };
        setJobId(data.jobId);
        setStageResult(result);
        await fetchPreview(data.jobId);
        setStep("preview");
      }
    } catch (err: any) {
      setToast({ type: "error", msg: err.message || "Failed to stage file." });
      setStep("mapping");
    } finally {
      setStaging(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setToast(null);
    setStageResult(null);
    setPreviewData(null);
    setCommitResult(null);
    setAnalysis(null);
    setSelectedSheet("");
    setMappingSuggestions([]);
    setMappingOverrides({});
    setConfirmedMapping(null);

    // Cancel previous staged job if re-picking a file.
    if (jobId) {
      cancelJob(jobId);
      setJobId(null);
    }

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
    if (selected.size > MAX_FILE_SIZE) {
      setToast({ type: "error", msg: "File exceeds 10 MB. Please use a smaller file." });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (mode === "assign" && !assignTo) {
      setToast({ type: "error", msg: "Please select an assignee before choosing a file." });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
    analyzeFile(selected);
  };

  const confirmImport = async () => {
    if (!jobId) return;
    setImporting(true);
    setToast(null);
    try {
      const res = await fetch(`/api/import/${jobId}/commit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ type: "error", msg: data.message || "Import failed." });
      } else {
        const result: CommitResult = {
          created: data.created ?? 0,
          updated: data.updated ?? 0,
          skipped: data.skipped ?? 0,
          failed: data.failed ?? 0,
        };
        setCommitResult(result);
        setStep("committed");
        setToast({
          type: "success",
          msg: `Created ${result.created} lead(s).` +
            (result.updated ? ` Updated ${result.updated}.` : "") +
            (result.skipped ? ` Skipped ${result.skipped}.` : "") +
            (result.failed ? ` ${result.failed} failed.` : ""),
        });
        onImported?.();
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

  const validRows = previewData?.rows.filter((r) => r.validation_status === "valid") ?? [];
  const errorRows = previewData?.rows.filter((r) => r.validation_status === "invalid") ?? [];

  // Valid sheets for sheet selection
  const validSheets = analysis?.sheets.filter((s) => !s.sheet.isHidden && !s.sheet.isEmpty) ?? [];

  // Confidence badge helper
  const confidenceBadge = (confidence: number) => {
    if (confidence >= 90) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          exact
        </span>
      );
    }
    if (confidence >= 75) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-500">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          fuzzy
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: mutedColor }}>
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
        unmapped
      </span>
    );
  };

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
              {/* Step 1 (assign mode): Assign To dropdown — shown BEFORE file picker */}
              {mode === "assign" && step !== "committed" && (
                <div className="mb-4">
                  <label className="block text-xs font-bold mb-1.5" style={{ color: mutedColor }}>
                    Assign all imported leads to:
                  </label>
                  <select
                    value={assignTo}
                    onChange={(e) => setAssignTo(e.target.value)}
                    disabled={step !== "select"}
                    className="w-full px-3 py-2 text-xs font-semibold rounded-lg outline-none disabled:opacity-60"
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

              {mode === "self" && step !== "committed" && (
                <p className="mb-4 text-[11px]" style={{ color: mutedColor }}>
                  All imported leads will be assigned to you.
                </p>
              )}

              {/* Step 2: File picker — shown on select / analyze steps, or mapping/staging/preview for context */}
              {step !== "committed" && (
                <label
                  className={`flex flex-col items-center justify-center gap-2 py-6 rounded-xl transition-colors ${
                    mode === "assign" && !assignTo
                      ? "opacity-50 cursor-not-allowed"
                      : step !== "select" && step !== "analyze"
                      ? "opacity-60 cursor-default"
                      : "cursor-pointer"
                  }`}
                  style={{ border: `2px dashed ${panelBorder}`, background: subtleBg }}
                >
                  <FaUpload style={{ color: mutedColor }} />
                  <span className="text-xs font-semibold" style={{ color: mutedColor }}>
                    {file ? file.name : "Click to choose an .xlsx file"}
                  </span>
                  {mode === "assign" && !assignTo && (
                    <span className="text-[10px]" style={{ color: mutedColor }}>
                      Select an assignee first
                    </span>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={onFileChange}
                    disabled={(mode === "assign" && !assignTo) || (step !== "select")}
                  />
                </label>
              )}

              {/* Analyze spinner */}
              {step === "analyze" && analyzing && (
                <p className="mt-4 text-xs font-semibold" style={{ color: mutedColor }}>
                  Analyzing file...
                </p>
              )}

              {/* Step 3+4: Sheet selection + Mapping wizard */}
              {step === "mapping" && analysis && (
                <div className="mt-4">
                  {/* Sheet selector — only when multiple valid sheets */}
                  {validSheets.length > 1 && (
                    <div className="mb-4">
                      <label className="block text-xs font-bold mb-1.5" style={{ color: mutedColor }}>
                        Select sheet:
                      </label>
                      <select
                        value={selectedSheet}
                        onChange={(e) => onSheetSelect(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-semibold rounded-lg outline-none"
                        style={{ background: subtleBg, color: textColor, border: `1px solid ${panelBorder}` }}
                      >
                        <option value="">— Select Sheet —</option>
                        {validSheets.map((s) => (
                          <option key={s.sheet.name} value={s.sheet.name}>
                            {s.sheet.name} ({s.sheet.rowCount} rows)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Mapping wizard — shown once a sheet is selected */}
                  {selectedSheet && mappingSuggestions.length > 0 && (
                    <>
                      {/* Template load */}
                      {templates.length > 0 && (
                        <div className="mb-3">
                          <label className="block text-[10px] font-bold mb-1" style={{ color: mutedColor }}>
                            Load Template:
                          </label>
                          <select
                            onChange={(e) => {
                              const t = templates.find((t) => t.id === e.target.value);
                              if (t) applyTemplate(t);
                            }}
                            defaultValue=""
                            className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg outline-none"
                            style={{ background: subtleBg, color: textColor, border: `1px solid ${panelBorder}` }}
                          >
                            <option value="">— Select Template —</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}{t.is_default ? " (default)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Mapping table */}
                      <div
                        className="rounded-lg overflow-x-auto mb-3"
                        style={{ border: `1px solid ${panelBorder}` }}
                      >
                        <table className="w-full text-left text-[11px]">
                          <thead>
                            <tr style={{ background: subtleBg }}>
                              <th className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>
                                Excel Column
                              </th>
                              <th className="px-2.5 py-1.5 font-bold whitespace-nowrap text-center" style={{ color: mutedColor }}>
                                {/* arrow */}
                              </th>
                              <th className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>
                                CRM Field
                              </th>
                              <th className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>
                                Confidence
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {mappingSuggestions.map((s, idx) => {
                              const currentValue = mappingOverrides[s.excelColumn] ?? "";
                              return (
                                <tr key={`${s.excelColumn}_${idx}`} style={{ borderTop: `1px solid ${panelBorder}` }}>
                                  <td className="px-2.5 py-1.5 whitespace-nowrap font-semibold">
                                    {s.excelColumn}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-center" style={{ color: mutedColor }}>
                                    &rarr;
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    <select
                                      value={currentValue}
                                      onChange={(e) =>
                                        setMappingOverrides((prev) => ({
                                          ...prev,
                                          [s.excelColumn]: e.target.value,
                                        }))
                                      }
                                      className="w-full px-2 py-1 text-[11px] font-semibold rounded outline-none"
                                      style={{
                                        background: subtleBg,
                                        color: textColor,
                                        border: `1px solid ${panelBorder}`,
                                      }}
                                    >
                                      {CRM_FIELDS.map((f) => (
                                        <option key={f.value} value={f.value}>
                                          {f.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    {s.suggestedField ? confidenceBadge(s.confidence) : confidenceBadge(0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Unmapped required fields warning */}
                      {unmappedRequired().length > 0 && (
                        <div
                          className="rounded-lg p-3 mb-3 text-[11px]"
                          style={{
                            background: isDark ? "#3b2d1d" : "#fffbeb",
                            border: "1px solid #fbbf24",
                          }}
                        >
                          <p className="font-bold text-amber-500 mb-1 flex items-center gap-1.5">
                            <FaExclamationTriangle size={10} />
                            Required fields not mapped:
                          </p>
                          <ul className="list-disc list-inside text-amber-600">
                            {unmappedRequired().map((f) => {
                              const label = CRM_FIELDS.find((c) => c.value === f)?.label ?? f;
                              return <li key={f}>{label}</li>;
                            })}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Staging spinner */}
              {step === "staging" && staging && (
                <p className="mt-4 text-xs font-semibold" style={{ color: mutedColor }}>
                  Uploading and validating...
                </p>
              )}

              {/* Preview from staged data */}
              {step === "preview" && stageResult && (
                <div className="mt-4">
                  <div className="flex items-center gap-4 text-xs font-bold mb-3">
                    <span className="flex items-center gap-1.5 text-emerald-500">
                      <FaCheckCircle /> {stageResult.validRows} valid
                    </span>
                    {stageResult.invalidRows > 0 && (
                      <span className="flex items-center gap-1.5 text-amber-500">
                        <FaExclamationTriangle /> {stageResult.invalidRows} with errors
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: mutedColor }}>
                      ({stageResult.totalRows} total from &ldquo;{stageResult.sheetName}&rdquo;)
                    </span>
                  </div>

                  {/* Dedup summary bar */}
                  {stageResult.dedupSummary && (
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {stageResult.dedupSummary.creates > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          {stageResult.dedupSummary.creates} new
                        </span>
                      )}
                      {stageResult.dedupSummary.updates > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                          {stageResult.dedupSummary.updates} update
                        </span>
                      )}
                      {stageResult.dedupSummary.skips > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                          {stageResult.dedupSummary.skips} skip
                        </span>
                      )}
                      {stageResult.dedupSummary.manualReview > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700">
                          {stageResult.dedupSummary.manualReview} review
                        </span>
                      )}
                    </div>
                  )}

                  {/* Manual review warning */}
                  {(() => {
                    const unresolvedReview = validRows.filter(
                      (r) => r.proposed_action === "manual_review" && !r.user_override_action
                    ).length;
                    return unresolvedReview > 0 ? (
                      <div
                        className="rounded-lg p-2.5 mb-3 text-[11px]"
                        style={{
                          background: isDark ? "#3b2d1d" : "#fffbeb",
                          border: "1px solid #fbbf24",
                        }}
                      >
                        <p className="font-bold text-amber-500 flex items-center gap-1.5">
                          <FaExclamationTriangle size={10} />
                          {unresolvedReview} row(s) need review. Override them or they will be skipped on commit.
                        </p>
                      </div>
                    ) : null;
                  })()}

                  {validRows.length > 0 && (
                    <div
                      className="rounded-lg overflow-x-auto mb-3"
                      style={{ border: `1px solid ${panelBorder}` }}
                    >
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr style={{ background: subtleBg }}>
                            <th className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>Action</th>
                            {["Name", "Phone", "Form No", "Date", "Source", "CP"].map((h) => (
                              <th key={h} className="px-2.5 py-1.5 font-bold whitespace-nowrap" style={{ color: mutedColor }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {validRows.map((r, i) => {
                            const d = r.normalized_data;
                            const effectiveAction = r.user_override_action || r.proposed_action;
                            const actionColors: Record<string, { bg: string; text: string; label: string }> = {
                              create: { bg: "bg-emerald-100", text: "text-emerald-700", label: "New" },
                              update: { bg: "bg-blue-100", text: "text-blue-700", label: "Update" },
                              skip: { bg: "bg-gray-100", text: "text-gray-600", label: "Skip" },
                              manual_review: { bg: "bg-orange-100", text: "text-orange-700", label: "Review" },
                            };
                            const ac = actionColors[effectiveAction] || actionColors.create;
                            return (
                              <tr key={i} style={{ borderTop: `1px solid ${panelBorder}` }}>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${ac.bg} ${ac.text}`}>
                                      {ac.label}
                                    </span>
                                    {r.matched_record_id && (
                                      <select
                                        value={effectiveAction}
                                        onChange={async (e) => {
                                          const newAction = e.target.value;
                                          try {
                                            const res = await fetch(
                                              `/api/import/${jobId}/rows/${r.id}/override`,
                                              {
                                                method: "PATCH",
                                                headers: { "Content-Type": "application/json" },
                                                body: JSON.stringify({ action: newAction }),
                                              }
                                            );
                                            if (res.ok) {
                                              // Update local state
                                              setPreviewData((prev) =>
                                                prev
                                                  ? {
                                                      ...prev,
                                                      rows: prev.rows.map((row) =>
                                                        row.id === r.id
                                                          ? { ...row, user_override_action: newAction }
                                                          : row
                                                      ),
                                                    }
                                                  : prev
                                              );
                                            }
                                          } catch {
                                            // Silent fail for override
                                          }
                                        }}
                                        className="text-[9px] px-1 py-0 rounded outline-none"
                                        style={{
                                          background: subtleBg,
                                          color: textColor,
                                          border: `1px solid ${panelBorder}`,
                                          width: 60,
                                        }}
                                      >
                                        <option value="create">New</option>
                                        <option value="update">Update</option>
                                        <option value="skip">Skip</option>
                                      </select>
                                    )}
                                  </div>
                                  {r.match_confidence != null && r.match_confidence > 0 && (
                                    <span className="block text-[8px] mt-0.5" style={{ color: mutedColor }}>
                                      {r.match_confidence}% {r.match_reason}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.name || "—"}</td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.phone || "—"}</td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.external_ref || "—"}</td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">
                                  {d.enquiry_date ? new Date(d.enquiry_date).toLocaleDateString() : "—"}
                                </td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.source || "—"}</td>
                                <td className="px-2.5 py-1.5 whitespace-nowrap">{d.cp_name || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {stageResult.validRows > validRows.length && (
                    <p className="text-[11px] mb-3" style={{ color: mutedColor }}>
                      Showing first {validRows.length} of {stageResult.validRows} valid rows.
                    </p>
                  )}

                  {/* Error rows */}
                  {errorRows.length > 0 && (
                    <div
                      className="rounded-lg p-3 mb-3 text-[11px]"
                      style={{ background: isDark ? "#3b1d1d" : "#fef2f2", border: "1px solid #fca5a5" }}
                    >
                      <p className="font-bold text-red-500 mb-1.5">Rows with errors (skipped on import):</p>
                      <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                        {errorRows.slice(0, 20).map((er) => (
                          <li key={er.source_row_number} className="text-red-400">
                            Row {er.source_row_number}: {er.errors.join("; ")}
                          </li>
                        ))}
                      </ul>
                      {errorRows.length > 20 && (
                        <p className="text-red-400 mt-1">...and {errorRows.length - 20} more.</p>
                      )}
                    </div>
                  )}

                  {/* Save as Template — shown after staging, before commit */}
                  {confirmedMapping && !showSaveTemplate && (
                    <button
                      onClick={() => setShowSaveTemplate(true)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold hover:underline mb-3"
                      style={{ color: mutedColor }}
                    >
                      <FaSave size={10} /> Save mapping as template
                    </button>
                  )}

                  {showSaveTemplate && (
                    <div
                      className="rounded-lg p-3 mb-3"
                      style={{ background: subtleBg, border: `1px solid ${panelBorder}` }}
                    >
                      <p className="text-[11px] font-bold mb-2" style={{ color: textColor }}>
                        Save Mapping Template
                      </p>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="Template name"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none mb-2"
                        style={{ background: panelBg, color: textColor, border: `1px solid ${panelBorder}` }}
                      />
                      <label className="flex items-center gap-2 text-[11px] mb-2" style={{ color: mutedColor }}>
                        <input
                          type="checkbox"
                          checked={templateIsDefault}
                          onChange={(e) => setTemplateIsDefault(e.target.checked)}
                        />
                        Set as default
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveTemplate}
                          disabled={!templateName.trim() || savingTemplate}
                          className="px-3 py-1.5 text-[11px] font-bold rounded-lg text-white disabled:opacity-40"
                          style={{ background: "#059669" }}
                        >
                          {savingTemplate ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => {
                            setShowSaveTemplate(false);
                            setTemplateName("");
                            setTemplateIsDefault(false);
                          }}
                          className="px-3 py-1.5 text-[11px] font-bold rounded-lg"
                          style={{ color: mutedColor, border: `1px solid ${panelBorder}` }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Commit result summary */}
              {step === "committed" && commitResult && (
                <div className="mt-4">
                  <div
                    className="rounded-lg p-4 text-sm"
                    style={{ background: isDark ? "#12301f" : "#ecfdf5", border: "1px solid #6ee7b7" }}
                  >
                    <p className="font-bold text-emerald-500 mb-2 flex items-center gap-2">
                      <FaCheckCircle /> Import Complete
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: textColor }}>
                      <span>Created:</span>
                      <span className="font-bold">{commitResult.created}</span>
                      {commitResult.updated > 0 && (
                        <>
                          <span>Updated:</span>
                          <span className="font-bold">{commitResult.updated}</span>
                        </>
                      )}
                      {commitResult.skipped > 0 && (
                        <>
                          <span>Skipped:</span>
                          <span className="font-bold">{commitResult.skipped}</span>
                        </>
                      )}
                      {commitResult.failed > 0 && (
                        <>
                          <span>Failed:</span>
                          <span className="font-bold text-red-400">{commitResult.failed}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
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
              className="flex items-center justify-between px-5 py-4"
              style={{ borderTop: `1px solid ${panelBorder}` }}
            >
              <a
                href="/dashboard/settings?section=import-history"
                className="flex items-center gap-1.5 text-[11px] font-semibold hover:underline"
                style={{ color: mutedColor }}
                onClick={(e) => e.stopPropagation()}
              >
                <FaHistory size={10} /> Import History
              </a>

              <div className="flex items-center gap-2">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-xs font-bold rounded-lg"
                  style={{ color: mutedColor, border: `1px solid ${panelBorder}` }}
                >
                  {step === "committed" ? "Close" : "Cancel"}
                </button>

                {/* Confirm & Upload button (mapping step) */}
                {step === "mapping" && (
                  <button
                    onClick={uploadWithMapping}
                    disabled={!canConfirmMapping()}
                    className="px-4 py-2 text-xs font-bold rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: "#059669" }}
                  >
                    Confirm &amp; Upload
                  </button>
                )}

                {/* Import button (preview step) */}
                {step === "preview" && stageResult && (() => {
                  const ds = stageResult.dedupSummary;
                  const createCount = ds?.creates ?? stageResult.validRows;
                  const updateCount = ds?.updates ?? 0;
                  const parts: string[] = [];
                  if (createCount > 0) parts.push(`${createCount} new`);
                  if (updateCount > 0) parts.push(`${updateCount} update`);
                  const label = parts.length > 0 ? `Commit (${parts.join(", ")})` : `Import ${stageResult.validRows} Lead(s)`;
                  return (
                    <button
                      onClick={confirmImport}
                      disabled={!jobId || !stageResult || stageResult.validRows === 0 || importing || staging}
                      className="px-4 py-2 text-xs font-bold rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "#059669" }}
                    >
                      {importing ? "Importing..." : label}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
