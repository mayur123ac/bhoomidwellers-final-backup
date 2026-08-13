"use client";

// components/bhoomi-ai/ChatMessage.tsx — one conversation turn.
//
// The assistant answer is deliberately NOT in a card. It used to sit in a
// full-width bordered rectangle, which read as a dashboard tile rather than
// something someone said. An answer is now an identity row and a column of
// prose, differentiated from the user's turn by alignment and typography rather
// than by a border. The user's turn keeps a bubble, because that contrast is
// what makes the thread scannable.

import { useState } from "react";
import { FaRegCopy, FaCheck, FaRotateRight } from "react-icons/fa6";
import BhoomiAiIcon from "./BhoomiAiIcon";
import Markdown from "./Markdown";
import { CANVAS_RAISED, moduleLabel, type AiTheme } from "./theme";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

/* ── Avatar ─────────────────────────────────────────────────────────────────*/

/**
 * Thin wrapper over the single Bhoomi AI mark, kept because several call sites
 * already import `AiAvatar`. The old gradient ran magenta → orange; orange is
 * not a brand colour and made the mark read as a third palette. It is now the
 * magenta → blue pair, and the glyph is a spark rather than a wand.
 */
export function AiAvatar({ size = 32, thinking = false }: { size?: number; thinking?: boolean }) {
  return <BhoomiAiIcon size={size} state={thinking ? "thinking" : "idle"} />;
}

/* ── User ───────────────────────────────────────────────────────────────────*/

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] px-4 py-2.5 text-[14.5px] leading-[1.6] sm:max-w-[72%]"
        style={{
          // #1E1F20 per the brief, not the old magenta gradient. On a #131314
          // canvas a saturated bubble every other turn is the loudest thing on
          // screen; the raised surface separates the turns without shouting, and
          // leaves magenta→blue to mean "AI activity" and nothing else.
          background: CANVAS_RAISED,
          color: "#E3E3E3",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {content}
      </div>
    </div>
  );
}

/* ── Assistant ──────────────────────────────────────────────────────────────*/

export function AssistantMessage({
  turn,
  t,
  isDark,
  onRegenerate,
  canRegenerate,
}: {
  turn: Turn;
  t: AiTheme;
  isDark: boolean;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (no focus, or denied) — no useful recovery */
    }
  };

  const actionBtn =
    "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-2";

  return (
    <div className="group">
      {/* Identity row — the avatar belongs to the answer, so it sits on the
          same baseline as the name rather than floating beside the text. */}
      <div className="mb-2 flex items-center gap-2.5">
        <AiAvatar />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold" style={{ color: t.text }}>
            Bhoomi AI
          </div>
          <div className="text-[11px]" style={{ color: t.textFaint }}>
            Business Analyst
          </div>
        </div>
      </div>

      {/* Indented to the avatar's optical column so the answer reads as one
          block belonging to that speaker. */}
      <div className="pl-[42px]">
        <Markdown content={turn.content} t={t} />

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {turn.sources?.map((s) => (
            <span
              key={s}
              className="rounded-full px-2 py-[3px] text-[10.5px] font-semibold capitalize"
              style={{
                background: isDark ? "rgba(217,70,168,0.10)" : "rgba(158,33,123,0.07)",
                border: `1px solid ${isDark ? "rgba(217,70,168,0.26)" : "rgba(158,33,123,0.20)"}`,
                color: t.accent,
              }}
              title="CRM module this answer was built from"
            >
              {moduleLabel(s)}
            </span>
          ))}

          {/* Actions reveal on hover but are always reachable by keyboard —
              opacity, not conditional rendering, so focus can land on them. */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={copy}
              className={actionBtn}
              style={{ color: copied ? t.accent : t.textFaint }}
              aria-label="Copy answer"
              title="Copy answer"
            >
              {copied ? <FaCheck className="text-[10px]" /> : <FaRegCopy className="text-[10px]" />}
              {copied ? "Copied" : "Copy"}
            </button>

            {/* Only rendered when it can actually run: the last answer, with no
                request in flight. A Regenerate that silently did nothing would
                be worse than none. */}
            {canRegenerate && onRegenerate && (
              <button
                onClick={onRegenerate}
                className={actionBtn}
                style={{ color: t.textFaint }}
                aria-label="Regenerate answer"
                title="Ask again"
              >
                <FaRotateRight className="text-[10px]" />
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Thinking ───────────────────────────────────────────────────────────────*/

export function ThinkingIndicator({ t }: { t: AiTheme }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2.5">
        {/* The mark itself carries the thinking state — a gradient sweep and a
            slow breath. No spinner ring and no rotation: those read as "loading
            forever" rather than "the assistant is working". */}
        <AiAvatar thinking />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold" style={{ color: t.text }}>
            Bhoomi AI
          </div>
          <div className="text-[11px]" style={{ color: t.textFaint }}>
            Business Analyst
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 pl-[42px]">
        {/* aria-live on the container that changes, plus a text label for
            screen readers — three animated dots announce nothing on their own. */}
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: t.accent, animation: `bdai-dot 1.3s ${d * 0.16}s infinite ease-in-out` }}
            />
          ))}
        </span>
        <span className="text-[13px]" style={{ color: t.textMuted }} role="status">
          Analyzing your CRM data…
        </span>
      </div>
    </div>
  );
}
