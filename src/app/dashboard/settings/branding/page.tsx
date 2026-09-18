"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Field, PageHeader, T, api, useToast } from "@/components/Settings/ui";

const DEFAULT_PRIMARY = "#18392B";
const DEFAULT_SECONDARY = "#C5A059";
const DEFAULT_TEXT = "#1F2937";

export default function BrandingPage() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Tab ──
  const [tab, setTab] = useState<"logo" | "theme">("logo");

  // ── Logo state ──
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  // ── Theme state ──
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY);
  const [textColor, setTextColor] = useState(DEFAULT_TEXT);
  const [themeLoading, setThemeLoading] = useState(true);
  const [themeSaving, setThemeSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api<{ logo: string | null; hasLogo: boolean }>("/api/settings/org-logo"),
      api<{ primaryColor: string; secondaryColor: string; textColor: string }>("/api/settings/org-theme"),
    ])
      .then(([logoData, themeData]) => {
        setCurrentLogo(logoData.logo);
        setHasLogo(logoData.hasLogo);
        setPrimaryColor(themeData.primaryColor);
        setSecondaryColor(themeData.secondaryColor);
        setTextColor(themeData.textColor);
      })
      .catch((err) => toast("error", err.message))
      .finally(() => {
        setLoading(false);
        setThemeLoading(false);
      });
  }, [toast]);

  useEffect(load, [load]);

  // ── Logo handlers ──
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast("error", "Please select an image file.");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast("error", "File must be under 2 MB.");
      return;
    }
    setFile(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/org-logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Upload failed");
      setCurrentLogo(data.logo);
      setHasLogo(true);
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      toast("success", "Logo saved.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    setRemoving(true);
    try {
      await api("/api/settings/org-logo", { method: "DELETE" });
      setCurrentLogo(null);
      setHasLogo(false);
      toast("success", "Logo removed.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setRemoving(false);
    }
  }

  // ── Theme handlers ──
  async function saveTheme() {
    setThemeSaving(true);
    try {
      await api("/api/settings/org-theme", {
        method: "PATCH",
        json: { primaryColor, secondaryColor, textColor },
      });
      toast("success", "Theme saved.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setThemeSaving(false);
    }
  }

  async function resetTheme() {
    setPrimaryColor(DEFAULT_PRIMARY);
    setSecondaryColor(DEFAULT_SECONDARY);
    setTextColor(DEFAULT_TEXT);
    setThemeSaving(true);
    try {
      await api("/api/settings/org-theme", {
        method: "PATCH",
        json: {
          primaryColor: DEFAULT_PRIMARY,
          secondaryColor: DEFAULT_SECONDARY,
          textColor: DEFAULT_TEXT,
        },
      });
      toast("success", "Theme reset to defaults.");
    } catch (err: any) {
      toast("error", err.message);
    } finally {
      setThemeSaving(false);
    }
  }

  const displayed = preview ?? currentLogo;

  return (
    <>
      <PageHeader
        title="Branding & Logo"
        subtitle="Customize your organization's visual identity on the Client Enquiry Form."
      />

      {/* Segmented control tab bar */}
      <div className="mb-6 flex gap-1 rounded-[12px] p-1" style={{ background: T.neutralSoft }}>
        {([["logo", "Logo"], ["theme", "Enquiry Form Theme"]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex-1 rounded-[10px] px-4 py-2 text-[13px] font-medium tracking-tight transition-all duration-200 cursor-pointer"
            style={{
              color: tab === id ? T.text : T.muted,
              background: tab === id ? T.surface : "transparent",
              boxShadow: tab === id ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Logo tab ── */}
      {tab === "logo" && (
        <Card
          title="Organization Logo"
          footer={
            <>
              {hasLogo && !preview && (
                <Button variant="danger" onClick={removeLogo} loading={removing}>
                  Remove Logo
                </Button>
              )}
              <Button onClick={upload} loading={uploading} disabled={!file}>
                Save Changes
              </Button>
            </>
          }
        >
          <div
            className="mb-5 flex items-center justify-center rounded-[14px] border"
            style={{
              width: 240,
              height: 96,
              borderColor: T.border,
              background: T.surfaceAlt,
            }}
          >
            {displayed ? (
              <img
                src={displayed}
                alt="Organization logo"
                style={{ maxWidth: 220, maxHeight: 80, objectFit: "contain" }}
              />
            ) : loading ? (
              <span className="crm-secondary" style={{ color: T.muted }}>
                Loading\u2026
              </span>
            ) : (
              <span className="crm-secondary" style={{ color: T.muted }}>
                No logo uploaded
              </span>
            )}
          </div>

          <Field
            label="Upload New Logo"
            hint="PNG or WebP with transparency recommended. Max 2 MB."
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              className="block w-full crm-body"
              style={{ color: T.text }}
            />
            {file && (
              <p className="mt-1 crm-caption" style={{ color: T.muted, fontWeight: 400 }}>
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </Field>

          {uploading && (
            <p className="mt-3 animate-pulse crm-body" style={{ color: T.teal }}>
              Uploading…
            </p>
          )}
        </Card>
      )}

      {/* ── Theme tab ── */}
      {tab === "theme" && (
        <Card
          title="Enquiry Form Colors"
          footer={
            <>
              <Button variant="secondary" onClick={resetTheme} loading={themeSaving} disabled={themeSaving}>
                Reset to Defaults
              </Button>
              <Button onClick={saveTheme} loading={themeSaving} disabled={themeSaving}>
                Save Changes
              </Button>
            </>
          }
        >
          {themeLoading ? (
            <p className="crm-body" style={{ color: T.muted }}>
              Loading…
            </p>
          ) : (
            <>
              {/* Color rows */}
              <div className="space-y-0">
                {[
                  {
                    label: "Primary Color",
                    desc: "Section header backgrounds and selected button fill.",
                    value: primaryColor,
                    set: setPrimaryColor,
                  },
                  {
                    label: "Secondary Color",
                    desc: "Accent text, icons, focus rings, and selected button ring.",
                    value: secondaryColor,
                    set: setSecondaryColor,
                  },
                  {
                    label: "Text Color",
                    desc: "Form title and main heading color.",
                    value: textColor,
                    set: setTextColor,
                  },
                ].map(({ label, desc, value, set }) => (
                  <div
                    key={label}
                    className="flex items-center gap-4 py-4 border-b last:border-b-0"
                    style={{ borderColor: T.border }}
                  >
                    <input
                      type="color"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="flex-shrink-0 cursor-pointer rounded-[10px] border p-0.5"
                      style={{
                        width: 44,
                        height: 44,
                        borderColor: T.border,
                        background: "none",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="crm-body font-semibold" style={{ color: T.text }}>
                        {label}
                      </div>
                      <div className="crm-caption mt-0.5" style={{ color: T.muted, fontWeight: 400 }}>{desc}</div>
                    </div>
                    <input
                      type="text"
                      value={value}
                      maxLength={7}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) set(v);
                      }}
                      className="rounded-[8px] border px-2.5 py-1.5 text-[13px] font-mono tracking-tight st-input"
                      style={{
                        width: 88,
                        borderColor: T.border,
                        color: T.text,
                        background: T.surfaceAlt,
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Live preview */}
              <div className="mt-6">
                <p className="crm-eyebrow mb-3" style={{ color: T.muted }}>
                  Live Preview
                </p>
                <div
                  className="overflow-hidden rounded-[16px] border"
                  style={{
                    borderColor: T.border,
                    background: "#fff",
                    maxWidth: 480,
                  }}
                >
                  <div className="px-6 py-5" style={{ background: "#fff" }}>
                    <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: "0.03em", color: textColor }}>
                      Client Enquiry Form
                    </div>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", marginTop: 4, fontWeight: 600, color: secondaryColor }}>
                      Let&#39;s find your perfect home
                    </div>
                  </div>
                  <div style={{ background: primaryColor, padding: "10px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={secondaryColor}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                    <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      1. Personal Details
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="rounded-[10px] border px-3.5 py-2.5 text-sm" style={{ background: "#f9fafb", borderColor: "#e5e7eb", color: "#6b7280" }}>
                      Full name\u2026
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
