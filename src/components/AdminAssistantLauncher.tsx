"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * AdminAssistantLauncher
 * ----------------------
 * Floating launcher for the Admin AI Analyst.
 *
 * The bot has a face, and the face is honest: it reflects how long the
 * assistant has gone unused. Neglected -> droopy. Recently used -> content.
 * Something waiting -> excited. Hover always cheers it up instantly.
 *
 * Zero new dependencies. CSS transforms + opacity only. No JS animation loop.
 */

const LAST_OPENED_KEY = "bd:adminai:lastOpened:v1";
const DISCOVERY_KEY = "bd:adminai:discovery:v1";

const CONTENT_WINDOW_MS = 2 * 60 * 60 * 1000; // used within 2h  -> content
const NEUTRAL_WINDOW_MS = 8 * 60 * 60 * 1000; // used within 8h  -> neutral
const MOOD_TICK_MS = 5 * 60 * 1000; // re-check mood every 5 min

const DISCOVERY_DELAY_MS = 4000;
const WAVE_MS = 820;
const HINT_MS = 3200;

type Mood = "content" | "neutral" | "sad" | "excited";

type Props = {
    isDark: boolean;
    /** Opens the existing dock. Wire to setOpen(true). */
    onOpen: () => void;
    /** True while the dock panel is open. */
    active?: boolean;
    /** Only pass true when there is a real insight waiting. */
    hasInsight?: boolean;
    /** Overrides the default time-of-day hint shown during discovery. */
    hint?: string;
};

function readLastOpened(): number {
    try {
        return Number(localStorage.getItem(LAST_OPENED_KEY) || 0);
    } catch {
        return 0;
    }
}

function computeMood(hasInsight: boolean, active: boolean): Mood {
    if (hasInsight) return "excited";
    if (active) return "content";
    const last = readLastOpened();
    if (!last) return "neutral"; // never used yet — curious, not sulking
    const idle = Date.now() - last;
    if (idle < CONTENT_WINDOW_MS) return "content";
    if (idle < NEUTRAL_WINDOW_MS) return "neutral";
    return "sad";
}

function defaultHint(): string {
    const h = new Date().getHours();
    if (h < 12) return "Ask me about today";
    if (h < 17) return "Want a revenue summary?";
    return "Review today's leads?";
}

export default function AdminAssistantLauncher({
    isDark,
    onOpen,
    active = false,
    hasInsight = false,
    hint,
}: Props) {
    const [mood, setMood] = useState<Mood>("neutral");
    const [waving, setWaving] = useState(false);
    const [hinting, setHinting] = useState(false);
    const [pressed, setPressed] = useState(false);

    const rootRef = useRef<HTMLButtonElement>(null);
    const avatarRef = useRef<HTMLSpanElement>(null);
    const rafRef = useRef(0);
    const reduceRef = useRef(false);
    const hintRef = useRef("");
    if (!hintRef.current) hintRef.current = hint || defaultHint();

    /* ---------------- mood ---------------- */
    useEffect(() => {
        setMood(computeMood(hasInsight, active));
        const id = window.setInterval(
            () => setMood(computeMood(hasInsight, active)),
            MOOD_TICK_MS
        );
        return () => clearInterval(id);
    }, [hasInsight, active]);

    /* ---------------- discovery wave (once per tab session) ---------------- */
    useEffect(() => {
        if (typeof window === "undefined") return;
        reduceRef.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (active || reduceRef.current) return;

        let seen = false;
        let usedRecently = false;
        try {
            seen = sessionStorage.getItem(DISCOVERY_KEY) === "1";
            const last = readLastOpened();
            usedRecently = last > 0 && Date.now() - last < CONTENT_WINDOW_MS;
        } catch {
            seen = true; // storage blocked — fail quiet, never nag
        }
        if (seen || usedRecently) return;

        const timers: number[] = [];
        timers.push(
            window.setTimeout(() => {
                try {
                    sessionStorage.setItem(DISCOVERY_KEY, "1");
                } catch {
                    /* noop */
                }
                setWaving(true);
                setHinting(true);
                timers.push(window.setTimeout(() => setWaving(false), WAVE_MS));
                timers.push(window.setTimeout(() => setHinting(false), HINT_MS));
            }, DISCOVERY_DELAY_MS)
        );
        return () => timers.forEach(clearTimeout);
    }, [active]);

    /* ---------------- eyes follow cursor while hovered ---------------- */
    const trackEyes = useCallback((e: React.MouseEvent) => {
        if (reduceRef.current || rafRef.current) return;
        const cx = e.clientX;
        const cy = e.clientY;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            const el = rootRef.current;
            const av = avatarRef.current;
            if (!el || !av) return;
            const r = av.getBoundingClientRect();
            const dx = Math.max(-1.8, Math.min(1.8, (cx - (r.left + r.width / 2)) / 26));
            const dy = Math.max(-1.2, Math.min(1.2, (cy - (r.top + r.height / 2)) / 30));
            el.style.setProperty("--bdai-eye-x", `${dx}px`);
            el.style.setProperty("--bdai-eye-y", `${dy}px`);
        });
    }, []);

    const restEyes = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = 0;
        }
        const el = rootRef.current;
        if (el) {
            el.style.setProperty("--bdai-eye-x", "0px");
            el.style.setProperty("--bdai-eye-y", "0px");
        }
    }, []);

    useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

    const handleClick = useCallback(() => {
        try {
            localStorage.setItem(LAST_OPENED_KEY, String(Date.now()));
        } catch {
            /* noop */
        }
        setWaving(false);
        setHinting(false);
        setMood("content");
        onOpen();
    }, [onOpen]);

    return (
        <>
            <style>{CSS}</style>

            <div
                className="fixed right-5 z-50 flex flex-col items-end gap-2 sm:right-6"
                style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
            >
                {/* contextual hint — shows once with the wave, then leaves */}
                {hinting && (
                    <div
                        role="status"
                        className={`bdai-hint pointer-events-none mr-2 rounded-xl border px-3 py-1.5 text-xs font-medium shadow-lg ${isDark
                            ? "border-[#3a2438] bg-[#1c1420] text-neutral-200"
                            : "border-[#9E217B]/15 bg-white text-neutral-700"
                            }`}
                    >
                        {hintRef.current}
                    </div>
                )}

                <button
                    ref={rootRef}
                    type="button"
                    onClick={handleClick}
                    onMouseMove={trackEyes}
                    onMouseLeave={() => { restEyes(); setPressed(false); }}
                    onMouseDown={() => setPressed(true)}
                    onMouseUp={() => setPressed(false)}
                    aria-label="Open Admin AI"
                    title="Open Admin AI"
                    data-pressed={pressed || undefined}
                    data-active={active || undefined}
                    className="bdai-btn group flex h-[58px] items-center gap-2 rounded-full px-2.5 pr-3 text-white shadow-xl sm:pr-4"
                >
                    {/* ---------- avatar tile ---------- */}
                    <span
                        ref={avatarRef}
                        className="bdai-avatar relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-2xl"
                    >
                        <svg
                            viewBox="0 0 44 44"
                            className="bdai-bot relative h-[34px] w-[34px]"
                            data-mood={mood}
                            aria-hidden="true"
                        >
                            {/* antenna — droops and dims when neglected */}
                            <g className="bdai-antenna">
                                <line x1="22" y1="9.6" x2="22" y2="14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.8" />
                                <circle className="bdai-beacon-glow" cx="22" cy="6.6" r="4.8" fill="#F472C6" />
                                <circle className="bdai-beacon" cx="22" cy="6.6" r="2.6" fill="#FBCFE8" />
                            </g>

                            {/* ears */}
                            <rect x="4.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />
                            <rect x="36.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />

                            {/* head */}
                            <rect x="8" y="13.4" width="28" height="24" rx="9" fill="currentColor" />

                            {/* brows — the main carrier of mood */}
                            <g className="bdai-brows" fill="none" stroke="#5B1046" strokeWidth="1.7" strokeLinecap="round">
                                <path className="bdai-brow bdai-brow-l" d="M13.4 19.6 h5.2" />
                                <path className="bdai-brow bdai-brow-r" d="M25.4 19.6 h5.2" />
                            </g>

                            {/* eyes */}
                            <g className="bdai-eyes">
                                <g className="bdai-blinker bdai-blinker-l">
                                    <ellipse className="bdai-eye" cx="16.8" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
                                    <circle className="bdai-glint" cx="17.7" cy="23.1" r="0.85" fill="#FFFFFF" opacity="0.9" />
                                </g>
                                <g className="bdai-blinker bdai-blinker-r">
                                    <ellipse className="bdai-eye" cx="27.2" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
                                    <circle className="bdai-glint" cx="28.1" cy="23.1" r="0.85" fill="#FFFFFF" opacity="0.9" />
                                </g>
                            </g>

                            {/* mouths — crossfaded, never morphed */}
                            <g fill="none" stroke="#5B1046" strokeWidth="1.9" strokeLinecap="round">
                                <path className="bdai-mouth bdai-mouth-neutral" d="M18.4 31.2 h7.2" />
                                <path className="bdai-mouth bdai-mouth-content" d="M18.2 30.2 q3.8 3 7.6 0" />
                                <path className="bdai-mouth bdai-mouth-excited" d="M17.6 29.6 q4.4 4.6 8.8 0" />
                                <path className="bdai-mouth bdai-mouth-sad" d="M18.2 32 q3.8 -3 7.6 0" />
                            </g>
                        </svg>

                        {/* wave hand */}
                        {waving && (
                            <svg className="bdai-hand" viewBox="0 0 20 22" aria-hidden="true">
                                <g fill="#FBCFE8">
                                    <rect x="4.4" y="2.2" width="2.7" height="9" rx="1.35" />
                                    <rect x="7.9" y="0.8" width="2.7" height="10.4" rx="1.35" />
                                    <rect x="11.4" y="2.2" width="2.7" height="9" rx="1.35" />
                                    <rect x="14.6" y="5.4" width="2.6" height="6.2" rx="1.3" />
                                    <path d="M4.4 8.6h12.8v4.8a6.4 6.4 0 0 1-12.8 0z" />
                                </g>
                            </svg>
                        )}
                    </span>

                    {/* ---------- label ---------- */}
                    <span className="hidden min-w-0 flex-col items-start text-left leading-none sm:flex">
                        <span className="text-[14px] font-semibold tracking-tight">Admin AI</span>
                        <span className="mt-[5px] text-[11.5px] font-medium tracking-tight text-white/70">
                            {active ? "Active now" : "Your AI Analyst"}
                        </span>
                    </span>

                    {/* ---------- online / insight dot ---------- */}
                    <span
                        className={`bdai-status ml-0.5 hidden h-[9px] w-[9px] shrink-0 rounded-full sm:block ${hasInsight ? "bdai-status-alert" : ""
                            }`}
                        aria-hidden="true"
                    />
                </button>
            </div>
        </>
    );
}

/* ------------------------------------------------------------------ */
/* Scoped styles. All decorative motion sits inside no-preference.     */
/* ------------------------------------------------------------------ */
const CSS = `
.bdai-btn{
  --bdai-eye-x:0px; --bdai-eye-y:0px;
  background: linear-gradient(118deg, #46113E 0%, #7C1A63 42%, #A8228A 72%, #C33A9E 100%);
  box-shadow: 0 10px 30px -10px rgba(120,20,95,.55), inset 0 1px 0 rgba(255,255,255,.14);
  transition: transform 200ms cubic-bezier(.22,.61,.36,1),
              box-shadow 200ms cubic-bezier(.22,.61,.36,1),
              filter 200ms ease;
  will-change: transform;
}
.bdai-btn:hover{ transform: translateY(-2px); filter: saturate(1.06) brightness(1.05); box-shadow: 0 16px 36px -12px rgba(120,20,95,.7), inset 0 1px 0 rgba(255,255,255,.18); }
.bdai-btn[data-pressed]{ transform: translateY(-1px) scale(.975); }
.bdai-btn:focus-visible{
  outline: none;
  box-shadow: 0 0 0 2px rgba(255,255,255,.9), 0 0 0 5px rgba(158,33,123,.55), 0 12px 30px -12px rgba(120,20,95,.6);
}

.bdai-avatar{
  background: linear-gradient(160deg, #2B0B26 0%, #46113E 100%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.10), 0 2px 8px -3px rgba(0,0,0,.5);
}
.bdai-bot{ color:#F6D7EC; transition: color 300ms ease; }

.bdai-status{
  position: relative;
  background:#22C55E;
  box-shadow: 0 0 0 3px rgba(34,197,94,.22);
  transition: background 250ms ease, box-shadow 250ms ease;
}
.bdai-status::after{
  content:""; position:absolute; inset:0; border-radius:50%;
  background: inherit; opacity:0; pointer-events:none;
}
.bdai-status-alert{ background:#FBBF24; box-shadow: 0 0 0 3px rgba(251,191,36,.28); }
.bdai-status-alert{ background:#FBBF24; box-shadow: 0 0 0 3px rgba(251,191,36,.28); }

.bdai-eyes{ transform: translate(var(--bdai-eye-x), var(--bdai-eye-y)); transition: transform 120ms ease-out; }
.bdai-eye{ transform-box: fill-box; transform-origin: center; transition: transform 280ms cubic-bezier(.22,.61,.36,1); }
.bdai-blinker-l{ transform-origin: 16.8px 24.2px; }
.bdai-blinker-r{ transform-origin: 27.2px 24.2px; }
.bdai-antenna{ transform-origin: 22px 14px; transition: transform 380ms cubic-bezier(.22,.61,.36,1); }
.bdai-beacon{ transition: opacity 300ms ease; }
.bdai-beacon-glow{ opacity:.20; transition: opacity 300ms ease; }
.bdai-brow{ transition: transform 300ms cubic-bezier(.22,.61,.36,1), opacity 300ms ease; opacity:0; }
.bdai-brow-l{ transform-origin: 16px 19.6px; }
.bdai-brow-r{ transform-origin: 28px 19.6px; }
.bdai-mouth{ opacity:0; transition: opacity 260ms ease; }

/* ---- mood: neutral (default) ---- */
.bdai-bot[data-mood="neutral"] .bdai-mouth-neutral{ opacity:1; }

/* ---- mood: content ---- */
.bdai-bot[data-mood="content"] .bdai-mouth-content{ opacity:1; }

/* ---- mood: excited ---- */
.bdai-bot[data-mood="excited"] .bdai-mouth-excited{ opacity:1; }
.bdai-bot[data-mood="excited"] .bdai-eye{ transform: scaleY(1.12); }
.bdai-bot[data-mood="excited"] .bdai-brow{ opacity:1; transform: translateY(-1.2px); }
.bdai-bot[data-mood="excited"] .bdai-beacon-glow{ opacity:.55; }

/* ---- mood: sad — neglected assistant ---- */
.bdai-bot[data-mood="sad"]{ color:#DEB9D2; }
.bdai-bot[data-mood="sad"] .bdai-mouth-sad{ opacity:1; }
.bdai-bot[data-mood="sad"] .bdai-eye{ transform: translateY(1px) scaleY(.74); }
.bdai-bot[data-mood="sad"] .bdai-glint{ opacity:.45; }
.bdai-bot[data-mood="sad"] .bdai-brow{ opacity:1; }
.bdai-bot[data-mood="sad"] .bdai-brow-l{ transform: translateY(-.4px) rotate(-17deg); }
.bdai-bot[data-mood="sad"] .bdai-brow-r{ transform: translateY(-.4px) rotate(17deg); }
.bdai-bot[data-mood="sad"] .bdai-antenna{ transform: rotate(-13deg); }
.bdai-bot[data-mood="sad"] .bdai-beacon{ opacity:.5; }
.bdai-bot[data-mood="sad"] .bdai-beacon-glow{ opacity:.08; }

/* ---- hover / open always cheers it up (wins on specificity) ---- */
.bdai-btn:hover .bdai-bot[data-mood], .bdai-btn[data-active] .bdai-bot[data-mood]{ color:#F6D7EC; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-mouth, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-mouth{ opacity:0; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-mouth-content, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-mouth-content{ opacity:1; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-eye, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-eye{ transform:none; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-glint, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-glint{ opacity:.9; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-brow, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-brow{ opacity:0; transform:none; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-antenna, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-antenna{ transform:none; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-beacon, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-beacon{ opacity:1; }
.bdai-btn:hover .bdai-bot[data-mood] .bdai-beacon-glow, .bdai-btn[data-active] .bdai-bot[data-mood] .bdai-beacon-glow{ opacity:.5; }

.bdai-hand{ position:absolute; right:-12px; top:-4px; width:16px; height:18px; pointer-events:none; opacity:0; }

@media (prefers-reduced-motion: no-preference){
  .bdai-blinker{ animation: bdai-blink 9.2s ease-in-out infinite; }
  .bdai-hand{ animation: bdai-wave 820ms cubic-bezier(.36,.07,.19,.97) both; transform-origin: 55% 90%; }
  .bdai-hint{ animation: bdai-hint-in 240ms cubic-bezier(.22,.61,.36,1) both; }
  .bdai-status::after{ animation: bdai-ping 2.6s cubic-bezier(0,0,.2,1) infinite; }
  .bdai-status-alert::after{ animation-duration: 1.6s; }
  @keyframes bdai-ping{
    0%  { transform: scale(1);   opacity:.5; }
    70% { transform: scale(2.7); opacity:0; }
    100%{ transform: scale(2.7); opacity:0; }
  }
}
@media (prefers-reduced-motion: reduce){
  .bdai-btn, .bdai-eyes, .bdai-eye, .bdai-brow, .bdai-antenna, .bdai-mouth{ transition: none; }
  .bdai-btn:hover{ transform:none; }
  .bdai-hand{ display:none; }
}

@keyframes bdai-blink{
  0%,88%,100%{ transform: scaleY(1); }
  91%,93%{ transform: scaleY(.12); }
}
@keyframes bdai-wave{
  0%   { opacity:0; transform: rotate(0deg) scale(.7); }
  14%  { opacity:1; transform: rotate(15deg) scale(1); }
  38%  { transform: rotate(-8deg); }
  62%  { transform: rotate(12deg); }
  84%  { opacity:1; transform: rotate(0deg); }
  100% { opacity:0; transform: rotate(0deg) scale(.85); }
}
@keyframes bdai-hint-in{
  from{ opacity:0; transform: translateY(6px) scale(.96); }
  to  { opacity:1; transform: none; }
}
`;