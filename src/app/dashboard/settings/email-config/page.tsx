"use client";

// Settings > Email Configuration
//
// Admin interface for enabling/disabling email triggers, editing subjects and
// bodies, and generating alternative wording via the dice button.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Field,
  InfoBanner,
  Modal,
  PageHeader,
  Skeleton,
  StatusBadge,
  T,
  TextInput,
  Toggle,
  api,
  useToast,
} from "@/components/Settings/ui";
import { FaDice, FaEdit, FaEnvelope, FaSearch } from "react-icons/fa";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Trigger {
  trigger_key: string;
  display_name: string;
  category: string;
  description: string;
  recipient_desc: string;
  enabled: boolean;
  custom_subject: string | null;
  custom_body: string | null;
  default_subject: string;
  default_body: string;
  variables: string[];
  updated_at: string;
  updated_by: number | null;
  updater_name: string | null;
}

interface Stats {
  total: number;
  enabled: number;
  disabled: number;
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function EmailConfigPage() {
  const toast = useToast();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, enabled: 0, disabled: 0 });
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");
  const [editing, setEditing] = useState<Trigger | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    api<{ triggers: Trigger[]; stats: Stats; migration_pending?: boolean }>("/api/admin/email-config")
      .then((data) => {
        setTriggers(data.triggers);
        setStats(data.stats);
        setMigrationPending(!!data.migration_pending);
      })
      .catch((err: unknown) => toast("error", err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = triggers;
    if (filterEnabled === "enabled") list = list.filter((t) => t.enabled);
    if (filterEnabled === "disabled") list = list.filter((t) => !t.enabled);
    if (search.trim()) {
      const needle = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.display_name.toLowerCase().includes(needle) ||
          t.category.toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle)
      );
    }
    return list;
  }, [triggers, search, filterEnabled]);

  const categories = useMemo(() => {
    const cats = new Map<string, Trigger[]>();
    for (const t of filtered) {
      const list = cats.get(t.category) ?? [];
      list.push(t);
      cats.set(t.category, list);
    }
    return cats;
  }, [filtered]);

  const handleToggle = async (trigger: Trigger) => {
    const newEnabled = !trigger.enabled;
    // Optimistic update
    setTriggers((prev) =>
      prev.map((t) => (t.trigger_key === trigger.trigger_key ? { ...t, enabled: newEnabled } : t))
    );
    setStats((prev) => ({
      ...prev,
      enabled: prev.enabled + (newEnabled ? 1 : -1),
      disabled: prev.disabled + (newEnabled ? -1 : 1),
    }));
    setToggling((prev) => new Set(prev).add(trigger.trigger_key));

    try {
      await api("/api/admin/email-config", {
        method: "PATCH",
        json: { trigger_key: trigger.trigger_key, enabled: newEnabled },
      });
      toast("success", `${trigger.display_name} ${newEnabled ? "enabled" : "disabled"}`);
    } catch (err: unknown) {
      // Roll back
      setTriggers((prev) =>
        prev.map((t) =>
          t.trigger_key === trigger.trigger_key ? { ...t, enabled: !newEnabled } : t
        )
      );
      setStats((prev) => ({
        ...prev,
        enabled: prev.enabled + (newEnabled ? -1 : 1),
        disabled: prev.disabled + (newEnabled ? 1 : -1),
      }));
      toast("error", err instanceof Error ? err.message : "Failed to update");
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(trigger.trigger_key);
        return next;
      });
    }
  };

  const handleSaved = (updated: Trigger) => {
    setTriggers((prev) =>
      prev.map((t) => (t.trigger_key === updated.trigger_key ? { ...t, ...updated } : t))
    );
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        title="Email Configuration"
        subtitle="Control which system emails are sent, edit their content, and preview changes."
      />

      {migrationPending && (
        <InfoBanner tone="warning">
          The email configuration table has not been migrated to the database yet.
          Changes will not persist until <code>2026-10-19_email_trigger_config.sql</code> is applied.
        </InfoBanner>
      )}

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "Total Triggers", value: stats.total, status: "neutral" as const },
          { label: "Enabled", value: stats.enabled, status: "active" as const },
          { label: "Disabled", value: stats.disabled, status: stats.disabled > 0 ? "danger" as const : "neutral" as const },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[16px] border p-5"
            style={{ background: T.surface, borderColor: T.border }}
          >
            <p className="crm-secondary mb-1" style={{ color: T.muted }}>
              {card.label}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" style={{ color: T.text }}>
                {loading ? "-" : card.value}
              </span>
              <StatusBadge status={card.status}>{card.status === "active" ? "ON" : card.status === "danger" ? "OFF" : ""}</StatusBadge>
            </div>
          </div>
        ))}
      </div>

      {/* Search and filter */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <FaSearch
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
            style={{ color: T.muted }}
          />
          <TextInput
            placeholder="Search triggers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "enabled", "disabled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterEnabled(f)}
              className="rounded-[10px] border px-3.5 py-2 text-[13px] font-medium tracking-tight st-transition"
              style={{
                background: filterEnabled === f ? T.accentSoft : T.surface,
                borderColor: filterEnabled === f ? T.teal : T.border,
                color: filterEnabled === f ? T.teal : T.text,
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Trigger list */}
      {loading ? (
        <Card><Skeleton rows={6} /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="crm-body" style={{ color: T.muted }}>No email triggers match your filter.</p>
          </div>
        </Card>
      ) : (
        Array.from(categories.entries()).map(([category, items]) => (
          <Card key={category} title={category}>
            <div className="divide-y" style={{ borderColor: T.border }}>
              {items.map((trigger) => (
                <div
                  key={trigger.trigger_key}
                  className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <FaEnvelope className="h-3 w-3 flex-shrink-0" style={{ color: trigger.enabled ? T.teal : T.muted }} />
                      <span className="crm-body font-semibold truncate" style={{ color: T.text }}>
                        {trigger.display_name}
                      </span>
                      {trigger.custom_subject || trigger.custom_body ? (
                        <span
                          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                          style={{ background: T.accentSoft, color: T.teal }}
                        >
                          Customised
                        </span>
                      ) : null}
                    </div>
                    <p className="crm-secondary mb-1" style={{ color: T.muted }}>
                      {trigger.description}
                    </p>
                    <p className="crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
                      Recipients: {trigger.recipient_desc}
                      {trigger.updated_by && trigger.updater_name && (
                        <> &middot; Last edited by {trigger.updater_name}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 pt-1">
                    <button
                      onClick={() => setEditing(trigger)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] st-hover-surface st-transition"
                      style={{ color: T.muted }}
                      title="Edit & Configure"
                    >
                      <FaEdit className="h-3.5 w-3.5" />
                    </button>
                    <Toggle
                      checked={trigger.enabled}
                      onChange={() => handleToggle(trigger)}
                      label={`Toggle ${trigger.display_name}`}
                      disabled={toggling.has(trigger.trigger_key)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {/* Edit modal */}
      {editing && (
        <EditTriggerModal
          trigger={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}

/* ── Edit modal ────────────────────────────────────────────────────────── */

function EditTriggerModal({
  trigger,
  onClose,
  onSaved,
}: {
  trigger: Trigger;
  onClose: () => void;
  onSaved: (updated: Trigger) => void;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(trigger.enabled);
  const [subject, setSubject] = useState(trigger.custom_subject ?? trigger.default_subject);
  const [body, setBody] = useState(trigger.custom_body ?? trigger.default_body);
  const [saving, setSaving] = useState(false);
  const [generatingSubject, setGeneratingSubject] = useState(false);
  const [generatingBody, setGeneratingBody] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Track if user has made changes
  const originalSubject = trigger.custom_subject ?? trigger.default_subject;
  const originalBody = trigger.custom_body ?? trigger.default_body;
  const hasChanges = enabled !== trigger.enabled || subject !== originalSubject || body !== originalBody;

  const handleSave = async () => {
    setSaving(true);
    try {
      const isDefaultSubject = subject === trigger.default_subject;
      const isDefaultBody = body === trigger.default_body;
      const result = await api<{ trigger: Trigger }>("/api/admin/email-config", {
        method: "PATCH",
        json: {
          trigger_key: trigger.trigger_key,
          enabled,
          custom_subject: isDefaultSubject ? null : subject,
          custom_body: isDefaultBody ? null : body,
        },
      });
      toast("success", "Email configuration saved.");
      onSaved({ ...trigger, ...result.trigger });
    } catch (err: unknown) {
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async (field: "subject" | "body") => {
    const setter = field === "subject" ? setGeneratingSubject : setGeneratingBody;
    setter(true);
    try {
      const result = await api<{ suggestion: string }>("/api/admin/email-config/generate", {
        method: "POST",
        json: { trigger_key: trigger.trigger_key, field },
      });
      if (field === "subject") {
        setSubject(result.suggestion);
      } else {
        setBody(result.suggestion);
      }
      toast("info", `Alternative ${field} generated. Review and save.`);
    } catch (err: unknown) {
      toast("error", err instanceof Error ? err.message : "Generation failed");
    } finally {
      setter(false);
    }
  };

  const handleReset = () => {
    setSubject(trigger.default_subject);
    setBody(trigger.default_body);
    setConfirmReset(false);
    toast("info", "Reset to defaults. Save to persist.");
  };

  // Render preview by replacing variables with sample values
  const renderPreview = (text: string) => {
    const samples: Record<string, string> = {
      name: "John Doe",
      customer_name: "Jane Smith",
      code: "482913",
      purpose: "verify your email address",
      expiry_minutes: "10",
      date: "19 Oct 2026",
      time: "10:30 AM IST",
      device: "Chrome on Windows",
      browser: "Chrome 118",
      ip_address: "203.0.113.42",
      location: "Mumbai, India",
      employee_name: "Rahul Sharma",
      role: "Sales Manager",
      organization: "Bhoomi Dwellers",
      assigned_to: "Rahul Sharma",
      provider: "SMTP",
    };
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => samples[key] ?? `{{${key}}}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit: ${trigger.display_name}`}
      description={trigger.description}
      width="max-w-2xl"
      footer={
        <>
          {hasChanges && (
            <span className="crm-caption mr-auto" style={{ color: T.warning }}>
              Unsaved changes
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmReset(true)}
            disabled={
              subject === trigger.default_subject && body === trigger.default_body
            }
          >
            Reset to Default
          </Button>
          <Button variant="secondary" onClick={() => setPreviewMode(!previewMode)}>
            {previewMode ? "Edit" : "Preview"}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!hasChanges}>
            Save Changes
          </Button>
        </>
      }
    >
      {/* Enabled toggle */}
      <div
        className="flex items-center justify-between gap-4 mb-5 pb-4 border-b"
        style={{ borderColor: T.border }}
      >
        <div>
          <p className="crm-body font-medium" style={{ color: T.text }}>
            Enabled
          </p>
          <p className="crm-secondary" style={{ color: T.muted }}>
            When off, this email will not be sent.
          </p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} label="Toggle trigger" />
      </div>

      {/* Recipient info */}
      <div className="mb-5 rounded-[12px] px-4 py-3" style={{ background: T.surfaceAlt }}>
        <p className="crm-caption font-medium mb-0.5" style={{ color: T.muted }}>
          Recipients
        </p>
        <p className="crm-body" style={{ color: T.text }}>
          {trigger.recipient_desc}
        </p>
      </div>

      {previewMode ? (
        /* Preview */
        <div>
          <p className="crm-label mb-3" style={{ color: T.text }}>
            Email Preview
          </p>
          <div
            className="rounded-[14px] border overflow-hidden"
            style={{ borderColor: T.border }}
          >
            {/* Subject bar */}
            <div className="border-b px-4 py-3" style={{ borderColor: T.border, background: T.surfaceAlt }}>
              <p className="crm-caption" style={{ color: T.muted }}>
                Subject
              </p>
              <p className="crm-body font-medium" style={{ color: T.text }}>
                {renderPreview(subject)}
              </p>
            </div>
            {/* Body */}
            <div className="px-4 py-4" style={{ background: T.surface }}>
              <pre
                className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans"
                style={{ color: T.text }}
              >
                {renderPreview(body)}
              </pre>
            </div>
          </div>
          <p className="mt-2 crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
            Variables shown with sample data. Actual values will be filled at send time.
          </p>
        </div>
      ) : (
        /* Editor */
        <>
          {/* Subject */}
          <Field label="Email Subject" htmlFor="email-subject">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <TextInput
                  id="email-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={500}
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 crm-caption"
                  style={{ color: T.muted, fontWeight: 400 }}
                >
                  {subject.length}/500
                </span>
              </div>
              <button
                onClick={() => handleGenerate("subject")}
                disabled={generatingSubject}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-[10px] border st-hover-surface st-transition disabled:opacity-50"
                style={{ borderColor: T.border, color: T.teal }}
                title="Generate alternative subject"
              >
                {generatingSubject ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <FaDice className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>

          {/* Body */}
          <Field label="Email Body" htmlFor="email-body">
            <div className="flex gap-2 items-start">
              <textarea
                id="email-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                maxLength={50000}
                className="w-full rounded-[10px] border px-3.5 py-2.5 text-[14px] leading-relaxed tracking-tight outline-none st-input st-transition resize-y"
                style={{
                  borderColor: T.border,
                  color: T.text,
                  background: T.surface,
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => handleGenerate("body")}
                disabled={generatingBody}
                className="flex h-[44px] w-[44px] items-center justify-center rounded-[10px] border st-hover-surface st-transition disabled:opacity-50 flex-shrink-0"
                style={{ borderColor: T.border, color: T.teal }}
                title="Generate alternative body"
              >
                {generatingBody ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <FaDice className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>

          {/* Available variables */}
          {trigger.variables.length > 0 && (
            <div className="mt-2">
              <p className="crm-caption font-medium mb-2" style={{ color: T.muted }}>
                Available Variables (click to insert)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {trigger.variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      // Insert at cursor in body field, or append
                      const tag = `{{${v}}}`;
                      const el = document.getElementById("email-body") as HTMLTextAreaElement | null;
                      if (el) {
                        const start = el.selectionStart;
                        const end = el.selectionEnd;
                        const before = body.substring(0, start);
                        const after = body.substring(end);
                        setBody(before + tag + after);
                        requestAnimationFrame(() => {
                          el.focus();
                          el.setSelectionRange(start + tag.length, start + tag.length);
                        });
                      } else {
                        setBody((prev) => prev + tag);
                      }
                    }}
                    className="rounded-[8px] border px-2.5 py-1 text-[11px] font-mono tracking-tight st-hover-surface st-transition cursor-pointer"
                    style={{ borderColor: T.border, color: T.teal, background: T.accentSoft }}
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Reset confirmation */}
      {confirmReset && (
        <div
          className="mt-4 rounded-[12px] border p-4"
          style={{ borderColor: T.warning, background: T.warningSoft }}
        >
          <p className="crm-body font-medium mb-2" style={{ color: T.warningText }}>
            Reset to default?
          </p>
          <p className="crm-secondary mb-3" style={{ color: T.text }}>
            This will replace your custom subject and body with the system defaults.
            You must still click Save Changes to persist.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Keep Current
            </Button>
            <Button variant="danger" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
