// components/InlineContactField.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { FaPencilAlt, FaCheck, FaTimes } from "react-icons/fa";

export interface InlineContactFieldTheme {
  text: string;
  textFaint: string;
  inputInner: string;
  inputFocus: string;
}

interface InlineContactFieldProps {
  label: string;
  /** Raw value from the lead object. Pass null / undefined / "N/A" for empty. */
  value: string | null | undefined;
  fieldType: "email" | "tel" | "text";
  isDark: boolean;
  theme: InlineContactFieldTheme;
  /**
   * Called when the user clicks Save.
   * Should call the API and optimistically update parent state + show a toast.
   * Throw (or reject) on error — the component will restore the original value.
   */
  onSave: (newValue: string) => Promise<void>;
  /** RBAC gate — if false the field renders read-only with no edit icon. */
  canEdit: boolean;
  /** Apply font-mono to the displayed value */
  mono?: boolean;
}

/** Validate the edited value. Returns error string or null. */
function validate(val: string, fieldType: "email" | "tel" | "text"): string | null {
  if (!val) return null; // empty is allowed — clears the field
  if (fieldType === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))
      return "Enter a valid email address";
  } else if (fieldType === "tel") {
    const digits = val.replace(/\D/g, "");
    if (digits.length === 0) return "Numbers only";
    if (digits.length > 15) return "Maximum 15 digits";
  } else if (fieldType === "text") {
    if (val.length > 255) return "Maximum 255 characters";
  }
  return null;
}

export default function InlineContactField({
  label,
  value,
  fieldType,
  isDark,
  theme,
  onSave,
  canEdit,
  mono = false,
}: InlineContactFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Normalise: treat "N/A" and "Not Provided" as no value
  const displayValue =
    value && value !== "N/A" && value !== "Not Provided" ? value : null;

  function startEdit() {
    if (!canEdit || saving) return;
    setDraft(displayValue ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    if (saving) return;
    setEditing(false);
    setError(null);
    setDraft("");
  }

  // Auto-focus the input when entering edit mode
  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [editing]);

  async function handleSave() {
    const trimmed =
      fieldType === "tel"
        ? draft.trim().replace(/\D/g, "") // strip non-digits for phone
        : draft.trim();

    const err = validate(trimmed, fieldType);
    if (err) {
      setError(err);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
      setDraft("");
    } catch (e: any) {
      setError(e?.message || "Update failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") cancelEdit();
  }

  const accentColor = isDark ? "#d946a8" : "#9E217B";

  /* ── READ MODE ────────────────────────────────────────────── */
  if (!editing) {
    return (
      <div>
        <p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>{label}</p>
        <div
          className={`group flex items-center gap-1.5 min-h-[24px] ${canEdit ? "cursor-pointer" : ""}`}
          onClick={canEdit && !displayValue ? startEdit : undefined}
        >
          <p
            className={`font-semibold transition-colors duration-200 ${mono ? "font-mono" : ""} ${
              displayValue ? theme.text : `opacity-50 italic ${theme.text}`
            }`}
          >
            {displayValue ?? "Not Provided"}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEdit();
              }}
              title={`Edit ${label}`}
              aria-label={`Edit ${label}`}
              className="opacity-30 hover:opacity-100 flex items-center justify-center w-5 h-5 rounded transition-all duration-150 shrink-0 cursor-pointer"
              style={{ color: accentColor }}
            >
              <FaPencilAlt className="text-[9px]" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── EDIT MODE ────────────────────────────────────────────── */
  return (
    <div style={{ animation: "inlineEditIn 180ms ease-out" }}>
      <style>{`@keyframes inlineEditIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}`}</style>
      <p className={`text-xs font-medium mb-1 ${theme.textFaint}`}>{label}</p>
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type={fieldType}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            disabled={saving}
            maxLength={fieldType === "tel" ? 20 : 120}
            inputMode={fieldType === "tel" ? "numeric" : undefined}
            placeholder={
              fieldType === "email" ? "email@example.com" : fieldType === "tel" ? "Enter number" : `Enter ${label.toLowerCase()}`
            }
            className={`flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-sm outline-none transition-all duration-150 ${
              mono ? "font-mono" : ""
            } ${theme.inputInner} ${theme.inputFocus} ${theme.text} ${
              saving ? "opacity-50 cursor-not-allowed" : ""
            } ${error ? "!border-red-500/70" : ""}`}
          />

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            title="Save"
            aria-label="Save"
            className="flex items-center justify-center w-7 h-7 rounded-lg border transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 hover:bg-green-600 hover:border-green-600 hover:text-white"
            style={{
              background: isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.1)",
              borderColor: "rgba(34,197,94,0.45)",
              color: "#4ade80",
            }}
          >
            {saving ? (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="28 56" />
              </svg>
            ) : (
              <FaCheck className="text-[10px]" />
            )}
          </button>

          {/* Cancel button */}
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            title="Cancel"
            aria-label="Cancel"
            className="flex items-center justify-center w-7 h-7 rounded-lg border transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 hover:bg-red-600 hover:border-red-600 hover:text-white"
            style={{
              background: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)",
              borderColor: "rgba(239,68,68,0.4)",
              color: "#f87171",
            }}
          >
            <FaTimes className="text-[10px]" />
          </button>
        </div>

        {/* Inline validation error */}
        {error && (
          <p className="text-[10px] text-red-400 pl-0.5">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
