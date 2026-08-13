// components/bhoomi-ai/theme.ts — colour tokens for the Bhoomi AI surface.
//
// ── Scope ───────────────────────────────────────────────────────────────────
// These tokens describe the AI CONVERSATION CANVAS only — the region inside
// `.bhoomi-ai-workspace`. They are not a theme provider, they set nothing
// globally, and no CRM chrome reads them. The Admin header, the rail, the logo,
// Mark Attendance, the notification badges and every other module keep the
// Bhoomi palette (magenta + blue + white) untouched.
//
// ── Why this no longer follows `isDark` ─────────────────────────────────────
// It used to return a white canvas in CRM light mode, which made Bhoomi AI look
// like one more white module. The workspace is now always the dark charcoal
// canvas: that darkness is what distinguishes the AI surface from a normal CRM
// screen, so it cannot be conditional on a preference that belongs to the rest
// of the app. `isDark` is still threaded through the components for the few
// places that blend with the CRM shell, and the canvas ignores it.

export const ACCENT = "#9E217B";
export const ACCENT_LIGHT = "#d946a8";
/** The blue half of the brand pair. Used only for AI-activity gradients. */
export const ACCENT_BLUE = "#00AEEF";

/* ── Canvas tokens ──────────────────────────────────────────────────────────
   Fixed values, straight from the design brief. Named here so the components
   cannot drift into approximations of them. */
export const CANVAS = "#131314";
/** Raised surfaces: the composer, user messages, suggestion tiles. */
export const CANVAS_RAISED = "#1E1F20";
export const CANVAS_TEXT = "#E3E3E3";
export const CANVAS_TEXT_MUTED = "#C4C7C5";

export interface AiTheme {
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  border: string;
  borderSoft: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  codeBg: string;
  tableHeadBg: string;
  /** Behind the sticky composer, so scrolled text fades out rather than colliding. */
  fade: string;
  ring: string;
}

/**
 * The AI canvas palette. One palette, always dark — see the note at the top of
 * this file for why it no longer branches on the CRM's light/dark preference.
 *
 * The parameter is kept so every existing call site stays valid, and because
 * components still use it for the handful of details that touch the CRM shell
 * rather than the canvas.
 */
export function aiTheme(_isDark?: boolean): AiTheme {
  return {
    text: CANVAS_TEXT,
    textMuted: CANVAS_TEXT_MUTED,
    // Third step down, for captions and the disclaimer. Dimmed from the muted
    // value rather than invented, so the three text levels stay related.
    textFaint: "#8A8D8B",
    accent: ACCENT_LIGHT,
    // "Subtle translucent white" from the brief — a hairline, not a visible box.
    border: "rgba(255,255,255,0.10)",
    borderSoft: "rgba(255,255,255,0.06)",
    surface: CANVAS,
    surfaceRaised: CANVAS_RAISED,
    surfaceHover: "rgba(255,255,255,0.055)",
    codeBg: "#1A1B1C",
    tableHeadBg: "#1E1F20",
    // Matches CANVAS so scrolled text dissolves into the canvas under the
    // composer instead of hitting a visible seam.
    fade: "linear-gradient(to bottom, rgba(19,19,20,0) 0%, rgba(19,19,20,0.92) 45%, rgba(19,19,20,1) 100%)",
    ring: "rgba(255,255,255,0.14)",
  };
}

/**
 * Display labels for the `sources` the chat route returns — these are the
 * `module` strings recorded in services.ts for the audit trail, so the set is
 * fixed and known. Anything unrecognised falls back to the raw id rather than
 * being dropped: a new tool should surface as an ugly badge, not an invisible
 * one.
 */
const MODULE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  loans: "Loans",
  performance: "Team Performance",
  leads: "Leads",
  inventory: "Inventory",
  registration: "Registrations",
  "follow-ups": "Follow-ups",
};

export function moduleLabel(id: string): string {
  return MODULE_LABELS[id] ?? id.replace(/[-_]/g, " ");
}
