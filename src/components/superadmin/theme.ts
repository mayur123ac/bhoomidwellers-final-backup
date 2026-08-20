// components/superadmin/theme.ts — the Super Admin surface palette.
//
// Why this is not `buildTheme(isDark)` from lib/crmTheme:
//
// The tenant panels sit on pure black in dark mode (#000000 app, #1C1C1E card),
// which is right for them — it is the same near-black the rest of the product
// uses. Super Admin is a different altitude: it operates ON tenants rather than
// inside one, and the brief asks for a dark mode that is designed rather than
// inverted, on "deep neutral/navy backgrounds" with "layered dark surfaces".
//
// So dark mode here is a navy ramp — app → surface → raised → hover — with each
// step a real elevation rather than a lighter grey. That also does quiet work
// for safety: a Super Admin destroying a tenant should never be able to mistake
// this screen for their own organization's dashboard.
//
// Light mode deliberately stays on the CRM's own #F5F5F7 / #FFFFFF, so the two
// halves of the product still feel like one product in the mode most people use.

export interface SuperAdminTheme {
  /** Page background, behind everything. */
  app: string;
  /** Primary panel/table surface. */
  surface: string;
  /** One step up: stat tiles, table headers, inset rows. */
  raised: string;
  /** Hover state for rows and controls. */
  hover: string;
  /** Hairline borders. Subtle, never a hard line. */
  border: string;
  /** Slightly stronger border for focused/active elements. */
  borderStrong: string;
  text: string;
  textMuted: string;
  /** Primary accent — the CRM magenta, used sparingly for active state. */
  accent: string;
  /** Secondary accent for informational/neutral emphasis. */
  info: string;
  positive: string;
  warning: string;
  danger: string;
  /** Shadow for raised elements. Restrained: dark mode gets almost none. */
  shadow: string;
}

const LIGHT: SuperAdminTheme = {
  app: "#F5F5F7",
  surface: "#FFFFFF",
  raised: "#F2F2F7",
  hover: "#EDEDF2",
  border: "#E5E5EA",
  borderStrong: "#D8D8DE",
  text: "#1D1D1F",
  textMuted: "#86868B",
  accent: "#9E217B",
  info: "#0A66C2",
  positive: "#1D7A4C",
  warning: "#9A6200",
  danger: "#B3261E",
  shadow: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)",
};

const DARK: SuperAdminTheme = {
  app: "#0A0E1A",
  surface: "#111725",
  raised: "#19202F",
  hover: "#212939",
  border: "#242C3D",
  borderStrong: "#313B50",
  text: "#F2F4F8",
  textMuted: "#94A0B8",
  accent: "#FF3797",
  info: "#5B9DFF",
  positive: "#3DD68C",
  warning: "#F5B544",
  danger: "#FF6B63",
  shadow: "0 1px 2px rgba(0,0,0,0.4)",
};

export const superAdminTheme = (isDark: boolean): SuperAdminTheme => (isDark ? DARK : LIGHT);

/**
 * Tint helper for status pills and accent chips.
 *
 * Returns a background at low alpha over the theme's own colour rather than a
 * fixed pastel, so a pill reads correctly on both the navy and the white ramp
 * without maintaining two palettes.
 */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
