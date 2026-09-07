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

  // Tab button style helper
  function tabStyle(active: boolean) {
    return {
      padding: "8px 20px",
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      borderTop: "none",
      borderLeft: "none",
      borderRight: "none",
      borderBottomStyle: "solid" as const,
      borderBottomWidth: 2,
      borderBottomColor: active ? T.teal : "transparent",
      color: active ? T.teal : T.muted,
      background: "none",
      cursor: "pointer",
      transition: "color 0.15s, border-bottom-color 0.15s",
    };
  }

  return (
    <>
      <PageHeader
        title="Branding & Logo"
        subtitle="Customize your organization's visual identity on the Client Enquiry Form."
      />

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: `1px solid ${T.border}`,
          marginBottom: 24,
        }}
      >
        <button style={tabStyle(tab === "logo")} onClick={() => setTab("logo")}>
          Logo
        </button>
        <button style={tabStyle(tab === "theme")} onClick={() => setTab("theme")}>
          Enquiry Form Theme
        </button>
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
            className="mb-5 flex items-center justify-center rounded-lg border"
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
              <span className="text-sm" style={{ color: T.muted }}>
                Loading…
              </span>
            ) : (
              <span className="text-sm" style={{ color: T.muted }}>
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
              className="block w-full text-sm"
              style={{ color: T.text }}
            />
            {file && (
              <p className="mt-1 text-xs" style={{ color: T.muted }}>
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </Field>

          {uploading && (
            <p className="mt-3 animate-pulse text-sm" style={{ color: T.teal }}>
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
            <p className="text-sm" style={{ color: T.muted }}>
              Loading…
            </p>
          ) : (
            <>
              {/* Color rows */}
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
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 20,
                    paddingBottom: 20,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 8,
                      border: `1px solid ${T.border}`,
                      cursor: "pointer",
                      padding: 2,
                      background: "none",
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 12, color: T.muted }}>{desc}</div>
                  </div>
                  <input
                    type="text"
                    value={value}
                    maxLength={7}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(v)) set(v);
                    }}
                    style={{
                      width: 90,
                      padding: "6px 10px",
                      fontSize: 13,
                      fontFamily: "monospace",
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                      color: T.text,
                      background: T.surfaceAlt,
                    }}
                  />
                </div>
              ))}

              {/* Live preview */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Live Preview
                </div>
                <div
                  style={{
                    border: `1px solid ${T.border}`,
                    borderRadius: 16,
                    overflow: "hidden",
                    background: "#fff",
                    maxWidth: 480,
                  }}
                >
                  {/* Form header preview */}
                  <div style={{ padding: "20px 24px", background: "#fff" }}>
                    <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: "0.03em", color: textColor }}>
                      Client Enquiry Form
                    </div>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", marginTop: 4, fontWeight: 600, color: secondaryColor }}>
                      Let's find your perfect home
                    </div>
                  </div>
                  {/* Section header preview */}
                  <div style={{ background: primaryColor, padding: "10px 20px", display: "flex", alignItems: "center", gap: 10 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={secondaryColor}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                    </svg>
                    <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      1. Personal Details
                    </span>
                  </div>
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px", fontSize: 14, color: "#6b7280" }}>
                      Full name…
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
