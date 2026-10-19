"use client";

// Creative Studio — AI Image Generation & Real Estate Marketing
//
// Three modes:
//   A) Generate: text-to-image from a prompt
//   B) Combine:  edit/merge reference images with AI
//   C) Banner:   real estate campaign banner builder with text overlay
//
// Generated images are stored in Cloudflare R2. The banner composer uses
// client-side Canvas for text overlay so text is always crisp and correct.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaImage, FaLayerGroup, FaFlag, FaMagic, FaDownload, FaSave,
  FaTrash, FaPlus, FaTimes, FaExpand, FaRedo, FaChevronDown,
  FaSpinner, FaInfoCircle, FaCloudUploadAlt, FaPalette, FaHistory,
} from "react-icons/fa";
import { BANNER_TEMPLATES, TEMPLATE_MAP, EXPORT_PRESETS, type BannerTemplate } from "@/lib/creative-studio/templates";
import { SIZES, QUALITY_OPTIONS, type ImageSize, type ImageQuality } from "@/lib/creative-studio/imageApi";

// ── Types ────────────────────────────────────────────────────────────────────

type StudioMode = "generate" | "combine" | "banner";

interface GeneratedImage {
  url: string;
  r2Key: string;
  revisedPrompt?: string;
  size: string;
  prompt: string;
  mode: StudioMode;
  templateId?: string;
  savedId?: number;
}

interface GalleryImage {
  id: number;
  url: string;
  r2Key: string;
  prompt: string;
  mode: string;
  templateId: string | null;
  size: string;
  createdAt: string;
  createdBy: string;
}

// ── Design tokens (follows CRM pattern) ──────────────────────────────────────

const T = {
  surface: "var(--st-surface, #ffffff)",
  surfaceRaised: "var(--st-surface-raised, #f8fafc)",
  text: "var(--st-text, #1A1A1A)",
  muted: "var(--st-text-muted, #6B7280)",
  border: "var(--st-border, #e5e7eb)",
  teal: "var(--st-accent, #0D9488)",
  accentSoft: "var(--st-accent-soft, #ECFDF5)",
  danger: "#EF4444",
  purple: "#9E217B",
  purpleSoft: "rgba(158,33,123,0.08)",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/creative-studio${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CreativeStudioPanel() {
  // Mode
  const [mode, setMode] = useState<StudioMode>("generate");
  const [showGallery, setShowGallery] = useState(false);

  // Generation state
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<ImageSize>("1536x1024");
  const [quality, setQuality] = useState<ImageQuality>("auto");
  const [numImages, setNumImages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [selectedResult, setSelectedResult] = useState<GeneratedImage | null>(null);

  // Combine mode
  const [refImages, setRefImages] = useState<string[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Banner mode
  const [templateId, setTemplateId] = useState("2bhk");
  const [bannerValues, setBannerValues] = useState<Record<string, string>>({});
  const [bannerBg, setBannerBg] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Gallery
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Fullscreen preview
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const template = TEMPLATE_MAP.get(templateId) || BANNER_TEMPLATES[0];

  // ── Gallery fetch ──────────────────────────────────────────────────────────
  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const data = await api<{ images: GalleryImage[] }>("/gallery");
      setGallery(data.images || []);
    } catch {
      // Gallery table may not exist
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showGallery) loadGallery();
  }, [showGallery, loadGallery]);

  // ── Generate / Edit ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const body: any = {
        prompt: prompt.trim(),
        size,
        quality,
        n: numImages,
        mode: mode === "combine" ? "edit" : "generate",
      };
      if (mode === "combine" && refImages.length > 0) {
        body.referenceImages = refImages;
      }
      const data = await api<{ images: any[] }>("/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const newResults: GeneratedImage[] = (data.images || []).map((img: any) => ({
        url: img.url,
        r2Key: img.r2Key,
        revisedPrompt: img.revisedPrompt,
        size: img.size,
        prompt: prompt.trim(),
        mode,
      }));
      setResults((prev) => [...newResults, ...prev]);
      if (newResults.length > 0) setSelectedResult(newResults[0]);
    } catch (err: any) {
      setError(err.message || "Generation failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── Banner generate ────────────────────────────────────────────────────────
  const handleBannerGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const bgPrompt = template.buildPrompt(bannerValues);
      const data = await api<{ images: any[] }>("/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: bgPrompt,
          size: template.defaultSize,
          quality: "high",
          n: 1,
          mode: "generate",
        }),
      });
      if (data.images?.[0]?.url) {
        setBannerBg(data.images[0].url);
        // Also store as a result
        setResults((prev) => [
          {
            url: data.images[0].url,
            r2Key: data.images[0].r2Key,
            revisedPrompt: data.images[0].revisedPrompt,
            size: template.defaultSize,
            prompt: bgPrompt,
            mode: "banner",
            templateId,
          },
          ...prev,
        ]);
      }
    } catch (err: any) {
      setError(err.message || "Banner generation failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── Prompt enhancement ─────────────────────────────────────────────────────
  const handleEnhance = async () => {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try {
      const data = await api<{ enhanced: string }>("/enhance", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      if (data.enhanced) setPrompt(data.enhanced);
    } catch {
      // silent — keep original
    } finally {
      setEnhancing(false);
    }
  };

  // ── Reference image upload ─────────────────────────────────────────────────
  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (refImages.length + files.length > 4) {
      setError("Maximum 4 reference images.");
      return;
    }
    try {
      const b64s = await Promise.all(files.map(fileToBase64));
      setRefImages((prev) => [...prev, ...b64s]);
    } catch {
      setError("Failed to read image files.");
    }
    if (refInputRef.current) refInputRef.current.value = "";
  };

  // ── Logo upload ────────────────────────────────────────────────────────────
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLogoDataUrl(await fileToBase64(file));
    } catch {
      setError("Failed to read logo.");
    }
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  // ── Save to gallery ────────────────────────────────────────────────────────
  const handleSave = async (img: GeneratedImage) => {
    if (img.savedId) return;
    setSaving(true);
    try {
      const data = await api<{ id: number }>("/gallery", {
        method: "POST",
        body: JSON.stringify({
          r2Key: img.r2Key,
          prompt: img.prompt,
          mode: img.mode,
          templateId: img.templateId,
          size: img.size,
        }),
      });
      img.savedId = data.id;
      setResults([...results]);
    } catch (err: any) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete from gallery ────────────────────────────────────────────────────
  const handleGalleryDelete = async (id: number) => {
    try {
      await api("/gallery", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setGallery((prev) => prev.filter((g) => g.id !== id));
    } catch (err: any) {
      setError(err.message || "Delete failed.");
    }
  };

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = (url: string, name?: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || `bhoomi-creative-${Date.now()}.png`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ── Banner Canvas Composition ──────────────────────────────────────────────
  const composeBanner = useCallback(
    (exportPresetId?: string) => {
      if (!bannerBg || !canvasRef.current) return null;

      const preset = EXPORT_PRESETS.find((p) => p.id === exportPresetId) || { width: 1536, height: 1024 };
      const canvas = canvasRef.current;
      canvas.width = preset.width;
      canvas.height = preset.height;
      const ctx = canvas.getContext("2d")!;

      // Draw background
      const bgImg = new Image();
      bgImg.crossOrigin = "anonymous";
      bgImg.src = bannerBg;

      return new Promise<string>((resolve) => {
        bgImg.onload = () => {
          // Cover-fit the background
          const scale = Math.max(canvas.width / bgImg.width, canvas.height / bgImg.height);
          const w = bgImg.width * scale;
          const h = bgImg.height * scale;
          ctx.drawImage(bgImg, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);

          // Semi-transparent overlay for text readability
          const grad = ctx.createLinearGradient(canvas.width * 0.4, 0, canvas.width, 0);
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(0.3, "rgba(0,0,0,0.55)");
          grad.addColorStop(1, "rgba(0,0,0,0.75)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Also a bottom gradient for disclaimers
          const botGrad = ctx.createLinearGradient(0, canvas.height * 0.8, 0, canvas.height);
          botGrad.addColorStop(0, "rgba(0,0,0,0)");
          botGrad.addColorStop(1, "rgba(0,0,0,0.6)");
          ctx.fillStyle = botGrad;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const brandColor = bannerValues.brandColor || "#9E217B";
          const rightX = canvas.width * 0.52;
          const maxW = canvas.width * 0.44;
          let y = canvas.height * 0.12;

          // Project name (small eyebrow)
          if (bannerValues.projectName) {
            ctx.font = `bold ${Math.round(canvas.height * 0.028)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = brandColor;
            ctx.textAlign = "left";
            ctx.letterSpacing = "2px";
            ctx.fillText(bannerValues.projectName.toUpperCase(), rightX, y);
            y += canvas.height * 0.06;
          }

          // Headline
          const headlineText = bannerValues.headline || bannerValues.projectName || "";
          if (headlineText) {
            ctx.font = `800 ${Math.round(canvas.height * 0.065)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "#FFFFFF";
            ctx.textAlign = "left";
            // Word-wrap
            const words = headlineText.split(" ");
            let line = "";
            for (const word of words) {
              const test = line ? `${line} ${word}` : word;
              if (ctx.measureText(test).width > maxW && line) {
                ctx.fillText(line, rightX, y);
                y += canvas.height * 0.08;
                line = word;
              } else {
                line = test;
              }
            }
            if (line) {
              ctx.fillText(line, rightX, y);
              y += canvas.height * 0.08;
            }
          }

          // Subheadline
          if (bannerValues.subheadline) {
            y += canvas.height * 0.01;
            ctx.font = `400 ${Math.round(canvas.height * 0.032)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.fillText(bannerValues.subheadline, rightX, y);
            y += canvas.height * 0.07;
          }

          // Price
          if (bannerValues.price) {
            ctx.font = `700 ${Math.round(canvas.height * 0.045)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = brandColor;
            ctx.fillText(bannerValues.price, rightX, y);
            y += canvas.height * 0.07;
          }

          // Location
          if (bannerValues.location) {
            ctx.font = `500 ${Math.round(canvas.height * 0.028)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillText(`📍 ${bannerValues.location}`, rightX, y);
            y += canvas.height * 0.05;
          }

          // Amenities (compact)
          if (bannerValues.amenities) {
            const amens = bannerValues.amenities.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 4);
            ctx.font = `400 ${Math.round(canvas.height * 0.024)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillText(amens.join("  •  "), rightX, y);
            y += canvas.height * 0.05;
          }

          // CTA button
          const ctaText = bannerValues.cta || "Book Your Site Visit";
          if (ctaText) {
            y += canvas.height * 0.01;
            const btnH = canvas.height * 0.055;
            const btnFont = Math.round(canvas.height * 0.026);
            ctx.font = `700 ${btnFont}px "Inter", "Segoe UI", system-ui, sans-serif`;
            const btnW = ctx.measureText(ctaText).width + 60;
            // Button background
            ctx.fillStyle = brandColor;
            const btnR = btnH / 2;
            ctx.beginPath();
            ctx.roundRect(rightX, y - btnH * 0.7, btnW, btnH, btnR);
            ctx.fill();
            // Button text
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(ctaText, rightX + 30, y - btnH * 0.7 + btnH * 0.65);
            y += canvas.height * 0.08;
          }

          // Contact
          if (bannerValues.contact) {
            ctx.font = `600 ${Math.round(canvas.height * 0.026)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(`📞 ${bannerValues.contact}`, rightX, y);
            y += canvas.height * 0.04;
          }

          // Website
          if (bannerValues.website) {
            ctx.font = `400 ${Math.round(canvas.height * 0.022)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillText(`🌐 ${bannerValues.website}`, rightX, y);
          }

          // RERA / Disclaimer at bottom
          if (bannerValues.rera) {
            ctx.font = `300 ${Math.round(canvas.height * 0.016)}px "Inter", "Segoe UI", system-ui, sans-serif`;
            ctx.fillStyle = "rgba(255,255,255,0.5)";
            ctx.textAlign = "center";
            ctx.fillText(bannerValues.rera, canvas.width / 2, canvas.height - canvas.height * 0.03);
            ctx.textAlign = "left";
          }

          // Logo (top-right corner if provided)
          if (logoDataUrl) {
            const logoImg = new Image();
            logoImg.onload = () => {
              const logoH = canvas.height * 0.08;
              const logoW = (logoImg.width / logoImg.height) * logoH;
              ctx.drawImage(logoImg, canvas.width - logoW - 30, 20, logoW, logoH);
              resolve(canvas.toDataURL("image/png"));
            };
            logoImg.onerror = () => resolve(canvas.toDataURL("image/png"));
            logoImg.src = logoDataUrl;
          } else {
            resolve(canvas.toDataURL("image/png"));
          }
        };
        bgImg.onerror = () => resolve("");
      });
    },
    [bannerBg, bannerValues, logoDataUrl]
  );

  const handleBannerExport = async (presetId: string) => {
    const dataUrl = await composeBanner(presetId);
    if (dataUrl) {
      handleDownload(dataUrl, `banner-${templateId}-${presetId}-${Date.now()}.png`);
    }
  };

  // ── Mode tabs ──────────────────────────────────────────────────────────────
  const modes: { id: StudioMode; label: string; icon: typeof FaImage; desc: string }[] = [
    { id: "generate", label: "Generate", icon: FaImage, desc: "Create from a prompt" },
    { id: "combine", label: "Combine & Edit", icon: FaLayerGroup, desc: "Edit with reference images" },
    { id: "banner", label: "Banner Builder", icon: FaFlag, desc: "Campaign banners" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: T.text }}
          >
            Bhoomi AI Creative Studio
          </h1>
          <p className="text-sm mt-0.5" style={{ color: T.muted }}>
            Generate professional real estate marketing visuals with AI
          </p>
        </div>
        <button
          onClick={() => setShowGallery(!showGallery)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
          style={{
            borderColor: T.border,
            color: showGallery ? T.purple : T.text,
            background: showGallery ? T.purpleSoft : "transparent",
          }}
        >
          <FaHistory className="w-3.5 h-3.5" />
          {showGallery ? "Back to Studio" : "Saved Gallery"}
        </button>
      </div>

      {/* ── Gallery view ──────────────────────────────────────────────── */}
      {showGallery ? (
        <GalleryView
          gallery={gallery}
          loading={galleryLoading}
          onDelete={handleGalleryDelete}
          onDownload={handleDownload}
          onFullscreen={setFullscreen}
        />
      ) : (
        <>
          {/* ── Mode selector ─────────────────────────────────────────── */}
          <div className="flex gap-2 flex-wrap">
            {modes.map((m) => {
              const active = mode === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => { setMode(m.id); setError(null); }}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all"
                  style={{
                    borderColor: active ? T.purple : T.border,
                    background: active ? T.purpleSoft : "transparent",
                    color: active ? T.purple : T.text,
                    boxShadow: active ? `inset 0 0 0 1px ${T.purple}` : "none",
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{m.label}</span>
                  <span className="hidden sm:inline text-xs opacity-60">— {m.desc}</span>
                </button>
              );
            })}
          </div>

          {/* ── Error banner ──────────────────────────────────────────── */}
          {error && (
            <div
              className="flex items-start gap-2 p-3 rounded-xl text-sm border"
              style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)", color: T.danger }}
            >
              <FaInfoCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto"><FaTimes /></button>
            </div>
          )}

          {/* ── Workspace ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-6">
            {/* Left: Preview area */}
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ borderColor: T.border, background: T.surfaceRaised, minHeight: 400 }}
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center h-96 gap-3">
                  <FaSpinner className="w-8 h-8 animate-spin" style={{ color: T.purple }} />
                  <p className="text-sm font-medium" style={{ color: T.muted }}>
                    {mode === "banner" ? "Generating banner background..." : "Generating your image..."}
                  </p>
                  <p className="text-xs" style={{ color: T.muted }}>This may take up to 2 minutes</p>
                </div>
              ) : selectedResult ? (
                <div className="relative group">
                  <img
                    src={selectedResult.url}
                    alt="Generated"
                    className="w-full h-auto max-h-[600px] object-contain cursor-pointer"
                    onClick={() => setFullscreen(selectedResult.url)}
                  />
                  {/* Action bar */}
                  <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between p-3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex gap-2">
                      <ActionBtn icon={FaExpand} label="Fullscreen" onClick={() => setFullscreen(selectedResult.url)} />
                      <ActionBtn icon={FaDownload} label="Download" onClick={() => handleDownload(selectedResult.url)} />
                      <ActionBtn icon={FaSave} label={selectedResult.savedId ? "Saved" : "Save"} onClick={() => handleSave(selectedResult)} disabled={!!selectedResult.savedId || saving} />
                    </div>
                    <ActionBtn icon={FaRedo} label="Regenerate" onClick={mode === "banner" ? handleBannerGenerate : handleGenerate} />
                  </div>
                  {selectedResult.revisedPrompt && (
                    <details className="p-3 text-xs" style={{ color: T.muted }}>
                      <summary className="cursor-pointer font-medium">Revised prompt</summary>
                      <p className="mt-1 leading-relaxed">{selectedResult.revisedPrompt}</p>
                    </details>
                  )}
                </div>
              ) : mode === "banner" && bannerBg ? (
                <div className="relative group">
                  <BannerPreview
                    bgUrl={bannerBg}
                    values={bannerValues}
                    logoUrl={logoDataUrl}
                    brandColor={bannerValues.brandColor || "#9E217B"}
                  />
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-white/70 mr-2">Export as:</span>
                      {EXPORT_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleBannerExport(p.id)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/20 text-white hover:bg-white/30 transition-colors"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState mode={mode} />
              )}
            </div>

            {/* Right: Controls panel */}
            <div className="space-y-4">
              {mode === "banner" ? (
                <BannerControls
                  template={template}
                  templateId={templateId}
                  setTemplateId={setTemplateId}
                  values={bannerValues}
                  setValues={setBannerValues}
                  logoUrl={logoDataUrl}
                  onLogoUpload={() => logoInputRef.current?.click()}
                  onRemoveLogo={() => setLogoDataUrl(null)}
                  onGenerate={handleBannerGenerate}
                  loading={loading}
                />
              ) : (
                <>
                  {/* Prompt editor */}
                  <Panel title="Prompt">
                    <div className="relative">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={
                          mode === "generate"
                            ? "Describe the image you want to create...\n\ne.g. A luxury 2BHK apartment interior with modern furniture, warm lighting, and city view from a large window"
                            : "Describe how to combine or edit the reference images...\n\ne.g. Merge the building exterior with the garden landscape to create a cohesive property view"
                        }
                        rows={5}
                        className="w-full rounded-xl border p-3 text-sm resize-none focus:outline-none focus:ring-2"
                        style={{
                          borderColor: T.border,
                          background: T.surface,
                          color: T.text,
                          // @ts-ignore
                          "--tw-ring-color": T.purple,
                        }}
                        maxLength={4000}
                      />
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs" style={{ color: T.muted }}>
                          {prompt.length}/4000
                        </span>
                        <button
                          onClick={handleEnhance}
                          disabled={!prompt.trim() || enhancing}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                          style={{ background: T.purpleSoft, color: T.purple }}
                        >
                          {enhancing ? <FaSpinner className="w-3 h-3 animate-spin" /> : <FaMagic className="w-3 h-3" />}
                          Enhance with AI
                        </button>
                      </div>
                    </div>
                  </Panel>

                  {/* Reference images (combine mode) */}
                  {mode === "combine" && (
                    <Panel title="Reference Images">
                      <div className="grid grid-cols-2 gap-2">
                        {refImages.map((img, i) => (
                          <div key={i} className="relative rounded-lg overflow-hidden border" style={{ borderColor: T.border }}>
                            <img src={img} alt={`Ref ${i + 1}`} className="w-full h-24 object-cover" />
                            <button
                              onClick={() => setRefImages((prev) => prev.filter((_, j) => j !== i))}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-xs"
                            >
                              <FaTimes />
                            </button>
                          </div>
                        ))}
                        {refImages.length < 4 && (
                          <button
                            onClick={() => refInputRef.current?.click()}
                            className="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed transition-colors"
                            style={{ borderColor: T.border, color: T.muted }}
                          >
                            <FaCloudUploadAlt className="w-5 h-5 mb-1" />
                            <span className="text-xs">Add Image</span>
                          </button>
                        )}
                      </div>
                      <input
                        ref={refInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleRefUpload}
                      />
                      <p className="text-xs mt-2" style={{ color: T.muted }}>
                        Upload up to 4 reference images. AI will combine them based on your prompt.
                      </p>
                    </Panel>
                  )}

                  {/* Settings */}
                  <Panel title="Settings">
                    <div className="space-y-3">
                      <SettingRow label="Size">
                        <select
                          value={size}
                          onChange={(e) => setSize(e.target.value as ImageSize)}
                          className="w-full rounded-lg border p-2 text-sm"
                          style={{ borderColor: T.border, background: T.surface, color: T.text }}
                        >
                          {Object.entries(SIZES).map(([k, v]) => (
                            <option key={k} value={k}>{v} ({k})</option>
                          ))}
                        </select>
                      </SettingRow>
                      <SettingRow label="Quality">
                        <div className="flex gap-1.5">
                          {QUALITY_OPTIONS.map((q) => (
                            <button
                              key={q}
                              onClick={() => setQuality(q)}
                              className="flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize"
                              style={{
                                borderColor: quality === q ? T.purple : T.border,
                                background: quality === q ? T.purpleSoft : "transparent",
                                color: quality === q ? T.purple : T.text,
                              }}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </SettingRow>
                      {mode === "generate" && (
                        <SettingRow label="Variations">
                          <div className="flex items-center gap-2">
                            {[1, 2, 3, 4].map((n) => (
                              <button
                                key={n}
                                onClick={() => setNumImages(n)}
                                className="w-9 h-9 rounded-lg text-sm font-medium border transition-colors"
                                style={{
                                  borderColor: numImages === n ? T.purple : T.border,
                                  background: numImages === n ? T.purpleSoft : "transparent",
                                  color: numImages === n ? T.purple : T.text,
                                }}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </SettingRow>
                      )}
                    </div>
                  </Panel>

                  {/* Generate button */}
                  <button
                    onClick={handleGenerate}
                    disabled={loading || !prompt.trim() || (mode === "combine" && refImages.length === 0)}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                    style={{ background: `linear-gradient(135deg, ${T.purple}, #00AEEF)` }}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <FaSpinner className="animate-spin" /> Generating...
                      </span>
                    ) : mode === "combine" ? (
                      "Combine & Generate"
                    ) : (
                      "Generate Image"
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── Results strip ─────────────────────────────────────────── */}
          {results.length > 0 && (
            <Panel title={`Generated Images (${results.length})`}>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {results.map((img, i) => (
                  <button
                    key={`${img.r2Key}-${i}`}
                    onClick={() => { setSelectedResult(img); setShowGallery(false); }}
                    className="flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all"
                    style={{
                      borderColor: selectedResult === img ? T.purple : T.border,
                      width: 80,
                      height: 80,
                    }}
                  >
                    <img src={img.url} alt={`Result ${i + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {/* ── Fullscreen modal ──────────────────────────────────────────── */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setFullscreen(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            onClick={() => setFullscreen(null)}
          >
            <FaTimes className="w-6 h-6" />
          </button>
          <img
            src={fullscreen}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Hidden elements */}
      <canvas ref={canvasRef} className="hidden" />
      <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: T.border, background: T.surface }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: T.muted }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: T.text }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled }: { icon: any; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/20 text-white hover:bg-white/30 transition-colors backdrop-blur-sm disabled:opacity-40"
      title={label}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

function EmptyState({ mode }: { mode: StudioMode }) {
  const content = {
    generate: {
      icon: FaImage,
      title: "Generate AI Images",
      desc: "Describe your vision and let AI create professional real estate visuals. Use the Enhance button to improve your prompts automatically.",
    },
    combine: {
      icon: FaLayerGroup,
      title: "Combine & Edit Images",
      desc: "Upload reference images and describe how to combine them. Perfect for merging building photos with landscapes or replacing backgrounds.",
    },
    banner: {
      icon: FaFlag,
      title: "Campaign Banner Builder",
      desc: "Select a template, enter your project details, and generate a professional marketing banner with AI backgrounds and crisp text overlay.",
    },
  }[mode];
  const Icon = content.icon;
  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4 px-8 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: T.purpleSoft }}
      >
        <Icon className="w-7 h-7" style={{ color: T.purple }} />
      </div>
      <h3 className="text-base font-semibold" style={{ color: T.text }}>{content.title}</h3>
      <p className="text-sm max-w-md leading-relaxed" style={{ color: T.muted }}>{content.desc}</p>
    </div>
  );
}

// ── Banner Controls ──────────────────────────────────────────────────────────

function BannerControls({
  template,
  templateId,
  setTemplateId,
  values,
  setValues,
  logoUrl,
  onLogoUpload,
  onRemoveLogo,
  onGenerate,
  loading,
}: {
  template: BannerTemplate;
  templateId: string;
  setTemplateId: (id: string) => void;
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  logoUrl: string | null;
  onLogoUpload: () => void;
  onRemoveLogo: () => void;
  onGenerate: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Template selector */}
      <Panel title="Campaign Template">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-full rounded-lg border p-2 text-sm"
          style={{ borderColor: T.border, background: T.surface, color: T.text }}
        >
          {BANNER_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.description}
            </option>
          ))}
        </select>
      </Panel>

      {/* Campaign fields */}
      <Panel title="Campaign Details">
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
          {template.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium mb-1" style={{ color: T.text }}>
                {field.label}
                {field.required && <span style={{ color: T.danger }}> *</span>}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  value={values[field.key] || ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  rows={2}
                  className="w-full rounded-lg border p-2 text-sm resize-none"
                  style={{ borderColor: T.border, background: T.surface, color: T.text }}
                />
              ) : field.type === "color" ? (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={values[field.key] || "#9E217B"}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="w-9 h-9 rounded-lg border cursor-pointer"
                    style={{ borderColor: T.border }}
                  />
                  <input
                    type="text"
                    value={values[field.key] || "#9E217B"}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="flex-1 rounded-lg border p-2 text-sm"
                    style={{ borderColor: T.border, background: T.surface, color: T.text }}
                    placeholder="#9E217B"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={values[field.key] || ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border p-2 text-sm"
                  style={{ borderColor: T.border, background: T.surface, color: T.text }}
                />
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* Logo upload */}
      <Panel title="Logo">
        {logoUrl ? (
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Logo" className="h-10 rounded" />
            <button
              onClick={onRemoveLogo}
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{ color: T.danger, background: "rgba(239,68,68,0.08)" }}
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={onLogoUpload}
            className="flex items-center gap-2 w-full py-2 rounded-lg border-2 border-dashed text-sm justify-center transition-colors"
            style={{ borderColor: T.border, color: T.muted }}
          >
            <FaCloudUploadAlt className="w-4 h-4" />
            Upload Logo
          </button>
        )}
      </Panel>

      {/* Generate */}
      <button
        onClick={onGenerate}
        disabled={loading || !values.projectName?.trim()}
        className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
        style={{ background: `linear-gradient(135deg, ${T.purple}, #00AEEF)` }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <FaSpinner className="animate-spin" /> Generating Banner...
          </span>
        ) : (
          "Generate Banner Background"
        )}
      </button>

      <p className="text-xs leading-relaxed" style={{ color: T.muted }}>
        AI generates the background visual. Text, logo, and campaign details are composed as a sharp overlay.
        Hover the preview to export in different formats.
      </p>
    </div>
  );
}

// ── Banner Preview (CSS-based for live editing) ──────────────────────────────

function BannerPreview({
  bgUrl,
  values,
  logoUrl,
  brandColor,
}: {
  bgUrl: string;
  values: Record<string, string>;
  logoUrl: string | null;
  brandColor: string;
}) {
  return (
    <div
      className="relative w-full"
      style={{ aspectRatio: "3/2", background: "#111" }}
    >
      <img src={bgUrl} alt="Banner background" className="absolute inset-0 w-full h-full object-cover" />
      {/* Overlay gradient */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to right, transparent 35%, rgba(0,0,0,0.6) 55%, rgba(0,0,0,0.8) 100%)" }}
      />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 30%)" }} />

      {/* Logo */}
      {logoUrl && (
        <img src={logoUrl} alt="Logo" className="absolute top-4 right-4 h-8 sm:h-10 rounded" />
      )}

      {/* Text content */}
      <div className="absolute right-[5%] top-[12%] w-[42%] flex flex-col gap-2 sm:gap-3">
        {values.projectName && (
          <span className="crm-eyebrow text-[10px] sm:text-xs font-bold tracking-[0.2em] uppercase" style={{ color: brandColor }}>
            {values.projectName}
          </span>
        )}
        {(values.headline || values.projectName) && (
          <h2 className="text-white text-lg sm:text-2xl lg:text-3xl font-extrabold leading-tight">
            {values.headline || values.projectName}
          </h2>
        )}
        {values.subheadline && (
          <p className="text-white/80 text-xs sm:text-sm leading-snug">{values.subheadline}</p>
        )}
        {values.price && (
          <p className="text-base sm:text-xl font-bold" style={{ color: brandColor }}>{values.price}</p>
        )}
        {values.location && (
          <p className="text-white/75 text-xs">📍 {values.location}</p>
        )}
        {values.amenities && (
          <p className="text-white/60 text-[10px] sm:text-xs">
            {values.amenities.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 4).join("  •  ")}
          </p>
        )}
        {(values.cta || true) && (
          <span
            className="self-start px-4 py-1.5 sm:py-2 rounded-full text-white text-xs sm:text-sm font-bold mt-1"
            style={{ background: brandColor }}
          >
            {values.cta || "Book Your Site Visit"}
          </span>
        )}
        {values.contact && (
          <p className="text-white text-xs font-medium mt-1">📞 {values.contact}</p>
        )}
        {values.website && (
          <p className="text-white/60 text-[10px]">🌐 {values.website}</p>
        )}
      </div>

      {/* RERA disclaimer */}
      {values.rera && (
        <p className="absolute bottom-2 left-0 right-0 text-center text-white/40 text-[8px] sm:text-[10px] px-4 leading-tight">
          {values.rera}
        </p>
      )}
    </div>
  );
}

// ── Gallery View ─────────────────────────────────────────────────────────────

function GalleryView({
  gallery,
  loading,
  onDelete,
  onDownload,
  onFullscreen,
}: {
  gallery: GalleryImage[];
  loading: boolean;
  onDelete: (id: number) => void;
  onDownload: (url: string, name?: string) => void;
  onFullscreen: (url: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2">
        <FaSpinner className="w-5 h-5 animate-spin" style={{ color: T.purple }} />
        <span className="text-sm" style={{ color: T.muted }}>Loading gallery...</span>
      </div>
    );
  }

  if (gallery.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
        <FaPalette className="w-8 h-8" style={{ color: T.muted }} />
        <p className="text-sm font-medium" style={{ color: T.text }}>No saved images yet</p>
        <p className="text-xs" style={{ color: T.muted }}>
          Generate images and save them to build your gallery
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {gallery.map((img) => (
        <div
          key={img.id}
          className="rounded-xl border overflow-hidden group"
          style={{ borderColor: T.border, background: T.surface }}
        >
          <div className="relative aspect-square cursor-pointer" onClick={() => onFullscreen(img.url)}>
            {img.url ? (
              <img src={img.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: T.surfaceRaised }}>
                <FaImage className="w-8 h-8" style={{ color: T.muted }} />
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white" onClick={(e) => { e.stopPropagation(); onFullscreen(img.url); }}>
                <FaExpand className="w-3.5 h-3.5" />
              </button>
              <button className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white" onClick={(e) => { e.stopPropagation(); onDownload(img.url); }}>
                <FaDownload className="w-3.5 h-3.5" />
              </button>
              <button className="w-8 h-8 rounded-full bg-red-500/60 flex items-center justify-center text-white" onClick={(e) => { e.stopPropagation(); setConfirmDelete(img.id); }}>
                <FaTrash className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="p-2.5">
            <p className="text-xs truncate font-medium" style={{ color: T.text }}>
              {img.prompt || "Untitled"}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: T.muted }}>
              {img.mode} • {img.size} • {new Date(img.createdAt).toLocaleDateString()}
            </p>
          </div>
          {/* Delete confirmation */}
          {confirmDelete === img.id && (
            <div className="p-2 border-t flex items-center justify-between" style={{ borderColor: T.border }}>
              <span className="text-xs" style={{ color: T.danger }}>Delete?</span>
              <div className="flex gap-1.5">
                <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-xs" style={{ color: T.muted }}>
                  Cancel
                </button>
                <button
                  onClick={() => { onDelete(img.id); setConfirmDelete(null); }}
                  className="px-2 py-1 rounded text-xs font-medium text-white"
                  style={{ background: T.danger }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
