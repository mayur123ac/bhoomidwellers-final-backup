"use client";

// components/bhoomi-ai/ChatWelcome.tsx — the zero-message state.
//
// The suggestions are worded to match what the assistant's tools can actually
// answer (revenue, leads, performance, inventory, registrations, loans). A
// starter that reliably produces "I don't have data for that" teaches people
// the assistant is useless, so the list is deliberately conservative.

import type { IconType } from "react-icons";
import {
  FaArrowTrendUp,
  FaIndianRupeeSign,
  FaUsers,
  FaBuilding,
  FaFileSignature,
  FaTriangleExclamation,
} from "react-icons/fa6";
import BhoomiAiIcon from "./BhoomiAiIcon";
import type { AiTheme } from "./theme";

const SUGGESTIONS: { icon: IconType; label: string }[] = [
  { icon: FaArrowTrendUp, label: "Give me today's lead summary" },
  { icon: FaIndianRupeeSign, label: "How much OCR was collected this month?" },
  { icon: FaUsers, label: "Which sales manager is performing best?" },
  { icon: FaFileSignature, label: "Show bookings awaiting registration" },
  { icon: FaBuilding, label: "What inventory is still unsold?" },
  { icon: FaTriangleExclamation, label: "What is the total balance receivable?" },
];

export default function ChatWelcome({
  t,
  isDark,
  onPick,
  disabled,
}: {
  t: AiTheme;
  isDark: boolean;
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-10 text-center sm:py-16">
      {/* Gently appears on entry — opacity 0→1, scale 0.9→1, once. This is the
          "AI workspace activating inside the CRM" moment; the shell around it
          does not move. */}
      <BhoomiAiIcon size={46} animateIn />

      <h1 className="mt-5 text-[26px] font-bold tracking-tight" style={{ color: t.text }}>
        Bhoomi AI
      </h1>
      <p className="mt-1.5 text-[15px] font-medium" style={{ color: t.textMuted }}>
        What would you like to know?
      </p>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed" style={{ color: t.textFaint }}>
        Ask about your leads, bookings, revenue, inventory or team performance. Answers are built
        from live CRM data.
      </p>

      {!disabled && (
        <div className="mt-8 grid w-full max-w-[680px] gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map(({ icon: Icon, label }) => (
            <button
              key={label}
              onClick={() => onPick(label)}
              className="group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left text-[13px] transition-colors duration-200"
              style={{ borderColor: t.border, background: t.surfaceRaised, color: t.textMuted }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = t.accent;
                e.currentTarget.style.color = t.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = t.border;
                e.currentTarget.style.color = t.textMuted;
              }}
            >
              <span
                className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg"
                style={{
                  // Restrained magenta tint on the dark canvas — the suggestion
                  // icons are supporting detail, not AI-activity signals, so they
                  // do not carry the gradient.
                  background: "rgba(217,70,168,0.13)",
                  color: t.accent,
                }}
              >
                <Icon className="text-[12px]" />
              </span>
              <span className="min-w-0 flex-1 leading-snug">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
