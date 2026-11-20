"use client";

import { useCallback, useEffect, useState } from "react";
import { FaEdit, FaMapMarkerAlt, FaPlus, FaTrash } from "react-icons/fa";
import {
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  T,
  TextInput,
  api,
  useToast,
} from "@/components/Settings/ui";

interface SiteLocation {
  id: number;
  name: string;
  display_name: string | null;
  is_default: boolean;
  created_at: string;
}

export default function EnquiryFormSettingsPage() {
  const toast = useToast();
  const [locations, setLocations] = useState<SiteLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await api<{ locations: SiteLocation[] }>("/api/settings/site-locations");
      setLocations(res.locations);
    } catch (err: any) {
      toast("error", err.message || "Failed to load site locations.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const displayTrimmed = newDisplayName.trim() || null;
      const res = await api<{ location: SiteLocation }>("/api/settings/site-locations", {
        method: "POST",
        json: { name: trimmed, display_name: displayTrimmed },
      });
      setLocations((prev) => [...prev, res.location]);
      setNewName("");
      setNewDisplayName("");
      toast("success", "Site location added.");
    } catch (err: any) {
      toast("error", err.message || "Failed to add location.");
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (id: number) => {
    const loc = locations.find((l) => l.id === id);
    const trimmed = editName.trim();
    const displayTrimmed = editDisplayName.trim() || null;
    // For default locations, name stays unchanged — only display_name is editable
    const payload: Record<string, any> = { id, display_name: displayTrimmed };
    if (!loc?.is_default) {
      if (!trimmed) return;
      payload.name = trimmed;
    }
    setSaving(true);
    try {
      await api<{ message: string }>("/api/settings/site-locations", {
        method: "PATCH",
        json: payload,
      });
      setLocations((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, ...(payload.name ? { name: payload.name } : {}), display_name: displayTrimmed }
            : l
        )
      );
      setEditingId(null);
      setEditName("");
      setEditDisplayName("");
      toast("success", "Location updated.");
    } catch (err: any) {
      toast("error", err.message || "Failed to update location.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await api<{ message: string }>(`/api/settings/site-locations?id=${id}`, {
        method: "DELETE",
      });
      setLocations((prev) => prev.filter((l) => l.id !== id));
      toast("success", "Location deleted.");
    } catch (err: any) {
      toast("error", err.message || "Failed to delete location.");
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (loc: SiteLocation) => {
    setEditingId(loc.id);
    setEditName(loc.name);
    setEditDisplayName(loc.display_name || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDisplayName("");
  };

  return (
    <>
      <PageHeader
        title="Enquiry Form"
        subtitle="Configure site locations that appear in the Client Enquiry Form dropdown."
      />

      <Card
        title="Site Locations"
        description="Manage the site locations available for selection when submitting new enquiries. Your organization name is automatically added as the default."
      >
        {/* Add new location */}
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Location Name (internal)" htmlFor="new-location">
                <TextInput
                  id="new-location"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. APR - SHUBH ARAMBH"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Dropdown Label (optional)" htmlFor="new-display-name">
                <TextInput
                  id="new-display-name"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. Shubh ARAMBH"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                />
              </Field>
            </div>
            <Button onClick={handleAdd} loading={adding} disabled={!newName.trim()}>
              <FaPlus className="mr-1.5 text-xs" />
              Add Location
            </Button>
          </div>
          <p className="crm-caption" style={{ color: T.muted }}>
            The full name is stored in the database. The dropdown label, if set, is what appears in the Client Enquiry Form.
          </p>
        </div>

        {/* Location list */}
        {loading ? (
          <Skeleton rows={3} />
        ) : locations.length === 0 ? (
          <EmptyState title="No site locations configured yet." />
        ) : (
          <div className="space-y-2">
            {locations.map((loc) => (
              <div
                key={loc.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
                style={{
                  borderColor: T.border,
                  background: T.surface,
                }}
              >
                <FaMapMarkerAlt
                  className="flex-shrink-0 text-sm"
                  style={{ color: loc.is_default ? T.teal : T.muted }}
                />

                {editingId === loc.id ? (
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                      {!loc.is_default && (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                          placeholder="Location name"
                          style={{
                            borderColor: T.border,
                            background: T.surfaceAlt,
                            color: T.text,
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleUpdate(loc.id); }
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      )}
                      <input
                        type="text"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                        placeholder="Dropdown label (optional)"
                        style={{
                          borderColor: T.border,
                          background: T.surfaceAlt,
                          color: T.text,
                        }}
                        autoFocus={loc.is_default}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); handleUpdate(loc.id); }
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <Button onClick={() => handleUpdate(loc.id)} loading={saving}>
                        Save
                      </Button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg px-3 py-1.5 text-sm transition-colors"
                        style={{ color: T.muted }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium" style={{ color: T.text }}>
                        {loc.name}
                      </span>
                      {loc.is_default && (
                        <span
                          className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                          style={{
                            borderColor: T.teal,
                            color: T.teal,
                            background: T.accentSoft,
                          }}
                        >
                          Default
                        </span>
                      )}
                      {loc.display_name && (
                        <span className="ml-2 text-xs" style={{ color: T.muted }}>
                          Dropdown: <span style={{ color: T.text }}>{loc.display_name}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => startEdit(loc)}
                        className="rounded-lg p-2 transition-colors hover:opacity-80"
                        style={{ color: T.muted }}
                        title="Edit"
                      >
                        <FaEdit className="text-xs" />
                      </button>
                      {!loc.is_default && (
                        <button
                          onClick={() => handleDelete(loc.id)}
                          disabled={deletingId === loc.id}
                          className="rounded-lg p-2 transition-colors hover:opacity-80"
                          style={{ color: T.danger }}
                          title="Delete"
                        >
                          <FaTrash className="text-xs" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
