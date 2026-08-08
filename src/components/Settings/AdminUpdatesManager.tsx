"use client";

// components/Settings/AdminUpdatesManager.tsx
//
// Moved out of app/dashboard/settings/page.tsx when that page became the
// Settings shell. Behaviour is unchanged — same /api/updates calls, same
// payload, same create/edit/delete flow — only the styling is redone in the
// light Settings palette and the browser `confirm()` on delete is replaced with
// the panel's own modal.

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Select,
  T,
  TextInput,
  api,
  inputClass,
  inputStyle,
  useToast,
} from "./ui";

interface CrmUpdate {
  id: number;
  version: string;
  title: string;
  description?: string;
  category?: string;
  features?: string[];
  is_important: boolean;
}

const EMPTY = {
  version: "",
  title: "",
  description: "",
  category: "Major Update",
  features: "",
  isImportant: false,
};

export default function AdminUpdatesManager({ user }: { user: any }) {
  const toast = useToast();
  const [updates, setUpdates] = useState<CrmUpdate[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState<CrmUpdate | null>(null);

  const userId = user?.id || user?._id || 1;

  const fetchUpdates = useCallback(async () => {
    try {
      const data = await api<{ data: CrmUpdate[] }>(`/api/updates?userId=${userId}`);
      setUpdates(data.data ?? []);
    } catch (err: any) {
      toast("error", err.message);
    }
  }, [userId, toast]);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  const startEdit = (update: CrmUpdate) => {
    setEditingId(update.id);
    setForm({
      version: update.version,
      title: update.title,
      description: update.description ?? "",
      category: update.category ?? "Major Update",
      features: Array.isArray(update.features) ? update.features.join("\n") : "",
      isImportant: update.is_important,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY });
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.version.trim() || !form.title.trim()) return;

    setPublishing(true);
    try {
      await api("/api/updates", {
        method: editingId ? "PUT" : "POST",
        json: {
          id: editingId,
          action: "create", // ignored by PUT, kept for the existing POST contract
          version: form.version.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          features: form.features
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean),
          is_important: form.isImportant,
          created_by: user?.name,
        },
      });

      toast("success", editingId ? "Update modified successfully." : "Update published.");
      cancelEdit();
      fetchUpdates();
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setPublishing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api(`/api/updates?id=${deleting.id}`, { method: "DELETE" });
      toast("success", "Update deleted.");
      setDeleting(null);
      fetchUpdates();
    } catch (err: any) {
      toast("error", err.message);
    }
  };

  return (
    <>
      <Card
        title="System Updates"
        description="Release notes shown behind the megaphone icon in the CRM header."
        footer={
          <>
            {editingId && (
              <Button variant="secondary" onClick={cancelEdit} disabled={publishing}>
                Cancel edit
              </Button>
            )}
            <Button onClick={publish} loading={publishing}>
              {editingId ? "Save Changes" : "Publish to Megaphone"}
            </Button>
          </>
        }
      >
        <form onSubmit={publish}>
          <div className="grid gap-x-5 sm:grid-cols-2">
            <Field label="Version number" htmlFor="upd-version" required>
              <TextInput
                id="upd-version"
                required
                value={form.version}
                onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                placeholder="2.1.0"
              />
            </Field>
            <Field label="Category" htmlFor="upd-category">
              <Select
                id="upd-category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option>Major Update</option>
                <option>Minor Update</option>
                <option>Bug Fixes</option>
                <option>Announcement</option>
              </Select>
            </Field>
          </div>

          <Field label="Title" htmlFor="upd-title" required>
            <TextInput
              id="upd-title"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>

          <Field label="Description" htmlFor="upd-description">
            <textarea
              id="upd-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={`${inputClass} h-20 resize-none`}
              style={inputStyle(false)}
            />
          </Field>

          <Field label="Bullet points" htmlFor="upd-features" hint="One per line.">
            <textarea
              id="upd-features"
              value={form.features}
              onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
              placeholder={"Added new layout\nFixed bug in dashboard"}
              className={`${inputClass} h-28 resize-none`}
              style={inputStyle(false)}
            />
          </Field>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm" style={{ color: T.text }}>
            <input
              type="checkbox"
              checked={form.isImportant}
              onChange={(e) => setForm((f) => ({ ...f, isImportant: e.target.checked }))}
              style={{ accentColor: T.teal }}
            />
            Mark as important (shows a red warning icon)
          </label>
        </form>
      </Card>

      <Card title="Past updates">
        {updates.length === 0 ? (
          <EmptyState title="No updates published yet" />
        ) : (
          <ul className="space-y-3">
            {updates.map((update) => (
              <li
                key={update.id}
                className="flex items-start justify-between gap-4 rounded-lg border p-4"
                style={{ borderColor: T.border }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: T.sidebar, color: T.muted }}
                    >
                      v{update.version}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: T.text }}>
                      {update.title}
                    </span>
                  </div>
                  {update.description && (
                    <p className="mt-1 line-clamp-1 text-xs" style={{ color: T.muted }}>
                      {update.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(update)}
                    aria-label={`Edit update ${update.version}`}
                    className="h-11 w-11 rounded-lg st-hover-surface"
                    style={{ color: T.muted }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(update)}
                    aria-label={`Delete update ${update.version}`}
                    className="h-11 w-11 rounded-lg hover:bg-red-50"
                    style={{ color: T.danger }}
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete update v${deleting?.version}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: T.text }}>
          &quot;{deleting?.title}&quot; will be removed from the megaphone for everyone. This cannot
          be undone.
        </p>
      </Modal>
    </>
  );
}
