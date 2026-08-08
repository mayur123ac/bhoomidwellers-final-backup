"use client";

// components/CallingButtons.tsx — the Manual Call and AI Call tiles that sit
// beside the WhatsApp button on every contact.
//
// ── Why tiles and not icon buttons ───────────────────────────────────────────
// Every place these mount is an existing `grid grid-cols-2 gap-3` of quick
// actions whose members are icon-over-label tiles. Two 28px icon buttons dropped
// into that grid would read as a different control set that happened to land
// nearby, so these copy the tile shape instead.
//
// ── Why the wrapper span ─────────────────────────────────────────────────────
// A disabled <button> does not emit pointer events in any browser, so a tooltip
// bound to the button is invisible in exactly the state that most needs
// explaining. The hover and focus handlers therefore live on a wrapping span,
// and the disabled button carries `pointer-events-none` so the span sees the
// events. `aria-describedby` plus a focusable wrapper keeps it reachable by
// keyboard, which a `title` attribute on a disabled control is not.

import { useCallback, useId, useRef, useState } from "react";
import { FaPhoneAlt, FaRobot, FaSpinner } from "react-icons/fa";
import { useCallingConfig } from "@/hooks/useCallingConfig";
import { placeAiCall, placeManualCall } from "@/lib/callingHandlers";

interface Props {
  /** walkin_enquiries.id. The server re-reads the number from this. */
  leadId?: number | null;
  /** caller_leads.id, for the tele-calling list. */
  callerLeadId?: number | null;
  /** Display only, and the fallback dial target when there is no lead id. */
  phone?: string | null;
  leadName?: string | null;
  isDark?: boolean;
  /** Matches the sibling WhatsApp tile, which varies between panels. */
  iconClass?: string;
  paddingClass?: string;
}

type Toast = { kind: "ok" | "error"; message: string } | null;

/** Mirrors the server's own validity rule closely enough to grey out early. */
function hasDialableNumber(phone: string | null | undefined): boolean {
  return String(phone ?? "").replace(/\D/g, "").length >= 10;
}

export default function CallingButtons({
  leadId = null,
  callerLeadId = null,
  phone = null,
  leadName = null,
  isDark = true,
  iconClass = "text-base",
  paddingClass = "py-2.5",
}: Props) {
  const { aiCallingEnabled, manualCallingMode, loaded } = useCallingConfig();
  const [busy, setBusy] = useState<null | "manual" | "ai">(null);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((kind: "ok" | "error", message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ kind, message });
    // Errors linger; a failure message that vanishes in 3s has to be
    // re-triggered to be read.
    toastTimer.current = setTimeout(() => setToast(null), kind === "error" ? 8000 : 4000);
  }, []);

  // A record with no usable number is the one case that disables both buttons.
  const dialable = hasDialableNumber(phone) || leadId !== null || callerLeadId !== null;
  const knownMissing = !hasDialableNumber(phone) && leadId === null && callerLeadId === null;

  // Manual calling always has the tel: fallback, so only a missing number
  // disables it. AI calling has no fallback: without Bolna there is nothing to
  // call with. `loaded` keeps the AI tile disabled until the answer arrives
  // rather than letting it flip enabled a moment after paint.
  const manualDisabled = !dialable || busy !== null;
  const aiDisabled = !dialable || !aiCallingEnabled || !loaded || busy !== null;

  const manualTip = knownMissing
    ? "No phone number on record"
    : manualCallingMode === "provider"
      ? `Click to call — your phone rings first, then connects to ${leadName || phone || "this contact"}`
      : `Open your phone dialler for ${phone || "this contact"}`;

  const aiTip = knownMissing
    ? "No phone number on record"
    : !loaded
      ? "Checking calling configuration…"
      : !aiCallingEnabled
        ? "AI calling not configured — add Bolna credentials in Settings → Workspace"
        : `Have the AI agent call ${leadName || phone || "this contact"}`;

  const runManual = async () => {
    if (manualDisabled) return;
    setBusy("manual");
    try {
      const result = await placeManualCall({
        leadId,
        callerLeadId,
        phone,
        mode: manualCallingMode,
      });
      // `tel:` hands off to the OS and has nothing to report.
      if (result?.message) notify("ok", result.message);
    } catch (err: any) {
      notify("error", err?.message || "The call could not be placed.");
    } finally {
      setBusy(null);
    }
  };

  const runAi = async () => {
    if (aiDisabled) return;
    setBusy("ai");
    try {
      const result = await placeAiCall({ leadId, callerLeadId, phone, leadName });
      notify("ok", result?.message || "Call placed.");
    } catch (err: any) {
      notify("error", err?.message || "The AI call could not be placed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Tile
        label="Manual Call"
        tooltip={manualTip}
        disabled={manualDisabled}
        busy={busy === "manual"}
        onClick={runManual}
        icon={<FaPhoneAlt className={iconClass} />}
        paddingClass={paddingClass}
        isDark={isDark}
        tone="green"
      />
      <Tile
        label="AI Call"
        tooltip={aiTip}
        disabled={aiDisabled}
        busy={busy === "ai"}
        onClick={runAi}
        icon={<FaRobot className={iconClass} />}
        paddingClass={paddingClass}
        isDark={isDark}
        tone="purple"
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[200] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-2xl animate-fadeIn"
          style={{
            background: isDark ? "#1a1a1a" : "#ffffff",
            borderColor: toast.kind === "error" ? "rgba(239,68,68,0.5)" : "rgba(16,185,129,0.5)",
            color: isDark ? "#f3f4f6" : "#1A1A1A",
          }}
        >
          <span className="mr-2" aria-hidden>
            {toast.kind === "error" ? "✕" : "✓"}
          </span>
          {toast.message}
        </div>
      )}
    </>
  );
}

/* ── One quick-action tile ──────────────────────────────────────────────────*/

const TONES = {
  green: {
    dark: "bg-green-600/10 border-green-500/30 hover:bg-green-600 text-green-400 hover:text-white",
    light: "bg-green-600/10 border-green-500/30 hover:bg-green-600 text-green-700 hover:text-white",
  },
  purple: {
    dark: "bg-purple-600/10 border-purple-500/30 hover:bg-purple-600 text-purple-400 hover:text-white",
    light: "bg-purple-600/10 border-purple-500/30 hover:bg-purple-600 text-purple-700 hover:text-white",
  },
} as const;

const DISABLED = {
  dark: "bg-[#1a1a1a] border-[#2a2a2a] text-gray-600",
  light: "bg-gray-100 border-gray-200 text-gray-400",
} as const;

function Tile({
  label,
  tooltip,
  disabled,
  busy,
  onClick,
  icon,
  paddingClass,
  isDark,
  tone,
}: {
  label: string;
  tooltip: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  paddingClass: string;
  isDark: boolean;
  tone: keyof typeof TONES;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const theme = isDark ? "dark" : "light";

  return (
    // The span, not the button, carries the pointer handlers — see the note at
    // the top of the file. tabIndex makes the explanation reachable by keyboard
    // when the button itself is disabled and therefore unfocusable.
    <span
      className="relative flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={disabled ? 0 : -1}
      aria-describedby={open ? tipId : undefined}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className={[
          "border flex flex-col items-center justify-center rounded-xl transition-all gap-1 w-full",
          paddingClass,
          disabled
            ? `cursor-not-allowed pointer-events-none ${DISABLED[theme]}`
            : `cursor-pointer ${TONES[tone][theme]}`,
        ].join(" ")}
      >
        {busy ? <FaSpinner className="animate-spin text-base" /> : icon}
        <span className="font-bold text-[10px]">{label}</span>
      </button>

      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-[120] mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium leading-snug shadow-xl"
          style={{
            background: isDark ? "#000000" : "#1A1A1A",
            color: "#ffffff",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}
