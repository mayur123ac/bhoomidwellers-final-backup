// lib/email/templates/layout.ts — the shared branded shell.
//
// Every email in the CRM is rendered through `renderEmail()`. One layout means
// one place to change the logo, the footer, the support address or the colours.
//
// ── Why the HTML looks like 2005 ────────────────────────────────────────────
// Tables, inline styles, no flexbox, no grid, no <style> selectors beyond a
// single media query. This is not carelessness — it is what email clients
// actually support. Outlook on Windows renders through Word's HTML engine,
// which has no float, no flex and no background-image on most elements; Gmail
// strips <style> blocks in some contexts and rewrites class names in others.
// The only reliably supported layout primitive is a nested table with inline
// styles, and the only reliably supported responsive tool is a max-width media
// query that clients ignoring it degrade past harmlessly.
//
// ── Dark mode ───────────────────────────────────────────────────────────────
// `color-scheme` and `supported-color-schemes` tell clients this design has been
// considered, which stops Apple Mail and Outlook from force-inverting it into
// something unreadable. The palette is chosen to survive inversion where it
// happens anyway: mid-tone brand colour, near-black text on near-white, no
// light-grey-on-white that would vanish.
//
// ── Escaping ────────────────────────────────────────────────────────────────
// Every interpolated value goes through `esc()`. Names, organisations, roles and
// IP addresses all originate from user input somewhere, and an unescaped `<` in
// a display name is a broken email at best. There is no situation in these
// templates where caller-supplied HTML should be trusted, so there is no
// "raw" escape hatch — content is passed as data and assembled here.

import fs from "node:fs";
import path from "node:path";
import { readSenderConfig } from "../config";
import type { EmailAttachment } from "../types";

/* ══════════════════════════════════════════════════════════════════════════
   Brand
   ══════════════════════════════════════════════════════════════════════════ */

const BRAND = {
  /** Bhoomi magenta, matching the Admin panel and Settings accent. */
  accent: "#9E217B",
  accentDark: "#7d1a61",
  text: "#1A1A1A",
  muted: "#6B7280",
  border: "#E4E7EE",
  surface: "#FFFFFF",
  canvas: "#F4F5F8",
  success: "#047857",
  warning: "#B45309",
  danger: "#B91C1C",
} as const;

const LOGO_CID = "bhoomi-logo";

/* ══════════════════════════════════════════════════════════════════════════
   Logo
   ══════════════════════════════════════════════════════════════════════════ */

// Read once per process, not per email. The file is ~3KB and never changes at
// runtime, so re-reading it for every send is pure syscall overhead on the
// login path.
let logoCache: Buffer | null | undefined;

function loadLogo(): Buffer | null {
  if (logoCache !== undefined) return logoCache;

  try {
    // A 200px-wide PNG generated from the full-size brand asset. The originals
    // in public/assets are 400KB–2MB, which is an absurd amount to attach to
    // every password alert.
    const file = path.join(process.cwd(), "public", "assets", "email-logo.png");
    logoCache = fs.readFileSync(file);
  } catch {
    // Missing logo is not a reason to fail an email. The header falls back to
    // the wordmark below, which is what most recipients see anyway — remote and
    // inline images alike are blocked by default in a great many clients.
    logoCache = null;
  }

  return logoCache;
}

/** The logo attachment, or nothing. Attached only when the header uses it. */
export function logoAttachment(): EmailAttachment[] {
  const content = loadLogo();
  if (!content) return [];
  return [
    { filename: "bhoomi-logo.png", content, contentType: "image/png", cid: LOGO_CID },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   Escaping
   ══════════════════════════════════════════════════════════════════════════ */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML-escape a value for interpolation into a template. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * A URL safe to place in an href.
 *
 * Only http and https survive. `javascript:` in an email is mostly inert — no
 * mainstream client executes it — but `data:` URIs are a real phishing vector,
 * and a link built from a mis-set APP_BASE_URL should produce no link rather
 * than a broken or hostile one.
 */
export function safeUrl(url: string | null | undefined): string | null {
  const value = (url ?? "").trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value.replace(/[<>"']/g, encodeURIComponent);
}

/* ══════════════════════════════════════════════════════════════════════════
   Building blocks
   ══════════════════════════════════════════════════════════════════════════ */

export interface DetailRow {
  label: string;
  value: string | number | null | undefined;
}

/**
 * The label/value table used by the login alert, password notices and receipts.
 *
 * Rendered as a table rather than a definition list because Outlook collapses
 * the margins on <dl> unpredictably, and this content is the substance of a
 * security email — it has to be legible everywhere.
 */
export function detailTable(rows: DetailRow[]): string {
  const cells = rows
    .filter((row) => row.value !== null && row.value !== undefined && row.value !== "")
    .map(
      (row) => `
        <tr>
          <td style="padding:7px 12px 7px 0;font-size:13px;color:${BRAND.muted};vertical-align:top;white-space:nowrap;">${esc(row.label)}</td>
          <td style="padding:7px 0;font-size:13px;color:${BRAND.text};font-weight:600;vertical-align:top;word-break:break-word;">${esc(row.value)}</td>
        </tr>`
    )
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:4px 0 0;">${cells}</table>`;
}

/** The plain-text twin of detailTable, aligned into columns. */
export function detailText(rows: DetailRow[]): string {
  const visible = rows.filter(
    (row) => row.value !== null && row.value !== undefined && row.value !== ""
  );
  const width = visible.reduce((max, row) => Math.max(max, row.label.length), 0);
  return visible.map((row) => `  ${row.label.padEnd(width + 2)}${row.value}`).join("\n");
}

/** A single prominent call-to-action button. */
export function button(label: string, url: string | null | undefined): string {
  const href = safeUrl(url);
  if (!href) return "";

  // A table, not an <a> with padding: Outlook ignores padding on inline
  // elements, which would collapse the button into bare underlined text.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td style="border-radius:8px;background:${BRAND.accent};">
      <a href="${href}" style="display:inline-block;padding:13px 28px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** A highlighted code block, for OTPs. */
export function codeBlock(code: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
    <tr><td align="center" style="padding:20px;background:#FAF5F9;border:1px solid ${BRAND.border};border-radius:10px;">
      <div style="font-family:Consolas,Menlo,Courier New,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND.accent};">${esc(code)}</div>
    </td></tr>
  </table>`;
}

export type CalloutTone = "info" | "warning" | "danger" | "success";

const TONES: Record<CalloutTone, { bar: string; wash: string; text: string }> = {
  info: { bar: BRAND.accent, wash: "#FAF5F9", text: BRAND.text },
  warning: { bar: "#F59E0B", wash: "#FFFBEB", text: BRAND.warning },
  danger: { bar: "#EF4444", wash: "#FEF2F2", text: BRAND.danger },
  success: { bar: "#10B981", wash: "#ECFDF5", text: BRAND.success },
};

/** A tinted panel with a coloured edge. Used for the new-device warning. */
export function callout(tone: CalloutTone, title: string, body: string): string {
  const t = TONES[tone];
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px;border-collapse:separate;">
    <tr>
      <td style="width:4px;background:${t.bar};border-radius:4px 0 0 4px;"></td>
      <td style="padding:14px 16px;background:${t.wash};border-radius:0 4px 4px 0;">
        <div style="font-size:14px;font-weight:700;color:${t.text};margin-bottom:4px;">${esc(title)}</div>
        <div style="font-size:13px;line-height:1.6;color:${BRAND.text};">${body}</div>
      </td>
    </tr>
  </table>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The layout
   ══════════════════════════════════════════════════════════════════════════ */

export interface RenderOptions {
  /** Preheader text — the grey line mail clients show beside the subject. */
  preview: string;
  heading: string;
  /** Pre-escaped HTML built from the helpers above. */
  bodyHtml: string;
  /** The plain-text alternative. Never derived from the HTML. */
  bodyText: string;
  /**
   * Appended above the footer. Present on security-sensitive mail; omitted on
   * announcements, where a disclaimer about never sharing codes is noise.
   */
  securityNote?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

export function renderEmail(options: RenderOptions): RenderedEmail {
  const sender = readSenderConfig();
  const year = new Date().getFullYear();
  const hasLogo = loadLogo() !== null;
  const appUrl = safeUrl(sender.appUrl);

  const header = hasLogo
    ? `<img src="cid:${LOGO_CID}" width="150" alt="${esc(sender.companyName)}" style="display:block;border:0;outline:none;max-width:150px;height:auto;" />`
    : `<div style="font-size:21px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">${esc(sender.companyName)}</div>`;

  const security = options.securityNote
    ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 0;">
              <tr><td style="padding-top:18px;border-top:1px solid ${BRAND.border};font-size:12px;line-height:1.6;color:${BRAND.muted};">
                <strong style="color:${BRAND.text};">Security notice.</strong> ${esc(options.securityNote)}
              </td></tr>
            </table>`
    : "";

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(options.heading)}</title>
<style>
  /* The only responsive tool that works across clients. Anything ignoring it
     falls back to the 600px table, which is readable on a phone regardless. */
  @media only screen and (max-width:620px){
    .bd-wrap{width:100% !important;}
    .bd-pad{padding-left:22px !important;padding-right:22px !important;}
    .bd-h1{font-size:20px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};-webkit-text-size-adjust:100%;">
  <!-- Preheader: shown in the inbox list beside the subject, hidden in the body.
       Without it, clients pull the first visible words, which is the logo alt
       text followed by the greeting. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(options.preview)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.canvas};">
    <tr><td align="center" style="padding:28px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="bd-wrap" style="width:600px;max-width:600px;background:${BRAND.surface};border-radius:14px;overflow:hidden;border:1px solid ${BRAND.border};">

        <tr><td class="bd-pad" style="padding:26px 36px;background:${BRAND.accent};">
          ${header}
        </td></tr>

        <tr><td class="bd-pad" style="padding:32px 36px 30px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <h1 class="bd-h1" style="margin:0 0 18px;font-size:22px;line-height:1.35;font-weight:700;color:${BRAND.text};">${esc(options.heading)}</h1>
          <div style="font-size:14px;line-height:1.7;color:${BRAND.text};">
${options.bodyHtml}
          </div>
${security}
        </td></tr>

        <tr><td class="bd-pad" style="padding:20px 36px 26px;background:#FAFBFC;border-top:1px solid ${BRAND.border};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:12px;line-height:1.7;color:${BRAND.muted};">
            <div style="font-weight:700;color:${BRAND.text};margin-bottom:3px;">${esc(sender.companyName)}</div>
            <div>This is an automated message from ${esc(sender.companyName)} CRM. Please do not reply to it directly.</div>
            <div style="margin-top:8px;">
              Need help? <a href="mailto:${esc(sender.supportEmail)}" style="color:${BRAND.accent};text-decoration:none;font-weight:600;">${esc(sender.supportEmail)}</a>${
                appUrl
                  ? ` &nbsp;·&nbsp; <a href="${appUrl}" style="color:${BRAND.accent};text-decoration:none;font-weight:600;">Open the CRM</a>`
                  : ""
              }
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid ${BRAND.border};color:#9AA1AC;">
              &copy; ${year} ${esc(sender.companyName)}. All rights reserved.
            </div>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Built from `bodyText`, never derived from the HTML by stripping tags. A
  // stripped version reads like debris, and this part is what lands in
  // plain-text clients, accessibility tools and spam-filter body analysis.
  const text = [
    options.heading,
    "=".repeat(Math.min(options.heading.length, 64)),
    "",
    options.bodyText.trim(),
    options.securityNote ? `\nSecurity notice: ${options.securityNote}` : "",
    "",
    "—",
    `${sender.companyName} CRM — automated message, please do not reply.`,
    `Support: ${sender.supportEmail}`,
    sender.appUrl ? `CRM: ${sender.appUrl}` : "",
    `(c) ${year} ${sender.companyName}. All rights reserved.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { html, text, attachments: hasLogo ? logoAttachment() : [] };
}
