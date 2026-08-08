"use client";

// components/bhoomi-ai/Markdown.tsx — the assistant's answer renderer.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The system prompt tells the model: "Use a markdown table when comparing more
// than two rows." The panel rendered answers as `whitespace-pre-wrap` plain
// text, so every one of those tables arrived as a wall of pipes and dashes.
// This is the fix for that, not decoration.
//
// ── Why it is hand-written ───────────────────────────────────────────────────
// No markdown library is installed. Adding one (react-markdown + remark-gfm)
// for a bounded subset of an LLM's output is a supply-chain and bundle cost the
// feature does not need, and it would still need bespoke table styling to fit
// the conversation column.
//
// ── Why it cannot inject HTML ────────────────────────────────────────────────
// It emits React elements and never touches dangerouslySetInnerHTML. Model
// output is untrusted — it can quote a lead's free-text notes — so raw HTML in
// the string is rendered as literal text, and link hrefs are restricted to
// http/https/mailto so a `javascript:` URL cannot become a live anchor.

import React, { useMemo } from "react";
import type { AiTheme } from "./theme";

/* ── Inline ─────────────────────────────────────────────────────────────────*/

// Code first, so ** inside a code span is not treated as emphasis.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:|mailto:)/i.test(u) ? u : null;
}

function renderInline(text: string, t: AiTheme, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${m.index}`;

    if (tok.startsWith("`")) {
      out.push(
        <code
          key={k}
          className="rounded px-1.5 py-0.5 text-[0.86em] font-mono"
          style={{ background: t.codeBg, color: t.accent }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={k} style={{ fontWeight: 650, color: t.text }}>
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("*")) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else {
      const close = tok.indexOf("](");
      const label = tok.slice(1, close);
      const href = safeHref(tok.slice(close + 2, -1));
      out.push(
        href ? (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
            style={{ color: t.accent }}
          >
            {label}
          </a>
        ) : (
          // Unsafe scheme: show the text, drop the link.
          <span key={k}>{label}</span>
        )
      );
    }
    last = m.index + tok.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ── Block parsing ──────────────────────────────────────────────────────────*/

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "hr" };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

const isDivider = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      blocks.push({ kind: "code", lang, code: body.join("\n") });
      continue;
    }

    // Table: a header row followed by a |---|---| divider.
    if (line.includes("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i++]));
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", lines: body });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: consecutive plain lines, joined with soft breaks.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,4}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isDivider(lines[i + 1]))
    ) {
      body.push(lines[i++]);
    }
    if (body.length) blocks.push({ kind: "p", lines: body });
    else i++; // guard against a line no rule consumed
  }

  return blocks;
}

/* ── Render ─────────────────────────────────────────────────────────────────*/

export default function Markdown({ content, t }: { content: string; t: AiTheme }) {
  const blocks = useMemo(() => parse(content), [content]);

  const H = [
    "text-[17px] font-bold mt-5 mb-2",
    "text-[15.5px] font-bold mt-5 mb-2",
    "text-[14.5px] font-semibold mt-4 mb-1.5",
    "text-[14px] font-semibold mt-3 mb-1",
  ];

  return (
    // 14.5px / 1.7 — the readable-prose target, and small enough that a long
    // analysis does not turn into a scroll marathon.
    <div className="text-[14.5px] leading-[1.7] first:[&>*]:mt-0" style={{ color: t.text }}>
      {blocks.map((b, bi) => {
        switch (b.kind) {
          case "h":
            return (
              <div key={bi} className={H[b.level - 1]} style={{ color: t.text }}>
                {renderInline(b.text, t, `h${bi}`)}
              </div>
            );

          case "p":
            return (
              <p key={bi} className="my-2.5 first:mt-0">
                {b.lines.map((ln, li) => (
                  <React.Fragment key={li}>
                    {li > 0 && <br />}
                    {renderInline(ln, t, `p${bi}-${li}`)}
                  </React.Fragment>
                ))}
              </p>
            );

          case "ul":
            return (
              <ul key={bi} className="my-2.5 space-y-1.5 pl-1">
                {b.items.map((it, ii) => (
                  <li key={ii} className="flex gap-2.5">
                    <span aria-hidden className="mt-[0.62em] h-1 w-1 flex-shrink-0 rounded-full" style={{ background: t.accent }} />
                    <span className="min-w-0 flex-1">{renderInline(it, t, `ul${bi}-${ii}`)}</span>
                  </li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={bi} className="my-2.5 space-y-1.5 pl-1">
                {b.items.map((it, ii) => (
                  <li key={ii} className="flex gap-2.5">
                    <span
                      aria-hidden
                      className="mt-[0.06em] w-4 flex-shrink-0 text-[12.5px] font-semibold tabular-nums"
                      style={{ color: t.accent }}
                    >
                      {ii + 1}.
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(it, t, `ol${bi}-${ii}`)}</span>
                  </li>
                ))}
              </ol>
            );

          case "code":
            return (
              <pre
                key={bi}
                className="my-3 overflow-x-auto rounded-xl border p-3.5 text-[12.5px] leading-relaxed"
                style={{ background: t.codeBg, borderColor: t.border }}
              >
                <code className="font-mono" style={{ color: t.text }}>
                  {b.code}
                </code>
              </pre>
            );

          case "quote":
            return (
              <blockquote
                key={bi}
                className="my-3 border-l-2 pl-3.5 italic"
                style={{ borderColor: t.accent, color: t.textMuted }}
              >
                {b.lines.map((ln, li) => (
                  <p key={li}>{renderInline(ln, t, `q${bi}-${li}`)}</p>
                ))}
              </blockquote>
            );

          case "hr":
            return <hr key={bi} className="my-4" style={{ borderColor: t.border }} />;

          case "table":
            return (
              // The scroller is the wrapper, not the page: a 9-column comparison
              // scrolls inside the conversation column instead of widening it.
              <div
                key={bi}
                className="my-3 w-full overflow-x-auto rounded-xl border"
                style={{ borderColor: t.border }}
              >
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr style={{ background: t.tableHeadBg }}>
                      {b.head.map((h2, hi) => (
                        <th
                          key={hi}
                          className="whitespace-nowrap px-3.5 py-2.5 text-left font-semibold"
                          style={{ color: t.text, borderBottom: `1px solid ${t.border}` }}
                        >
                          {renderInline(h2, t, `th${bi}-${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="px-3.5 py-2.5 align-top"
                            style={{
                              color: t.textMuted,
                              borderBottom: ri === b.rows.length - 1 ? "none" : `1px solid ${t.borderSoft}`,
                              // Figures line up column-wise when they are digits.
                              fontVariantNumeric: /^[₹\d]/.test(cell) ? "tabular-nums" : undefined,
                            }}
                          >
                            {renderInline(cell, t, `td${bi}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
