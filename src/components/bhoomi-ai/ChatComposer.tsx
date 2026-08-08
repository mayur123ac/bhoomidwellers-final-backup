"use client";

// components/bhoomi-ai/ChatComposer.tsx — the input.
//
// Owns its own draft state. That is the point of it being a component: while
// someone types, only this subtree re-renders. When the draft lived in the
// panel, every keystroke re-rendered the whole thread, which is exactly the
// "rerendering the conversation while typing" cost to avoid at 50+ messages.
// The parent is told only when a message is actually sent.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FaArrowUp } from "react-icons/fa6";
import type { AiTheme } from "./theme";

export interface ComposerHandle {
  focus: () => void;
  setDraft: (text: string) => void;
}

interface Props {
  t: AiTheme;
  isDark: boolean;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string) => void;
}

const ChatComposer = forwardRef<ComposerHandle, Props>(function ChatComposer(
  { t, isDark, busy, disabled, placeholder, onSend },
  ref
) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // An IME composing Hindi or Marathi fires Enter to commit the candidate.
  // Sending on that keystroke would submit a half-typed word.
  const composing = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setDraft: (text: string) => {
      setDraft(text);
      taRef.current?.focus();
    },
  }));

  // Auto-grow, capped so a pasted report cannot swallow the thread.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || disabled) return;
    setDraft("");
    onSend(text);
  };

  const canSend = Boolean(draft.trim()) && !busy && !disabled;

  return (
    <div className="w-full">
      <div
        className="flex items-end gap-2 rounded-[22px] border px-3 py-2 transition-shadow duration-200"
        style={{
          background: t.surfaceRaised,
          borderColor: focused ? t.accent : t.border,
          boxShadow: focused
            ? `0 0 0 3px ${t.ring}, 0 4px 20px rgba(36,10,30,${isDark ? "0.4" : "0.07"})`
            : `0 1px 3px rgba(36,10,30,${isDark ? "0.35" : "0.05"})`,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <textarea
          ref={taRef}
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          aria-label="Message Bhoomi AI"
          className="max-h-[180px] min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-[1.55] outline-none disabled:cursor-not-allowed"
          style={{ color: t.text }}
        />

        <button
          onClick={send}
          disabled={!canSend}
          aria-label={busy ? "Waiting for response" : "Send message"}
          title="Send  ·  Enter"
          className="mb-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed"
          style={{
            // Idle is a flat tint; the gradient only appears once there is
            // something to send, so the button reads as "armed".
            background: canSend
              ? "linear-gradient(135deg,#9E217B 0%,#c7299a 100%)"
              : isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(158,33,123,0.08)",
            color: canSend ? "#fff" : t.textFaint,
            boxShadow: canSend ? "0 2px 10px rgba(158,33,123,0.35)" : "none",
          }}
        >
          {busy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <FaArrowUp className="text-[13px]" />
          )}
        </button>
      </div>

      <p className="mt-2.5 text-center text-[10.5px]" style={{ color: t.textFaint }}>
        Bhoomi AI can make mistakes. Verify important figures before acting on them.
      </p>
    </div>
  );
});

export default ChatComposer;
