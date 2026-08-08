// components/bhoomi-ai/theme.ts — colour tokens for the Bhoomi AI surface.
//
// Derived from the `isDark` flag the Admin pages already compute from
// localStorage `crm_theme`. This is not a second theme system: it introduces no
// storage, no provider and no toggle, and it is only a place to name the values
// so nine components do not each inline the same ternary.

export const ACCENT = "#9E217B";
export const ACCENT_LIGHT = "#d946a8";

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

export function aiTheme(isDark: boolean): AiTheme {
  return isDark
    ? {
        text: "#EDE7EB",
        textMuted: "#9C93A0",
        textFaint: "#6B6470",
        accent: ACCENT_LIGHT,
        border: "#2A2430",
        borderSoft: "#221D28",
        surface: "#0F0D12",
        surfaceRaised: "#171320",
        surfaceHover: "rgba(255,255,255,0.04)",
        codeBg: "#141118",
        tableHeadBg: "#1A1520",
        fade: "linear-gradient(to bottom, rgba(10,10,12,0) 0%, rgba(10,10,12,0.92) 45%, rgba(10,10,12,1) 100%)",
        ring: "rgba(217,70,168,0.45)",
      }
    : {
        text: "#241826",
        textMuted: "#6B6472",
        textFaint: "#9A93A1",
        accent: ACCENT,
        border: "#E7E2EC",
        borderSoft: "#F0ECF3",
        surface: "#FFFFFF",
        surfaceRaised: "#FFFFFF",
        surfaceHover: "rgba(158,33,123,0.05)",
        codeBg: "#F7F4F9",
        tableHeadBg: "#FAF7FB",
        fade: "linear-gradient(to bottom, rgba(250,248,252,0) 0%, rgba(250,248,252,0.92) 45%, rgba(250,248,252,1) 100%)",
        ring: "rgba(158,33,123,0.35)",
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
