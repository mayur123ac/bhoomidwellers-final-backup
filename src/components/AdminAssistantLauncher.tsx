"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * AdminAssistantLauncher — AssistiveTouch-style draggable floating button.
 *
 * Supports a "docking" animation: when `docking` is true the button smoothly
 * flies to the bottom-right safe area and calls `onDockComplete` when it
 * arrives. The parent (AdminAssistantDock) uses this to coordinate a 2-stage
 * open sequence: button docks → panel expands upward.
 */

const DEFAULT_NS = "adminai";
const lastOpenedKey = (ns: string) => `bd:${ns}:lastOpened:v1`;
const positionKey = (ns: string) => `bd:${ns}:fabPos:v1`;

const CONTENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const NEUTRAL_WINDOW_MS = 8 * 60 * 60 * 1000;
const MOOD_TICK_MS = 5 * 60 * 1000;

export const BTN_SIZE = 56;
const EDGE_MARGIN = 12;
const DRAG_THRESHOLD = 6;
const SNAP_DURATION_MS = 280;
const DOCK_ANIM_MS = 380;
const IDLE_OPACITY_DELAY_MS = 4000;
const IDLE_OPACITY = 0.7;

type Mood = "content" | "neutral" | "sad" | "excited";

type Position = { x: number; y: number };

type Props = {
  isDark: boolean;
  onOpen: () => void;
  active?: boolean;
  hasInsight?: boolean;
  hint?: string;
  title?: string;
  subtitle?: string;
  storageNamespace?: string;
  onPositionChange?: (pos: { x: number; y: number; edge: "left" | "right" }) => void;
  /** When true, the button animates to the bottom-right dock position. */
  docking?: boolean;
  /** Called once the docking animation finishes. */
  onDockComplete?: () => void;
  /** When true, the button fades out (used while panel is expanding). */
  fading?: boolean;
};

function readLastOpened(ns: string): number {
  try {
    return Number(localStorage.getItem(lastOpenedKey(ns)) || 0);
  } catch {
    return 0;
  }
}

function computeMood(hasInsight: boolean, active: boolean, ns: string): Mood {
  if (hasInsight) return "excited";
  if (active) return "content";
  const last = readLastOpened(ns);
  if (!last) return "neutral";
  const idle = Date.now() - last;
  if (idle < CONTENT_WINDOW_MS) return "content";
  if (idle < NEUTRAL_WINDOW_MS) return "neutral";
  return "sad";
}

function clampPosition(x: number, y: number): Position {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  return {
    x: Math.max(EDGE_MARGIN, Math.min(vw - BTN_SIZE - EDGE_MARGIN, x)),
    y: Math.max(EDGE_MARGIN, Math.min(vh - BTN_SIZE - EDGE_MARGIN, y)),
  };
}

function snapToEdge(x: number, y: number): Position & { edge: "left" | "right" } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const center = x + BTN_SIZE / 2;
  const edge: "left" | "right" = center < vw / 2 ? "left" : "right";
  const snappedX = edge === "left" ? EDGE_MARGIN : vw - BTN_SIZE - EDGE_MARGIN;
  const clamped = clampPosition(snappedX, y);
  return { ...clamped, edge };
}

function readSavedPosition(ns: string): Position | null {
  try {
    const raw = localStorage.getItem(positionKey(ns));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.x === "number" && typeof p.y === "number") return p;
  } catch { /* noop */ }
  return null;
}

function savePosition(ns: string, pos: Position) {
  try {
    localStorage.setItem(positionKey(ns), JSON.stringify(pos));
  } catch { /* noop */ }
}

function defaultPosition(): Position {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  return {
    x: vw - BTN_SIZE - EDGE_MARGIN,
    y: vh - BTN_SIZE - 100,
  };
}

/** Compute where the button should dock (bottom-right safe area). */
export function computeDockTarget(): Position {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  return {
    x: vw - BTN_SIZE - EDGE_MARGIN - 4,
    y: vh - BTN_SIZE - EDGE_MARGIN - 8,
  };
}

export default function AdminAssistantLauncher({
  isDark,
  onOpen,
  active = false,
  hasInsight = false,
  title = "Admin AI",
  storageNamespace = DEFAULT_NS,
  onPositionChange,
  docking = false,
  onDockComplete,
  fading = false,
}: Props) {
  const [mood, setMood] = useState<Mood>("neutral");
  const [pos, setPos] = useState<Position>(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    const saved = readSavedPosition(storageNamespace);
    if (saved) return clampPosition(saved.x, saved.y);
    return defaultPosition();
  });
  const [snapping, setSnapping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [isDocking, setIsDocking] = useState(false);

  const btnRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef<{
    startX: number; startY: number;
    offsetX: number; offsetY: number;
    moved: boolean;
  } | null>(null);
  const idleTimer = useRef<number>(0);
  const reduceRef = useRef(false);
  const dockingHandled = useRef(false);

  // Report position to parent
  useEffect(() => {
    if (onPositionChange) {
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      const center = pos.x + BTN_SIZE / 2;
      const edge: "left" | "right" = center < vw / 2 ? "left" : "right";
      onPositionChange({ x: pos.x, y: pos.y, edge });
    }
  }, [pos, onPositionChange]);

  // Initialize from localStorage and clamp on resize
  useEffect(() => {
    reduceRef.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saved = readSavedPosition(storageNamespace);
    if (saved) setPos(snapToEdge(saved.x, saved.y));

    const handleResize = () => {
      setPos((prev) => {
        const snapped = snapToEdge(prev.x, prev.y);
        savePosition(storageNamespace, snapped);
        return snapped;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [storageNamespace]);

  // ── Docking animation ────────────────────────────────────────────
  useEffect(() => {
    if (!docking || dockingHandled.current) return;
    dockingHandled.current = true;
    setIsDocking(true);
    setIdle(false);
    setMood("content");

    // Compute target and animate to it (CSS transition via [data-docking])
    // Use requestAnimationFrame so the browser registers the current position
    // before we set the target — otherwise the transition won't fire.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = computeDockTarget();
        setPos(target);
      });
    });

    const t = setTimeout(() => {
      onDockComplete?.();
    }, DOCK_ANIM_MS + 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docking]);

  // Reset docking guard when docking becomes false
  useEffect(() => {
    if (!docking) {
      dockingHandled.current = false;
      setIsDocking(false);
    }
  }, [docking]);

  // Mood
  useEffect(() => {
    if (docking) return; // don't override mood during dock
    setMood(computeMood(hasInsight, active, storageNamespace));
    const id = window.setInterval(
      () => setMood(computeMood(hasInsight, active, storageNamespace)),
      MOOD_TICK_MS
    );
    return () => clearInterval(id);
  }, [hasInsight, active, storageNamespace, docking]);

  // Idle dim
  const resetIdle = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_OPACITY_DELAY_MS);
  }, []);

  useEffect(() => {
    resetIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [resetIdle]);

  // ── Pointer handlers for drag ────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (docking || isDocking) return; // no drag while docking
    if (e.button !== 0) return;
    e.preventDefault();
    const el = btnRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    setPressed(true);
    resetIdle();
    dragState.current = {
      startX: e.clientX, startY: e.clientY,
      offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y,
      moved: false,
    };
  }, [pos, resetIdle, docking, isDocking]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    ds.moved = true;
    if (!dragging) setDragging(true);
    setPos(clampPosition(e.clientX - ds.offsetX, e.clientY - ds.offsetY));
  }, [dragging]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    dragState.current = null;
    setPressed(false);
    if (!ds) return;

    const el = btnRef.current;
    if (el) el.releasePointerCapture(e.pointerId);

    if (!ds.moved) {
      setDragging(false);
      try {
        localStorage.setItem(lastOpenedKey(storageNamespace), String(Date.now()));
      } catch { /* noop */ }
      setMood("content");
      onOpen();
      return;
    }

    // Snap to nearest edge
    setSnapping(true);
    setDragging(false);
    const snapped = snapToEdge(pos.x, pos.y);
    setPos(snapped);
    savePosition(storageNamespace, snapped);
    setTimeout(() => setSnapping(false), SNAP_DURATION_MS);
    resetIdle();
  }, [pos, onOpen, storageNamespace, resetIdle]);

  return (
    <>
      <style>{CSS}</style>
      <button
        ref={btnRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={`Open ${title}`}
        title={title}
        data-mood={mood}
        data-dragging={dragging || undefined}
        data-snapping={snapping || undefined}
        data-pressed={pressed || undefined}
        data-docking={isDocking || undefined}
        data-fading={fading || undefined}
        data-idle={idle && !dragging && !pressed && !isDocking ? "" : undefined}
        className="fab-btn fixed z-50 grid place-items-center touch-none select-none"
        style={{
          left: pos.x,
          top: pos.y,
          width: BTN_SIZE,
          height: BTN_SIZE,
        }}
      >
        <svg
          viewBox="0 0 44 44"
          className="fab-bot"
          data-mood={mood}
          aria-hidden="true"
          style={{ width: 34, height: 34 }}
        >
          <g className="fab-antenna">
            <line x1="22" y1="9.6" x2="22" y2="14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity="0.8" />
            <circle className="fab-beacon-glow" cx="22" cy="6.6" r="4.8" fill="#F472C6" />
            <circle className="fab-beacon" cx="22" cy="6.6" r="2.6" fill="#FBCFE8" />
          </g>
          <rect x="4.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />
          <rect x="36.4" y="21" width="3.2" height="8" rx="1.6" fill="currentColor" opacity="0.55" />
          <rect x="8" y="13.4" width="28" height="24" rx="9" fill="currentColor" />
          <g className="fab-brows" fill="none" stroke="#5B1046" strokeWidth="1.7" strokeLinecap="round">
            <path className="fab-brow fab-brow-l" d="M13.4 19.6 h5.2" />
            <path className="fab-brow fab-brow-r" d="M25.4 19.6 h5.2" />
          </g>
          <g className="fab-eyes">
            <g className="fab-blinker fab-blinker-l">
              <ellipse className="fab-eye" cx="16.8" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
              <circle className="fab-glint" cx="17.7" cy="23.1" r="0.85" fill="#FFFFFF" opacity="0.9" />
            </g>
            <g className="fab-blinker fab-blinker-r">
              <ellipse className="fab-eye" cx="27.2" cy="24.2" rx="2.6" ry="3.2" fill="#5B1046" />
              <circle className="fab-glint" cx="28.1" cy="23.1" r="0.85" fill="#FFFFFF" opacity="0.9" />
            </g>
          </g>
          <g fill="none" stroke="#5B1046" strokeWidth="1.9" strokeLinecap="round">
            <path className="fab-mouth fab-mouth-neutral" d="M18.4 31.2 h7.2" />
            <path className="fab-mouth fab-mouth-content" d="M18.2 30.2 q3.8 3 7.6 0" />
            <path className="fab-mouth fab-mouth-excited" d="M17.6 29.6 q4.4 4.6 8.8 0" />
            <path className="fab-mouth fab-mouth-sad" d="M18.2 32 q3.8 -3 7.6 0" />
          </g>
        </svg>

        {hasInsight && (
          <span className="fab-dot absolute" aria-hidden="true" />
        )}
      </button>
    </>
  );
}

const CSS = `
/* ── FAB button ─────────────────────────────────────────────────── */
.fab-btn{
  border-radius: 50%;
  background: linear-gradient(140deg, #46113E 0%, #7C1A63 42%, #A8228A 72%, #C33A9E 100%);
  box-shadow:
    0 4px 20px -4px rgba(120,20,95,.55),
    inset 0 1px 0 rgba(255,255,255,.14);
  cursor: grab;
  transition: opacity 350ms ease, box-shadow 200ms ease, transform 200ms ease;
  will-change: left, top, transform, opacity;
}
.fab-btn[data-snapping]{
  transition: left ${SNAP_DURATION_MS}ms cubic-bezier(.22,.61,.36,1),
              top ${SNAP_DURATION_MS}ms cubic-bezier(.22,.61,.36,1),
              opacity 350ms ease,
              box-shadow 200ms ease,
              transform 200ms ease;
}
/* ── Docking: smooth flight to bottom ── */
.fab-btn[data-docking]{
  transition: left ${DOCK_ANIM_MS}ms cubic-bezier(.34, 1.15, .64, 1),
              top ${DOCK_ANIM_MS}ms cubic-bezier(.34, 1.15, .64, 1),
              opacity 200ms ease,
              box-shadow 200ms ease,
              transform 200ms ease !important;
  pointer-events: none;
  cursor: default;
}
/* ── Fading out while panel expands ── */
.fab-btn[data-fading]{
  opacity: 0 !important;
  transform: scale(.6);
  pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease !important;
}
.fab-btn[data-dragging]{
  cursor: grabbing;
  transform: scale(1.08);
  box-shadow:
    0 8px 32px -4px rgba(120,20,95,.65),
    inset 0 1px 0 rgba(255,255,255,.18);
}
.fab-btn[data-pressed]:not([data-dragging]){
  transform: scale(.94);
}
.fab-btn[data-idle]{
  opacity: ${IDLE_OPACITY};
}
.fab-btn:hover:not([data-dragging]):not([data-docking]):not([data-fading]){
  opacity: 1 !important;
  box-shadow:
    0 6px 28px -4px rgba(120,20,95,.65),
    inset 0 1px 0 rgba(255,255,255,.18);
}
.fab-btn:focus-visible{
  outline: none;
  box-shadow:
    0 0 0 2px rgba(255,255,255,.9),
    0 0 0 5px rgba(158,33,123,.55),
    0 6px 24px -4px rgba(120,20,95,.5);
}

/* ── Insight dot ────────────────────────────────────────────────── */
.fab-dot{
  top: 2px; right: 2px;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: #FBBF24;
  border: 2.5px solid #46113E;
  box-shadow: 0 0 0 2px rgba(251,191,36,.3);
}

/* ── Bot face ───────────────────────────────────────────────────── */
.fab-bot{ color:#F6D7EC; transition: color 300ms ease; }
.fab-eyes{ transition: transform 120ms ease-out; }
.fab-eye{ transform-box: fill-box; transform-origin: center; transition: transform 280ms cubic-bezier(.22,.61,.36,1); }
.fab-blinker-l{ transform-origin: 16.8px 24.2px; }
.fab-blinker-r{ transform-origin: 27.2px 24.2px; }
.fab-antenna{ transform-origin: 22px 14px; transition: transform 380ms cubic-bezier(.22,.61,.36,1); }
.fab-beacon{ transition: opacity 300ms ease; }
.fab-beacon-glow{ opacity:.20; transition: opacity 300ms ease; }
.fab-brow{ transition: transform 300ms cubic-bezier(.22,.61,.36,1), opacity 300ms ease; opacity:0; }
.fab-brow-l{ transform-origin: 16px 19.6px; }
.fab-brow-r{ transform-origin: 28px 19.6px; }
.fab-mouth{ opacity:0; transition: opacity 260ms ease; }

/* Mood: neutral */
.fab-bot[data-mood="neutral"] .fab-mouth-neutral{ opacity:1; }
/* Mood: content */
.fab-bot[data-mood="content"] .fab-mouth-content{ opacity:1; }
/* Mood: excited */
.fab-bot[data-mood="excited"] .fab-mouth-excited{ opacity:1; }
.fab-bot[data-mood="excited"] .fab-eye{ transform: scaleY(1.12); }
.fab-bot[data-mood="excited"] .fab-brow{ opacity:1; transform: translateY(-1.2px); }
.fab-bot[data-mood="excited"] .fab-beacon-glow{ opacity:.55; }
/* Mood: sad */
.fab-bot[data-mood="sad"]{ color:#DEB9D2; }
.fab-bot[data-mood="sad"] .fab-mouth-sad{ opacity:1; }
.fab-bot[data-mood="sad"] .fab-eye{ transform: translateY(1px) scaleY(.74); }
.fab-bot[data-mood="sad"] .fab-glint{ opacity:.45; }
.fab-bot[data-mood="sad"] .fab-brow{ opacity:1; }
.fab-bot[data-mood="sad"] .fab-brow-l{ transform: translateY(-.4px) rotate(-17deg); }
.fab-bot[data-mood="sad"] .fab-brow-r{ transform: translateY(-.4px) rotate(17deg); }
.fab-bot[data-mood="sad"] .fab-antenna{ transform: rotate(-13deg); }
.fab-bot[data-mood="sad"] .fab-beacon{ opacity:.5; }
.fab-bot[data-mood="sad"] .fab-beacon-glow{ opacity:.08; }

/* Hover cheers it up */
.fab-btn:hover .fab-bot[data-mood]{ color:#F6D7EC; }
.fab-btn:hover .fab-bot[data-mood] .fab-mouth{ opacity:0; }
.fab-btn:hover .fab-bot[data-mood] .fab-mouth-content{ opacity:1; }
.fab-btn:hover .fab-bot[data-mood] .fab-eye{ transform:none; }
.fab-btn:hover .fab-bot[data-mood] .fab-glint{ opacity:.9; }
.fab-btn:hover .fab-bot[data-mood] .fab-brow{ opacity:0; transform:none; }
.fab-btn:hover .fab-bot[data-mood] .fab-antenna{ transform:none; }
.fab-btn:hover .fab-bot[data-mood] .fab-beacon{ opacity:1; }
.fab-btn:hover .fab-bot[data-mood] .fab-beacon-glow{ opacity:.5; }

@media (prefers-reduced-motion: no-preference){
  .fab-blinker{ animation: fab-blink 9.2s ease-in-out infinite; }
}
@media (prefers-reduced-motion: reduce){
  .fab-btn, .fab-eyes, .fab-eye, .fab-brow, .fab-antenna, .fab-mouth{
    transition: none !important;
  }
}

@keyframes fab-blink{
  0%,88%,100%{ transform: scaleY(1); }
  91%,93%{ transform: scaleY(.12); }
}
`;
