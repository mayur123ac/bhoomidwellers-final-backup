"use client";
// SearchableSelect.tsx — generic searchable dropdown.
//
// Behaviour is lifted from ConfigCombobox in the Receptionist panel (filter as you
// type, arrow-key navigation, Enter to pick, Escape/outside-click to close, no free
// text accepted) but generalized over an option list so it isn't tied to the room
// configuration array. ConfigCombobox could be reimplemented on top of this later;
// it is deliberately left alone here to avoid touching the enquiry form's most
// heavily used field in the same pass.
//
// Options carry an opaque `value` (what gets stored) plus `label` and up to two
// secondary lines, so a person can be shown as name / id / phone while only the id
// is ever submitted.
import React, { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered under the label, dimmer — e.g. "ID 14 · +91 98765 43210". */
  sublabel?: string;
  /** Extra text matched by the search box but not displayed. */
  keywords?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  isDark: boolean;
  t: any;
  placeholder?: string;
  /** Shown in place of the list when options is empty. */
  emptyMessage?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function SearchableSelect({
  value, onChange, options, isDark, t,
  placeholder = "Select…",
  emptyMessage = "No options available",
  disabled = false,
  ariaLabel,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find(o => o.value === value) || null;

  const filtered = query.trim()
    ? options.filter(o => {
        const q = query.toLowerCase();
        return (
          o.label.toLowerCase().includes(q) ||
          (o.sublabel || "").toLowerCase().includes(q) ||
          (o.keywords || "").toLowerCase().includes(q)
        );
      })
    : options;

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keep the highlighted row in view while arrowing through a long list
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setOpen(true); setHighlighted(0); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted].value);
    }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  const displayValue = open ? query : (selected?.label || "");

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={`w-full flex items-center gap-2 rounded-lg border text-sm transition-colors ${
          disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
        } ${
          open
            ? isDark ? "border-[#9E217B] bg-[#14141B]" : "border-[#00AEEF] bg-white"
            : `${t.modalInput || t.inputInner}`
        }`}
        onClick={() => { if (!disabled) { setOpen(o => !o); setHighlighted(0); } }}
      >
        <input
          type="text"
          value={displayValue}
          placeholder={open ? "Type to search…" : placeholder}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setHighlighted(0); if (!open) setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (!disabled) { setOpen(true); setHighlighted(0); } }}
          autoComplete="off"
          className={`flex-1 p-3 outline-none bg-transparent ${t.text} placeholder:text-gray-400 ${disabled ? "cursor-not-allowed" : ""}`}
          aria-label={ariaLabel}
        />
        <span className={`pr-3 text-xs select-none ${t.textFaint}`}>{open ? "▲" : "▼"}</span>
      </div>

      {/* The selected option's secondary line stays visible after the list closes,
          so the picked person's id/phone remains on screen for confirmation. */}
      {!open && selected?.sublabel && (
        <p className={`text-[10px] mt-1 pl-2 ${t.textFaint}`}>{selected.sublabel}</p>
      )}

      {open && (
        <ul
          ref={listRef}
          className={`absolute z-[220] mt-1 w-full max-h-52 overflow-y-auto custom-scrollbar rounded-lg border shadow-xl text-sm ${
            isDark ? "bg-[#121218] border-[#2A2A35]" : "bg-white border-[#D1D5DB]"
          }`}
          role="listbox"
        >
          {options.length === 0 ? (
            <li className={`px-4 py-3 ${t.textFaint}`}>{emptyMessage}</li>
          ) : filtered.length === 0 ? (
            <li className={`px-4 py-3 ${t.textFaint}`}>No match — select from the list only</li>
          ) : (
            filtered.map((option, i) => (
              <li
                key={option.value}
                role="option"
                aria-selected={value === option.value}
                onMouseDown={e => { e.preventDefault(); select(option.value); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-4 py-2.5 cursor-pointer transition-colors ${
                  i === highlighted
                    ? isDark ? "bg-[#9E217B]/20" : "bg-[#00AEEF]/10"
                    : ""
                }`}
              >
                <p className={`font-medium ${
                  value === option.value
                    ? isDark ? "text-[#d4006e]" : "text-[#9E217B]"
                    : t.text
                }`}>
                  {option.label}
                  {value === option.value && <span className="ml-2 text-xs opacity-60">✓</span>}
                </p>
                {option.sublabel && (
                  <p className={`text-[10px] mt-0.5 ${t.textFaint}`}>{option.sublabel}</p>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
