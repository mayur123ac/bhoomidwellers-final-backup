"use client";

// components/bhoomi-ai/BhoomiAiIcon.tsx — the one Bhoomi AI symbol.
//
// Replaces FaWandMagicSparkles, which read as "magic tool" rather than
// "intelligent CRM assistant". `Sparkles` comes from lucide-react, already a
// dependency — no new icon library, and it is a stroked multi-point spark that
// sits in the same visual language as the rest of the CRM's icons.
//
// Everything that represents Bhoomi AI renders THIS component: the rail item,
// the workspace avatar, the greeting, the thinking state and the send button.
// One symbol is the point — the assistant had three different marks before.
//
// ── Colour ──────────────────────────────────────────────────────────────────
// The mark carries the brand gradient (magenta → blue) and nothing else. It is
// the only place the AI workspace is allowed to be loud, per the brief's
// "Layer 3 — AI activity" rule.

import { Sparkles } from "lucide-react";

/** Brand gradient used for every AI-active state. Magenta → blue, no third hue. */
export const AI_GRADIENT = "linear-gradient(135deg,#9E217B 0%,#c7299a 45%,#00AEEF 100%)";

export type AiIconState = "idle" | "thinking";

/**
 * The bare glyph, for places that supply their own colour — the navigation
 * rails pass it as an `IconType`, so it must accept `className` and nothing
 * else and must inherit `currentColor`. Do not add a gradient here: recolouring
 * a rail icon is explicitly out of bounds.
 */
export function BhoomiAiGlyph({ className }: { className?: string }) {
  return <Sparkles className={className} strokeWidth={2} />;
}

/**
 * The badged mark used inside the AI workspace.
 *
 * `state="thinking"` sweeps the gradient across the tile and breathes gently.
 * It deliberately does not spin, bounce, or wear a spinner ring: the animation
 * has to say "thinking", and a rotating element says "loading forever".
 */
export default function BhoomiAiIcon({
  size = 32,
  state = "idle",
  animateIn = false,
  className = "",
}: {
  size?: number;
  state?: AiIconState;
  /** Fade + scale on mount, for the greeting. */
  animateIn?: boolean;
  className?: string;
}) {
  const thinking = state === "thinking";
  return (
    <span
      className={`bdai-mark ${animateIn ? "bdai-mark-in" : ""} ${thinking ? "bdai-mark-thinking" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        // 200% so the sweep has somewhere to travel when thinking.
        backgroundImage: AI_GRADIENT,
        backgroundSize: thinking ? "200% 200%" : "100% 100%",
        boxShadow: "0 1px 6px rgba(158,33,123,0.30)",
      }}
      aria-hidden
    >
      <Sparkles style={{ width: size * 0.5, height: size * 0.5, color: "#fff" }} strokeWidth={2.1} />
    </span>
  );
}

/**
 * Keyframes for the mark, scoped to `.bdai-mark`.
 *
 * Injected by the workspace rather than declared in globals.css: the AI surface
 * owns its motion, and a global @keyframes for a feature this narrow is how
 * unrelated pages end up inheriting animation.
 */
export const AI_ICON_CSS = `
.bdai-mark{display:grid;place-items:center;border-radius:10px;flex-shrink:0}
.bdai-mark-in{animation:bdai-in 420ms cubic-bezier(0.22,1,0.36,1) both}
@keyframes bdai-in{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
.bdai-mark-thinking{animation:bdai-sweep 2.6s ease-in-out infinite,bdai-breathe 2.6s ease-in-out infinite}
@keyframes bdai-sweep{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes bdai-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@media (prefers-reduced-motion:reduce){
  .bdai-mark-in,.bdai-mark-thinking{animation:none}
}
`;
