"use client";

// components/superadmin/UpdateEditorModal.tsx — compose a System Update.
//
// ── On the "existing rich-text editor" ──────────────────────────────────────
// The brief says to use the project's existing rich-text editor if available.
// There is not one: no editor library is installed (no TipTap, Quill, Slate or
// Lexical in package.json), and nothing in the codebase renders authored HTML —
// the four `dangerouslySetInnerHTML` call sites are all static <style> blocks
// and inlined SVG the app itself wrote.
//
// What DOES exist is a hand-written markdown renderer, components/bhoomi-ai/
// Markdown.tsx, built for the AI assistant precisely because model output is
// untrusted. It emits React elements and never touches dangerouslySetInnerHTML,
// so raw HTML in the source string renders as literal text and cannot become
// markup; link hrefs are restricted to http/https/mailto, so a `javascript:` URL
// cannot become a live anchor.
//
// So the description is authored as markdown and rendered through that renderer.
// The formatting the brief asks for — bold, italic, paragraphs, bullet points,
// links — is exactly what it supports, and XSS is prevented structurally rather
// than by sanitising a string after the fact. The toolbar below wraps the
// selection in markdown syntax; it is a typing shortcut, not a second format.
//
// Adding an editor dependency for six formatting marks would have meant a new
// supply-chain surface and a sanitiser to go with it, for less safety than this.

import { useEffect, useMemo, useRef, useState } from "react";
import type { SuperAdminTheme } from "./theme";
import { tint } from "./theme";
import { Btn, ErrorNote, Field, Modal, SelectField, TextArea, Toggle } from "./dialogs";
import UpdateBody from "./UpdateBody";

/** The six types the API accepts. Mirrors UPDATE_TYPES in lib/crmUpdates.ts. */
const TYPES = ["Update", "Important", "Feature", "Improvement", "Fix", "Maintenance"] as const;

export interface EditableUpdate {
  id?: number;
  version: string;
  title: string;
  description: string | null;
  type: string | null;
  features: string[];
  isImportant: boolean;
}

const EMPTY: EditableUpdate = {
  version: "",
  title: "",
  description: "",
  type: "Update",
  features: [],
  isImportant: false,
};

/** Toolbar buttons. Each wraps or prefixes the current selection. */
const MARKS: { label: string; title: string; wrap?: [string, string]; prefix?: string }[] = [
  { label: "B", title: "Bold", wrap: ["**", "**"] },
  { label: "I", title: "Italic", wrap: ["*", "*"] },
  { label: "• List", title: "Bullet point", prefix: "- " },
  { label: "Link", title: "Link", wrap: ["[", "](https://)"] },
];

export default function UpdateEditorModal({
  open, t, existing, onClose, onSaved,
}: {
  open: boolean;
  t: SuperAdminTheme;
  /** null = create. */
  existing: (EditableUpdate & { id: number; status?: string }) | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<EditableUpdate>({ ...EMPTY });
  const [featureText, setFeatureText] = useState("");
  const [saving, setSaving] = useState<"draft" | "publish" | "save" | null>(null);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset on every open so a previous attempt never bleeds into the next one.
  useEffect(() => {
    if (!open) return;
    setError("");
    setTouched(false);
    setShowPreview(false);
    if (existing) {
      setForm({
        id: existing.id,
        version: existing.version,
        title: existing.title,
        description: existing.description ?? "",
        type: existing.type ?? "Update",
        features: existing.features ?? [],
        isImportant: existing.isImportant,
      });
      setFeatureText((existing.features ?? []).join("\n"));
    } else {
      setForm({ ...EMPTY });
      setFeatureText("");
    }
  }, [open, existing]);

  const isEdit = existing != null;
  const versionOk = form.version.trim().length > 0;
  const titleOk = form.title.trim().length > 0;
  const canSubmit = versionOk && titleOk && saving === null;

  const features = useMemo(
    () => featureText.split("\n").map(f => f.trim()).filter(Boolean),
    [featureText]
  );

  /** Applies a markdown mark to the textarea's current selection. */
  function applyMark(mark: (typeof MARKS)[number]) {
    const el = bodyRef.current;
    if (!el) return;
    const value = form.description ?? "";
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const selected = value.slice(start, end);

    let next: string;
    let caret: number;
    if (mark.wrap) {
      next = value.slice(0, start) + mark.wrap[0] + selected + mark.wrap[1] + value.slice(end);
      caret = start + mark.wrap[0].length + selected.length;
    } else {
      // Line prefix: applied to every selected line, or the current one.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const block = value.slice(lineStart, end || start);
      const prefixed = (block || "").split("\n").map(l => (l.startsWith(mark.prefix!) ? l : mark.prefix + l)).join("\n");
      next = value.slice(0, lineStart) + prefixed + value.slice(end || start);
      caret = lineStart + prefixed.length;
    }
    setForm(f => ({ ...f, description: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  async function submit(mode: "draft" | "publish" | "save") {
    setTouched(true);
    if (!versionOk || !titleOk) return;
    setSaving(mode);
    setError("");

    const payload = {
      version: form.version.trim(),
      title: form.title.trim(),
      description: (form.description ?? "").trim(),
      type: form.type || "Update",
      features,
      isImportant: form.isImportant,
      audienceType: "all_users",
    };

    try {
      const res = isEdit
        ? await fetch(`/api/platform/updates/${existing!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", ...payload }),
          })
        : await fetch("/api/platform/updates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // The server decides the status from this flag alone; the form has
            // no status field, so "save" can never publish by accident.
            body: JSON.stringify({ ...payload, publish: mode === "publish" }),
          });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Could not save the update.");
      onSaved(json.message || "Saved.");
    } catch (e: any) {
      setError(e?.message || "Could not save the update.");
    } finally {
      setSaving(null);
    }
  }

  const errFor = (ok: boolean, msg: string) => (touched && !ok ? msg : undefined);

  return (
    <Modal
      open={open}
      t={t}
      wide
      busy={saving !== null}
      title={isEdit ? "Edit Update" : "Create Update"}
      subtitle={
        isEdit
          ? "Editing content does not change whether this update is live."
          : "Publish an announcement across every organization in the CRM."
      }
      onClose={onClose}
      footer={
        <>
          <Btn t={t} tone="quiet" onClick={onClose} disabled={saving !== null}>Cancel</Btn>
          {isEdit ? (
            <Btn t={t} tone="primary" onClick={() => submit("save")} disabled={!canSubmit}>
              {saving === "save" ? "Saving…" : "Save Changes"}
            </Btn>
          ) : (
            <>
              <Btn t={t} tone="quiet" onClick={() => submit("draft")} disabled={!canSubmit}>
                {saving === "draft" ? "Saving…" : "Save Draft"}
              </Btn>
              <Btn t={t} tone="primary" onClick={() => submit("publish")} disabled={!canSubmit}>
                {saving === "publish" ? "Publishing…" : "Publish Update"}
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            t={t}
            label="Version"
            value={form.version}
            onChange={v => setForm(f => ({ ...f, version: v }))}
            placeholder="v2.1.4"
            maxLength={50}
            autoComplete="off"
            error={errFor(versionOk, "A version is required.")}
          />
          <SelectField
            t={t}
            label="Type"
            value={form.type ?? "Update"}
            onChange={v => setForm(f => ({ ...f, type: v }))}
            options={TYPES}
          />
        </div>

        <Field
          t={t}
          label="Title"
          value={form.title}
          onChange={v => setForm(f => ({ ...f, title: v }))}
          placeholder="UI/UX Upgrade Released"
          maxLength={255}
          autoComplete="off"
          error={errFor(titleOk, "A title is required.")}
        />

        {/* ── Description ── */}
        <div>
          <div className="flex items-center justify-between mb-1.5 gap-3">
            <span className="text-[12px] font-medium" style={{ color: t.textMuted }}>Description</span>
            <div className="flex items-center gap-1">
              {MARKS.map(m => (
                <button
                  key={m.label}
                  type="button"
                  title={m.title}
                  onClick={() => applyMark(m)}
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold"
                  style={{
                    color: t.text,
                    background: t.raised,
                    fontStyle: m.title === "Italic" ? "italic" : undefined,
                  }}
                >
                  {m.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowPreview(v => !v)}
                className="px-2 py-1 rounded-lg text-[11px] font-semibold ml-1"
                style={
                  showPreview
                    ? { color: t.accent, background: tint(t.accent, 0.12) }
                    : { color: t.text, background: t.raised }
                }
              >
                Preview
              </button>
            </div>
          </div>

          {showPreview ? (
            <div
              className="rounded-xl px-3.5 py-3 min-h-[180px]"
              style={{ background: t.raised, border: `1px solid ${t.border}` }}
            >
              {(form.description ?? "").trim() ? (
                <UpdateBody t={t} content={form.description ?? ""} />
              ) : (
                <p className="text-[12px]" style={{ color: t.textMuted }}>Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              ref={bodyRef}
              value={form.description ?? ""}
              rows={8}
              maxLength={20000}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={"What changed, and why it matters.\n\n**Bold**, *italic*, - bullets and [links](https://example.com) are supported."}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-colors resize-y leading-relaxed"
              style={{ background: t.raised, color: t.text, border: `1px solid transparent` }}
              onFocus={e => { e.currentTarget.style.borderColor = t.borderStrong; }}
              onBlur={e => { e.currentTarget.style.borderColor = "transparent"; }}
            />
          )}
          <span className="block text-[11px] mt-1" style={{ color: t.textMuted }}>
            Bold, italic, bullet points and links. Rendered as text, never as HTML.
          </span>
        </div>

        <TextArea
          t={t}
          label="Highlights (optional)"
          value={featureText}
          onChange={setFeatureText}
          rows={4}
          placeholder={"One per line\nEach becomes a ticked bullet in the update"}
          hint={`${features.length} ${features.length === 1 ? "highlight" : "highlights"}`}
        />

        <div className="grid sm:grid-cols-2 gap-4 pt-1" style={{ borderTop: `1px solid ${t.border}` }}>
          <div className="pt-4">
            <SelectField
              t={t}
              label="Audience"
              value="All Users"
              onChange={() => { /* single option today — see the hint */ }}
              options={["All Users"]}
              hint="Role-specific audiences are not available yet."
            />
          </div>
          <div className="pt-4 sm:pt-9">
            <Toggle
              t={t}
              label="Mark as important"
              checked={form.isImportant}
              onChange={v => setForm(f => ({ ...f, isImportant: v }))}
              hint="Adds the red Important flag in the users' System Updates panel."
            />
          </div>
        </div>

        {error && <ErrorNote t={t}>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
