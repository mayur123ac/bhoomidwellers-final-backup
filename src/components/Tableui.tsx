"use client";

/* ══════════════════════════════════════════════════════════════════════
   tableUI.tsx — Shared enterprise-table primitives for Bhoomi CRM
   Brand: #9E217B (magenta) · #d946a8 (magenta light) · #00AEEF (cyan)
   ══════════════════════════════════════════════════════════════════════ */

import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import {
    FaCheck,
    FaEllipsisV,
    FaSearch,
    FaTimes,
    FaChevronLeft,
    FaChevronRight,
    FaColumns,
    FaSortUp,
    FaSortDown,
    FaSort,
    FaInbox,
    FaPhoneAlt,
    FaEnvelope,
    FaCircle,
    FaCheckCircle,
    FaClock,
    FaCalendarCheck,
    FaTimesCircle,
    FaKey,
} from "react-icons/fa";

/* ─────────────────────────────────────────────────────────────
   1. Checkbox — rounded square, magenta fill, animated tick
   ───────────────────────────────────────────────────────────── */
export function Checkbox({
    checked,
    indeterminate = false,
    onChange,
    label,
    title,
    disabled = false,
}: {
    checked: boolean;
    indeterminate?: boolean;
    onChange: (next: boolean) => void;
    label?: string;
    title?: string;
    disabled?: boolean;
}) {
    return (
        <label
            title={title}
            className={`group inline-flex items-center gap-2 select-none ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                }`}
        >
            <span className="relative grid place-items-center w-8 h-8 -m-2">
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                    className="peer sr-only"
                />
                <span
                    className={`
            w-[18px] h-[18px] rounded-[6px] border-[1.5px]
            grid place-items-center
            transition-all duration-200 ease-out
            ${checked || indeterminate
                            ? "bg-[#9E217B] border-[#9E217B] shadow-[0_0_0_3px_rgba(158,33,123,0.18)]"
                            : "border-white/25 bg-white/[0.03] group-hover:border-[#d946a8] group-hover:shadow-[0_0_0_3px_rgba(158,33,123,0.10)]"
                        }
            peer-focus-visible:ring-2 peer-focus-visible:ring-[#d946a8] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent
          `}
                >
                    {indeterminate && !checked ? (
                        <span className="w-[9px] h-[2px] rounded-full bg-white" />
                    ) : (
                        <FaCheck
                            className={`text-white text-[9px] transition-all duration-150 ${checked ? "scale-100 opacity-100" : "scale-50 opacity-0"
                                }`}
                        />
                    )}
                </span>
            </span>
            {label ? <span className="text-xs font-semibold">{label}</span> : null}
        </label>
    );
}

/* ─────────────────────────────────────────────────────────────
   2. ToggleSwitch — iOS-style, replaces filter checkboxes
   ───────────────────────────────────────────────────────────── */
export function ToggleSwitch({
    checked,
    onChange,
    label,
    count,
    accent = "#9E217B",
    disabled = false,
    title,
    isDark,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    count?: number;
    accent?: string;
    disabled?: boolean;
    title?: string;
    isDark: boolean;
}) {
    return (
        <label
            title={title}
            className={`inline-flex items-center gap-2.5 select-none ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                }`}
        >
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={disabled}
                onClick={() => !disabled && onChange(!checked)}
                className={`
          relative h-[20px] w-[36px] shrink-0 rounded-full
          transition-colors duration-200 ease-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          focus-visible:ring-offset-transparent
          ${disabled ? "cursor-not-allowed" : "cursor-pointer"}
        `}
                style={{
                    backgroundColor: checked
                        ? accent
                        : isDark
                            ? "rgba(255,255,255,0.13)"
                            : "rgba(0,0,0,0.14)",
                    boxShadow: checked ? `0 0 0 3px ${accent}22` : undefined,
                }}
            >
                <span
                    className="absolute top-[2px] left-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out"
                    style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
                />
            </button>
            <span
                className="text-xs font-semibold whitespace-nowrap"
                style={{ color: checked ? accent : undefined }}
            >
                {label}
                {typeof count === "number" && count > 0 ? (
                    <span className="ml-1 opacity-70">({count})</span>
                ) : null}
            </span>
        </label>
    );
}

/* ─────────────────────────────────────────────────────────────
   3. StatusChip — soft bg + border + icon, one system for all states
   ───────────────────────────────────────────────────────────── */
type ChipTone = "green" | "purple" | "orange" | "blue" | "red" | "gray" | "cyan";

const TONES: Record<
    ChipTone,
    { dark: string; light: string; dot: string }
> = {
    green: {
        dark: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
        light: "bg-emerald-50 text-emerald-700 border-emerald-200",
        dot: "text-emerald-400",
    },
    purple: {
        dark: "bg-[#9E217B]/15 text-[#e879c4] border-[#9E217B]/40",
        light: "bg-[#9E217B]/8 text-[#9E217B] border-[#9E217B]/25",
        dot: "text-[#d946a8]",
    },
    orange: {
        dark: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        light: "bg-amber-50 text-amber-700 border-amber-200",
        dot: "text-amber-400",
    },
    blue: {
        dark: "bg-blue-500/10 text-blue-300 border-blue-500/30",
        light: "bg-blue-50 text-blue-700 border-blue-200",
        dot: "text-blue-400",
    },
    red: {
        dark: "bg-red-500/10 text-red-300 border-red-500/30",
        light: "bg-red-50 text-red-700 border-red-200",
        dot: "text-red-400",
    },
    gray: {
        dark: "bg-white/[0.04] text-gray-400 border-white/10",
        light: "bg-gray-50 text-gray-500 border-gray-200",
        dot: "text-gray-400",
    },
    cyan: {
        dark: "bg-[#00AEEF]/10 text-[#7dd3fc] border-[#00AEEF]/30",
        light: "bg-[#00AEEF]/8 text-[#0284c7] border-[#00AEEF]/25",
        dot: "text-[#00AEEF]",
    },
};

function chipConfig(raw: string): { tone: ChipTone; Icon: any; text: string } {
    const s = (raw || "").trim().toLowerCase();
    if (s === "closing") return { tone: "orange", Icon: FaClock, text: "Closing" };
    if (s === "closed" || s === "booked")
        return { tone: "blue", Icon: FaKey, text: raw };
    if (s === "visit scheduled")
        return { tone: "cyan", Icon: FaCalendarCheck, text: "Visit Scheduled" };
    if (s === "assigned")
        return { tone: "purple", Icon: FaCircle, text: "Assigned" };
    if (s === "interested")
        return { tone: "green", Icon: FaCheckCircle, text: "Interested" };
    if (s === "not interested")
        return { tone: "red", Icon: FaTimesCircle, text: "Not Interested" };
    if (s === "lost" || s === "lost lead")
        return { tone: "red", Icon: FaTimesCircle, text: "Lost" };
    if (s === "active")
        return { tone: "green", Icon: FaCircle, text: "Active" };
    if (s === "pending")
        return { tone: "orange", Icon: FaClock, text: "Pending" };
    return { tone: "gray", Icon: FaCircle, text: raw || "—" };
}

export function StatusChip({
    status,
    isDark,
    size = "md",
}: {
    status: string;
    isDark: boolean;
    size?: "sm" | "md";
}) {
    const { tone, Icon, text } = chipConfig(status);
    const t = TONES[tone];
    return (
        <span
            className={`
        inline-flex items-center gap-1.5 rounded-full border font-bold uppercase
        whitespace-nowrap tracking-wide transition-colors
        ${size === "sm" ? "px-2 py-[3px] text-[9px]" : "px-2.5 py-[5px] text-[10px]"}
        ${isDark ? t.dark : t.light}
      `}
        >
            <Icon className={`${size === "sm" ? "text-[6px]" : "text-[7px]"} ${t.dot}`} />
            {text}
        </span>
    );
}

/* ─────────────────────────────────────────────────────────────
   4. ContactCell — phone + email, both actionable
   ───────────────────────────────────────────────────────────── */
const isBlank = (v: any) =>
    v == null ||
    String(v).trim() === "" ||
    ["n/a", "na", "-", "—", "pending", "null", "undefined"].includes(
        String(v).trim().toLowerCase()
    );

export function ContactCell({
    phone,
    email,
    isDark,
}: {
    phone?: string | null;
    email?: string | null;
    isDark: boolean;
}) {
    const hasPhone = !isBlank(phone);
    const hasEmail = !isBlank(email);
    if (!hasPhone && !hasEmail)
        return <span className="text-xs italic opacity-40">—</span>;

    const linkBase = `inline-flex items-center gap-1.5 text-xs transition-colors hover:underline ${isDark ? "hover:text-[#d946a8]" : "hover:text-[#9E217B]"
        }`;

    return (
        <div className="flex flex-col gap-[3px]" onClick={(e) => e.stopPropagation()}>
            {hasPhone && (
                <a
                    href={`tel:${String(phone).replace(/[^0-9+]/g, "")}`}
                    className={`${linkBase} font-mono font-medium`}
                    title={`Call ${phone}`}
                >
                    <FaPhoneAlt className="text-[9px] text-[#00AEEF] shrink-0" />
                    {phone}
                </a>
            )}
            {hasEmail ? (
                <a
                    href={`mailto:${email}`}
                    className={`${linkBase} opacity-70 max-w-[180px] truncate`}
                    title={String(email)}
                >
                    <FaEnvelope className="text-[9px] text-[#00AEEF] shrink-0" />
                    <span className="truncate">{email}</span>
                </a>
            ) : (
                <span className="text-[10px] italic opacity-30 pl-[15px]">
                    no email
                </span>
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   5. ActionMenu — three-dot menu, portalled so it never clips
   ───────────────────────────────────────────────────────────── */
export type MenuItem = {
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
    disabledReason?: string;
    divider?: boolean;
};

export function ActionMenu({
    items,
    isDark,
}: {
    items: MenuItem[];
    isDark: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!open || !btnRef.current) return;
        const r = btnRef.current.getBoundingClientRect();
        const MENU_W = 190;
        const MENU_H = items.length * 38 + 12;
        let top = r.bottom + 6;
        if (top + MENU_H > window.innerHeight - 8) top = r.top - MENU_H - 6;
        let left = r.right - MENU_W;
        if (left < 8) left = 8;
        setCoords({ top, left });
    }, [open, items.length]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (
                !menuRef.current?.contains(e.target as Node) &&
                !btnRef.current?.contains(e.target as Node)
            )
                setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        window.addEventListener("scroll", () => setOpen(false), true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <>
            <button
                ref={btnRef}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((o) => !o);
                }}
                title="Lead actions"
                aria-haspopup="menu"
                aria-expanded={open}
                className={`
          w-8 h-8 grid place-items-center rounded-lg transition-all duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d946a8]
          ${open
                        ? "bg-[#9E217B]/20 text-[#d946a8]"
                        : isDark
                            ? "text-gray-400 hover:bg-white/[0.07] hover:text-white"
                            : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }
        `}
            >
                <FaEllipsisV className="text-xs" />
            </button>

            {open &&
                typeof document !== "undefined" &&
                createPortal(
                    <div
                        ref={menuRef}
                        role="menu"
                        style={{ top: coords.top, left: coords.left, width: 190 }}
                        className={`
              fixed z-[9999] py-1.5 rounded-xl border shadow-2xl
              origin-top-right animate-[menuIn_150ms_ease-out]
              ${isDark
                                ? "bg-[#141419]/95 border-white/10 backdrop-blur-xl"
                                : "bg-white/95 border-gray-200 backdrop-blur-xl"
                            }
            `}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <style>{`@keyframes menuIn{from{opacity:0;transform:scale(.96) translateY(-4px)}to{opacity:1;transform:none}}`}</style>
                        {items.map((it, i) =>
                            it.divider ? (
                                <div
                                    key={`d${i}`}
                                    className={`my-1 h-px ${isDark ? "bg-white/10" : "bg-gray-200"}`}
                                />
                            ) : (
                                <button
                                    key={it.label}
                                    role="menuitem"
                                    disabled={it.disabled}
                                    title={it.disabled ? it.disabledReason : undefined}
                                    onClick={() => {
                                        if (it.disabled) return;
                                        setOpen(false);
                                        it.onClick?.();
                                    }}
                                    className={`
                    w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold
                    text-left transition-colors
                    ${it.disabled
                                            ? "opacity-35 cursor-not-allowed"
                                            : it.danger
                                                ? isDark
                                                    ? "text-red-300 hover:bg-red-500/15"
                                                    : "text-red-600 hover:bg-red-50"
                                                : isDark
                                                    ? "text-gray-200 hover:bg-white/[0.07]"
                                                    : "text-gray-700 hover:bg-gray-100"
                                        }
                  `}
                                >
                                    <span className="w-3.5 grid place-items-center opacity-80">
                                        {it.icon}
                                    </span>
                                    {it.label}
                                </button>
                            )
                        )}
                    </div>,
                    document.body
                )}
        </>
    );
}

/* ─────────────────────────────────────────────────────────────
   6. SearchBar — large, clearable, Ctrl+K focus
   ───────────────────────────────────────────────────────────── */
export function SearchBar({
    value,
    onChange,
    isDark,
    placeholder = "Search by Lead No, Name, Contact, Project...",
}: {
    value: string;
    onChange: (v: string) => void;
    isDark: boolean;
    placeholder?: string;
}) {
    const ref = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                ref.current?.focus();
                ref.current?.select();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <div className="relative flex-1 min-w-[240px] max-w-[520px]">
            <FaSearch
                className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none ${isDark ? "text-gray-500" : "text-gray-400"
                    }`}
            />
            <input
                ref={ref}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && onChange("")}
                placeholder={placeholder}
                className={`
          w-full h-9 pl-9 pr-20 rounded-xl text-xs font-medium outline-none border
          transition-all duration-200
          ${isDark
                        ? "bg-white/[0.04] border-white/10 text-white placeholder:text-gray-500 focus:border-[#9E217B]/60 focus:bg-white/[0.06]"
                        : "bg-gray-50 border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-[#9E217B]/50 focus:bg-white"
                    }
          focus:shadow-[0_0_0_3px_rgba(158,33,123,0.12)]
        `}
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {value ? (
                    <button
                        onClick={() => onChange("")}
                        title="Clear search"
                        className={`w-5 h-5 grid place-items-center rounded-md transition-colors ${isDark
                            ? "text-gray-400 hover:bg-white/10 hover:text-white"
                            : "text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                            }`}
                    >
                        <FaTimes className="text-[9px]" />
                    </button>
                ) : (
                    <kbd
                        className={`hidden sm:inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold border ${isDark
                            ? "bg-white/[0.05] border-white/10 text-gray-500"
                            : "bg-white border-gray-200 text-gray-400"
                            }`}
                    >
                        Ctrl K
                    </kbd>
                )}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   7. ToolbarButton — one design language for every action
   ───────────────────────────────────────────────────────────── */
export function ToolbarButton({
    onClick,
    icon,
    children,
    isDark,
    active = false,
    tone = "neutral",
    title,
    disabled = false,
}: {
    onClick?: () => void;
    icon?: React.ReactNode;
    children?: React.ReactNode;
    isDark: boolean;
    active?: boolean;
    tone?: "neutral" | "brand" | "danger";
    title?: string;
    disabled?: boolean;
}) {
    const base =
        "h-9 inline-flex items-center gap-2 px-3 rounded-xl text-xs font-bold whitespace-nowrap border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d946a8] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent";
    const style =
        disabled
            ? "opacity-40 cursor-not-allowed"
            : tone === "danger"
                ? "bg-red-600 border-red-600 text-white hover:bg-red-500 hover:-translate-y-[1px] hover:shadow-lg hover:shadow-red-900/30"
                : active || tone === "brand"
                    ? isDark
                        ? "bg-[#9E217B]/20 border-[#9E217B]/60 text-[#e879c4] hover:bg-[#9E217B]/30"
                        : "bg-[#9E217B]/10 border-[#9E217B]/40 text-[#9E217B] hover:bg-[#9E217B]/15"
                    : isDark
                        ? "bg-white/[0.04] border-white/10 text-gray-200 hover:bg-white/[0.08] hover:border-white/20 hover:-translate-y-[1px]"
                        : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:-translate-y-[1px] hover:shadow-sm";

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={`${base} ${style}`}
        >
            {icon}
            {children}
        </button>
    );
}

/* ─────────────────────────────────────────────────────────────
   8. ColumnSelector — real show/hide, persisted by caller
   ───────────────────────────────────────────────────────────── */
export function ColumnSelector({
    columns,
    hidden,
    onToggle,
    onReset,
    isDark,
}: {
    columns: { key: string; label: string; locked?: boolean }[];
    hidden: Set<string>;
    onToggle: (key: string) => void;
    onReset: () => void;
    isDark: boolean;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) =>
            !wrapRef.current?.contains(e.target as Node) && setOpen(false);
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    const shownCount = columns.length - hidden.size;

    return (
        <div ref={wrapRef} className="relative">
            <ToolbarButton
                onClick={() => setOpen((o) => !o)}
                icon={<FaColumns className="text-[11px]" />}
                isDark={isDark}
                active={open}
                title="Choose visible columns"
            >
                Columns
                <span className="opacity-60 font-semibold">
                    {shownCount}/{columns.length}
                </span>
            </ToolbarButton>

            {open && (
                <div
                    className={`
            absolute right-0 top-11 z-50 w-[230px] max-h-[340px] overflow-y-auto
            rounded-xl border shadow-2xl p-2
            ${isDark
                            ? "bg-[#141419]/95 border-white/10 backdrop-blur-xl"
                            : "bg-white/95 border-gray-300 backdrop-blur-xl"
                        }
          `}
                >
                    <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-current/10">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-50">
                            Visible columns
                        </span>
                        <button
                            onClick={onReset}
                            className="text-[10px] font-bold text-[#00AEEF] hover:underline"
                        >
                            Reset
                        </button>
                    </div>
                    {columns.map((c) => (
                        <div
                            key={c.key}
                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-colors ${c.locked
                                ? "opacity-40"
                                : isDark
                                    ? "hover:bg-white/[0.06]"
                                    : "hover:bg-gray-100"
                                }`}
                        >
                            <Checkbox
                                checked={!hidden.has(c.key)}
                                disabled={c.locked}
                                onChange={() => onToggle(c.key)}
                                title={c.locked ? "Always visible" : undefined}
                            />
                            <span className="text-xs font-semibold">{c.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   9. SortIcon
   ───────────────────────────────────────────────────────────── */
export function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
    if (dir === "asc") return <FaSortUp className="text-[9px] text-[#d946a8]" />;
    if (dir === "desc") return <FaSortDown className="text-[9px] text-[#d946a8]" />;
    return <FaSort className="text-[9px] opacity-20 group-hover:opacity-50 transition-opacity" />;
}

/* ─────────────────────────────────────────────────────────────
   10. SkeletonRows — replaces "Syncing..."
   ───────────────────────────────────────────────────────────── */
export function SkeletonRows({
    rows = 8,
    cols,
    isDark,
}: {
    rows?: number;
    cols: number;
    isDark: boolean;
}) {
    const shimmer = isDark ? "bg-white/[0.07]" : "bg-gray-200/80";
    return (
        <>
            {Array.from({ length: rows }).map((_, r) => (
                <tr key={r} className={isDark ? "border-white/[0.04]" : "border-gray-300"}>
                    {Array.from({ length: cols }).map((__, c) => (
                        <td key={c} className="px-3 py-4">
                            <div
                                className={`h-3 rounded-full ${shimmer} animate-pulse`}
                                style={{
                                    width: c === 0 ? "40%" : c === 1 ? "80%" : `${45 + ((r + c) % 4) * 12}%`,
                                    animationDelay: `${(r * cols + c) * 22}ms`,
                                }}
                            />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

/* ─────────────────────────────────────────────────────────────
   11. EmptyState
   ───────────────────────────────────────────────────────────── */
export function EmptyState({
    onReset,
    hasFilters,
    isDark,
}: {
    onReset: () => void;
    hasFilters: boolean;
    isDark: boolean;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div
                className={`w-16 h-16 rounded-2xl grid place-items-center mb-4 ${isDark ? "bg-white/[0.04] border border-white/10" : "bg-gray-50 border border-gray-200"
                    }`}
            >
                <FaInbox className="text-2xl opacity-25" />
            </div>
            <p className="text-sm font-bold mb-1">No leads found</p>
            <p className="text-xs opacity-50 mb-5 max-w-[300px]">
                {hasFilters
                    ? "No leads match the current filters. Clear them to see the full list."
                    : "Leads will appear here once they're added or imported."}
            </p>
            {hasFilters && (
                <ToolbarButton onClick={onReset} isDark={isDark} tone="brand">
                    Clear all filters
                </ToolbarButton>
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   12. Pagination — bottom-right, rows-per-page
   ───────────────────────────────────────────────────────────── */
export function Pagination({
    page,
    rowsPerPage,
    total,
    onPageChange,
    onRowsPerPageChange,
    isDark,
}: {
    page: number;
    rowsPerPage: number;
    total: number;
    onPageChange: (p: number) => void;
    onRowsPerPageChange: (n: number) => void;
    isDark: boolean;
}) {
    const pageCount = Math.max(1, Math.ceil(total / rowsPerPage));
    const from = total === 0 ? 0 : (page - 1) * rowsPerPage + 1;
    const to = Math.min(page * rowsPerPage, total);

    const pages: (number | "…")[] = [];
    if (pageCount <= 7) {
        for (let i = 1; i <= pageCount; i++) pages.push(i);
    } else {
        pages.push(1);
        if (page > 3) pages.push("…");
        for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i++)
            pages.push(i);
        if (page < pageCount - 2) pages.push("…");
        pages.push(pageCount);
    }

    const navBtn = `w-8 h-8 grid place-items-center rounded-lg text-xs font-bold transition-all duration-200 disabled:opacity-25 disabled:cursor-not-allowed ${isDark ? "hover:bg-white/[0.08]" : "hover:bg-gray-100"
        }`;

    return (
        <div
            className={`flex flex-wrap items-center justify-between gap-4 px-5 py-3 border-t ${isDark ? "border-white/[0.06]" : "border-gray-200"
                }`}
        >
            <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-semibold opacity-50">Rows per page</span>
                <select
                    value={rowsPerPage}
                    onChange={(e) => {
                        onRowsPerPageChange(Number(e.target.value));
                        onPageChange(1);
                    }}
                    className={`h-8 px-2 rounded-lg text-xs font-bold outline-none border cursor-pointer transition-colors ${isDark
                        ? "bg-white/[0.04] border-white/10 text-white hover:border-white/25"
                        : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                        }`}
                >
                    {[25, 50, 100, 200].map((n) => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex items-center gap-4">
                <span className="text-[11px] font-semibold opacity-50 whitespace-nowrap">
                    Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of{" "}
                    {total.toLocaleString("en-IN")} leads
                </span>
                <div className="flex items-center gap-1">
                    <button
                        className={navBtn}
                        disabled={page <= 1}
                        onClick={() => onPageChange(page - 1)}
                        title="Previous page"
                    >
                        <FaChevronLeft className="text-[9px]" />
                    </button>
                    {pages.map((p, i) =>
                        p === "…" ? (
                            <span key={`e${i}`} className="w-6 text-center text-xs opacity-30">
                                …
                            </span>
                        ) : (
                            <button
                                key={p}
                                onClick={() => onPageChange(p)}
                                className={`w-8 h-8 grid place-items-center rounded-lg text-xs font-bold transition-all duration-200 ${p === page
                                    ? "bg-[#9E217B] text-white shadow-[0_0_0_3px_rgba(158,33,123,0.18)]"
                                    : isDark
                                        ? "hover:bg-white/[0.08] text-gray-300"
                                        : "hover:bg-gray-100 text-gray-600"
                                    }`}
                            >
                                {p}
                            </button>
                        )
                    )}
                    <button
                        className={navBtn}
                        disabled={page >= pageCount}
                        onClick={() => onPageChange(page + 1)}
                        title="Next page"
                    >
                        <FaChevronRight className="text-[9px]" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export { isBlank };