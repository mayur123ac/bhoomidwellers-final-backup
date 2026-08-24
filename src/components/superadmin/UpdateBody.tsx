"use client";

// components/superadmin/UpdateBody.tsx — renders a System Update's description.
//
// ── Why this is four lines of adapter and not a renderer ────────────────────
// The project already has a safe formatted-text renderer: components/bhoomi-ai/
// Markdown.tsx. It was written for the AI assistant, whose output is untrusted
// because it can quote a lead's free-text notes, and it is careful in exactly
// the ways an announcement body needs:
//
//   * it emits React elements and NEVER touches dangerouslySetInnerHTML, so raw
//     HTML in the source renders as literal text and cannot become markup;
//   * link hrefs are restricted to http/https/mailto, so `javascript:` cannot
//     become a live anchor;
//   * it supports precisely the marks the brief asks for — bold, italic,
//     paragraphs, bullet points, links.
//
// That is structural XSS prevention rather than a sanitiser applied to a string
// after the fact, which is why the same component serves both the Super Admin
// preview and the CRM users' System Updates panel: what the operator previews is
// literally what users get, from the same code path.
//
// The only thing this file does is translate a palette. Markdown takes an
// `AiTheme` and reads seven of its keys (text, textMuted, accent, border,
// borderSoft, codeBg, tableHeadBg); the remaining fields exist for the
// assistant's chrome and are never consulted by the renderer. They are still
// filled in with real values rather than left undefined, so the object is a
// valid AiTheme and not a lie the type system happens to accept.

import Markdown from "@/components/bhoomi-ai/Markdown";
import type { AiTheme } from "@/components/bhoomi-ai/theme";

export interface BodyPalette {
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  raised: string;
  surface: string;
}

/** Builds a complete AiTheme from the six colours a host surface actually has. */
export function bodyTheme(p: BodyPalette): AiTheme {
  return {
    text: p.text,
    textMuted: p.textMuted,
    textFaint: p.textMuted,
    accent: p.accent,
    border: p.border,
    borderSoft: p.border,
    surface: p.surface,
    surfaceRaised: p.raised,
    surfaceHover: p.raised,
    codeBg: p.raised,
    tableHeadBg: p.raised,
    fade: "none",
    ring: p.border,
  };
}

export default function UpdateBody({
  content, t,
}: {
  content: string;
  /** Any surface palette with these six keys — the Super Admin theme has them. */
  t: BodyPalette;
}) {
  return <Markdown content={content} t={bodyTheme(t)} />;
}
