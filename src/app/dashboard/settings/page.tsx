"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredCrmUser } from "@/lib/authSession";
import { FaChevronLeft, FaWhatsapp } from "react-icons/fa";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Lead Number Sorting toggle (admin only)
  const [leadSortEnabled, setLeadSortEnabled] = useState(false);
  const [leadSortSaving, setLeadSortSaving] = useState(false);
  const [leadSortSaved, setLeadSortSaved] = useState(false);

  useEffect(() => {
    const p = getStoredCrmUser();
    if (!p) {
      router.replace("/");
    } else {
      setUser(p);
      fetch(`/api/users/update-whatsapp?name=${encodeURIComponent(p.name)}`)
        .then(r => r.json())
        .then(data => {
          if (data.success && data.whatsapp_number) {
            setWhatsappNumber(data.whatsapp_number);
          }
        })
        .catch(() => { });

      // Load lead sorting setting for admin
      if (p.role?.toLowerCase() === "admin") {
        fetch("/api/settings/lead-sorting", { cache: "no-store" })
          .then(r => r.json())
          .then(data => setLeadSortEnabled(data.enabled === true))
          .catch(() => {});
      }
    }
  }, [router]);

  const handleSave = async () => {
    if (!whatsappNumber.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/users/update-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, whatsapp_number: whatsappNumber.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch { }
    finally { setSaving(false); }
  };

  if (!user) return <div className="min-h-screen bg-[#0a0a0a]" />;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 transition-colors"
      >
        <FaChevronLeft /> Back to Dashboard
      </button>

      <div className="max-w-2xl mx-auto bg-[#111111] border border-[#222] rounded-2xl p-8 shadow-2xl">
        <h1 className="text-2xl font-bold mb-2">Account Settings</h1>
        <p className="text-gray-400 text-sm mb-8">Manage your account preferences and integrations.</p>

        <div className="space-y-8">
          {/* WhatsApp Settings */}
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <FaWhatsapp className="text-[#25D366]" /> WhatsApp Integration
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              This number is used when logging WhatsApp messages to the CRM timeline. Include country code without the + sign.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1 w-full">
                <label className="block text-xs mb-1.5 font-medium text-gray-400">
                  WhatsApp Number (with country code)
                </label>
                <input
                  type="tel"
                  value={whatsappNumber}
                  onChange={e => setWhatsappNumber(e.target.value)}
                  placeholder="e.g. 919876543210"
                  className="w-full bg-[#222] border border-[#333] rounded-lg p-3 text-sm outline-none transition-colors focus:border-[#9E217B] text-white"
                />
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !whatsappNumber.trim()}
                className={`w-full sm:w-auto px-6 py-3 rounded-lg font-bold text-sm transition-all ${saved ? "bg-green-600 text-white" : saving || !whatsappNumber.trim() ? "opacity-50 cursor-not-allowed bg-gray-600 text-white" : "bg-[#9E217B] hover:bg-[#b8268f] text-white"
                  }`}
              >
                {saved ? "✓ Saved" : saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          <hr className="border-[#333]" />

          <div>
            <h3 className="text-sm font-bold mb-2">Profile Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#333]">
                <span className="text-gray-500 block text-xs mb-1">Name</span>
                {user.name}
              </div>
              <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#333]">
                <span className="text-gray-500 block text-xs mb-1">Role</span>
                <span className="capitalize">{user.role}</span>
              </div>
              <div className="bg-[#1a1a1a] p-3 rounded-lg border border-[#333] col-span-2">
                <span className="text-gray-500 block text-xs mb-1">Email</span>
                {user.email || "N/A"}
              </div>
            </div>
          </div>

          Admin System Updates Broadcast
          {user?.role?.toLowerCase() === "admin" && (
            <>
              <hr className="border-[#333]" />

              {/* ── Lead Number Sorting Toggle ── */}
              <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                      <span className="text-[#9E217B] text-xl">🔢</span> Lead Number Sorting
                    </h2>
                    <p className="text-xs text-gray-400 mb-1">
                      Controls how Lead Numbers are assigned across the entire CRM.
                    </p>
                    <p className="text-xs text-gray-500">
                      <span className="font-semibold text-gray-300">OFF</span> — Leads are numbered by Enquiry Date (current behavior).<br />
                      <span className="font-semibold text-gray-300">ON</span> — Backdated Entry takes highest priority. Leads with a Backdated Entry date are sorted by that date; others use Date Created.
                    </p>
                  </div>

                  {/* Toggle Switch */}
                  <button
                    role="switch"
                    aria-checked={leadSortEnabled}
                    onClick={() => setLeadSortEnabled(v => !v)}
                    className={`relative flex-shrink-0 mt-1 w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-[#9E217B] focus:ring-offset-2 focus:ring-offset-[#1a1a1a] ${
                      leadSortEnabled ? "bg-[#9E217B]" : "bg-[#333]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300 ${
                        leadSortEnabled ? "translate-x-7" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-3 mt-5">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    leadSortEnabled
                      ? "text-[#9E217B] border-[#9E217B]/40 bg-[#9E217B]/10"
                      : "text-gray-400 border-gray-700 bg-[#222]"
                  }`}>
                    {leadSortEnabled ? "ON — Backdated-Priority Mode" : "OFF — Default Mode"}
                  </span>
                  <button
                    onClick={async () => {
                      setLeadSortSaving(true);
                      try {
                        const res = await fetch("/api/settings/lead-sorting", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ enabled: leadSortEnabled }),
                        });
                        const json = await res.json();
                        if (json.success) {
                          setLeadSortSaved(true);
                          setTimeout(() => setLeadSortSaved(false), 3000);
                        }
                      } catch {}
                      finally { setLeadSortSaving(false); }
                    }}
                    disabled={leadSortSaving}
                    className={`px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50 ${
                      leadSortSaved
                        ? "bg-green-600 text-white"
                        : "bg-[#9E217B] hover:bg-[#b8268f] text-white"
                    }`}
                  >
                    {leadSortSaved ? "✓ Saved & Recalculated" : leadSortSaving ? "Applying..." : "Save Setting"}
                  </button>
                </div>
              </div>

              <hr className="border-[#333]" />
              <AdminUpdatesManager user={user} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { FaEdit, FaTrash } from "react-icons/fa";

function AdminUpdatesManager({ user }: { user: any }) {
  const [updates, setUpdates] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Major Update");
  const [features, setFeatures] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const fetchUpdates = async () => {
    try {
      const res = await fetch(`/api/updates?userId=${user.id || user._id || 1}`);
      const data = await res.json();
      if (data.success) {
        setUpdates(data.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchUpdates();
  }, [user]);

  const handleEdit = (upd: any) => {
    setEditingId(upd.id);
    setVersion(upd.version);
    setTitle(upd.title);
    setDescription(upd.description || "");
    setCategory(upd.category || "Major Update");
    setFeatures(Array.isArray(upd.features) ? upd.features.join("\n") : "");
    setIsImportant(upd.is_important);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this update?")) return;
    try {
      await fetch(`/api/updates?id=${id}`, { method: "DELETE" });
      fetchUpdates();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setVersion("");
    setTitle("");
    setDescription("");
    setFeatures("");
    setIsImportant(false);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!version.trim() || !title.trim()) return;

    setPublishing(true);
    try {
      const featureArray = features
        .split('\n')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      const payload = {
        id: editingId,
        action: "create", // ignored by PUT
        version: version.trim(),
        title: title.trim(),
        description: description.trim(),
        category,
        features: featureArray,
        is_important: isImportant,
        created_by: user.name
      };

      const res = await fetch("/api/updates", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg(editingId ? "Update modified successfully!" : "Update published successfully!");
        handleCancelEdit();
        fetchUpdates();
        setTimeout(() => setSuccessMsg(""), 4000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-bold mb-2 text-[#9E217B]">Manage System Updates</h3>
      <p className="text-xs text-gray-400 mb-6">Create, edit, or delete release notes that appear in the CRM megaphone icon.</p>

      <form onSubmit={handlePublish} className={`space-y-4 p-5 rounded-xl border ${editingId ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-[#1a1a1a] border-[#333]'}`}>
        {editingId && (
          <div className="flex justify-between items-center mb-2">
            <span className="text-indigo-400 text-xs font-bold bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/30">
              Editing Update
            </span>
            <button type="button" onClick={handleCancelEdit} className="text-xs text-gray-400 hover:text-white underline">
              Cancel Edit
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Version Number (e.g. 2.1.0)</label>
            <input required value={version} onChange={e => setVersion(e.target.value)} className="w-full bg-[#222] border border-[#333] rounded-lg p-2.5 text-sm outline-none focus:border-[#9E217B]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-[#222] border border-[#333] rounded-lg p-2.5 text-sm outline-none focus:border-[#9E217B]">
              <option>Major Update</option>
              <option>Minor Update</option>
              <option>Bug Fixes</option>
              <option>Announcement</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Title</label>
          <input required value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-[#222] border border-[#333] rounded-lg p-2.5 text-sm outline-none focus:border-[#9E217B]" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Description (Paragraph)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-[#222] border border-[#333] rounded-lg p-2.5 text-sm outline-none focus:border-[#9E217B] h-20 resize-none" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Bullet Points (One per line)</label>
          <textarea placeholder="Added new layout&#10;Fixed bug in dashboard" value={features} onChange={e => setFeatures(e.target.value)} className="w-full bg-[#222] border border-[#333] rounded-lg p-2.5 text-sm outline-none focus:border-[#9E217B] h-28 resize-none" />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <input type="checkbox" id="isImportant" checked={isImportant} onChange={e => setIsImportant(e.target.checked)} className="accent-[#9E217B]" />
          <label htmlFor="isImportant" className="text-xs text-gray-300 cursor-pointer">Mark as Important (Shows red warning icon)</label>
        </div>

        {successMsg && (
          <div className="bg-green-900/40 border border-green-500/50 text-green-400 text-xs p-3 rounded-lg mt-4">
            ✓ {successMsg}
          </div>
        )}

        <div className="pt-2">
          <button type="submit" disabled={publishing} className={`w-full hover:bg-opacity-90 disabled:opacity-50 text-white font-bold py-3 rounded-lg text-sm transition-colors ${editingId ? 'bg-indigo-600' : 'bg-[#9E217B]'}`}>
            {publishing ? "Saving..." : editingId ? "Save Changes" : "Publish to Megaphone"}
          </button>
        </div>
      </form>

      <div className="mt-8 space-y-3">
        <h4 className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Past Updates</h4>
        {updates.length === 0 && <p className="text-xs text-gray-500">No updates found.</p>}
        {updates.map((u: any) => (
          <div key={u.id} className="flex items-start justify-between bg-[#1a1a1a] p-4 rounded-xl border border-[#333] hover:border-[#444] transition-colors">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[10px] font-bold">v{u.version}</span>
                <span className="text-sm font-bold text-white">{u.title}</span>
              </div>
              <p className="text-xs text-gray-500 line-clamp-1 mt-1">{u.description}</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <button onClick={() => handleEdit(u)} className="p-2 bg-gray-800 hover:bg-indigo-600 rounded-lg text-gray-400 hover:text-white transition-colors" title="Edit Update">
                <FaEdit />
              </button>
              <button onClick={() => handleDelete(u.id)} className="p-2 bg-gray-800 hover:bg-red-600 rounded-lg text-gray-400 hover:text-white transition-colors" title="Delete Update">
                <FaTrash />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

