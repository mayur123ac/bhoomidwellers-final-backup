// lib/creative-studio/imageApi.ts — OpenAI Image Generation transport.
//
// Same plain-fetch approach used by every other AI surface in this CRM.
// No SDK dependency. Supports generation and editing via the Images API.

const OPENAI_BASE =
  process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") ||
  "https://api.openai.com";

/** Configurable image model. Defaults to gpt-image-1 (widely available). */
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

/** Text model used for prompt enhancement. */
export const TEXT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export function isImageApiConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY || "").trim();
}

function apiKey(): string {
  const k = (process.env.OPENAI_API_KEY || "").trim();
  if (!k) throw new ImageApiError(503, "OPENAI_API_KEY is not configured.");
  return k;
}

export class ImageApiError extends Error {
  readonly status: number;
  readonly userMessage: string;
  constructor(status: number, userMessage: string, detail?: string) {
    super(detail || userMessage);
    this.name = "ImageApiError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

// ── Supported sizes ──────────────────────────────────────────────────────────

export const SIZES = {
  "1024x1024": "Square (1:1)",
  "1536x1024": "Landscape (3:2)",
  "1024x1536": "Portrait (2:3)",
} as const;

export type ImageSize = keyof typeof SIZES;

export const QUALITY_OPTIONS = ["low", "medium", "high", "auto"] as const;
export type ImageQuality = (typeof QUALITY_OPTIONS)[number];

// ── Generate ─────────────────────────────────────────────────────────────────

export interface GenerateRequest {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
}

export interface GeneratedImage {
  b64: string;
  revisedPrompt?: string;
}

/**
 * Generate image(s) from a text prompt.
 * Returns base64-encoded PNG data.
 */
export async function generateImage(
  req: GenerateRequest
): Promise<GeneratedImage[]> {
  const n = Math.min(Math.max(req.n || 1, 1), 4);

  const body: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt: req.prompt,
    n,
    size: req.size || "1024x1024",
    quality: req.quality || "auto",
  };

  const res = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000), // image gen can take up to 2 min
  }).catch((e: any) => {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ImageApiError(504, "Image generation timed out. Try a simpler prompt.");
    }
    throw new ImageApiError(502, "Could not reach the image service.");
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[creative-studio] OpenAI image error", res.status, detail.slice(0, 500));
    if (res.status === 400) {
      // Try to extract a useful message from the error
      try {
        const err = JSON.parse(detail);
        const msg = err?.error?.message || "The request was rejected.";
        throw new ImageApiError(400, msg);
      } catch (e) {
        if (e instanceof ImageApiError) throw e;
      }
      throw new ImageApiError(400, "The image request was rejected. Try rephrasing your prompt.");
    }
    if (res.status === 429) throw new ImageApiError(429, "Rate limited. Wait a moment and try again.");
    throw new ImageApiError(502, "Image generation failed. Try again.");
  }

  const json = await res.json().catch(() => null);
  const data = json?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ImageApiError(502, "No images were returned.");
  }

  return data.map((d: any) => ({
    b64: d.b64_json,
    revisedPrompt: d.revised_prompt || undefined,
  }));
}

// ── Edit / Combine ───────────────────────────────────────────────────────────

export interface EditRequest {
  prompt: string;
  /** Base64-encoded images (PNG/JPEG/WebP). */
  images: string[];
  size?: ImageSize;
  quality?: ImageQuality;
}

/**
 * Edit or combine reference images using a text prompt.
 * Uses the images/edits endpoint with image[] parameter.
 */
export async function editImage(req: EditRequest): Promise<GeneratedImage[]> {
  // Build multipart form data for the edits endpoint
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", req.prompt);
  if (req.size) form.append("size", req.size);
  if (req.quality) form.append("quality", req.quality);

  // Convert base64 images to Blob and append
  for (let i = 0; i < req.images.length; i++) {
    const b64 = req.images[i];
    // Strip data URL prefix if present
    const raw = b64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");
    const blob = new Blob([buf], { type: "image/png" });
    form.append("image[]", blob, `reference_${i}.png`);
  }

  const res = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
    },
    body: form,
    signal: AbortSignal.timeout(120_000),
  }).catch((e: any) => {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new ImageApiError(504, "Image editing timed out. Try a simpler prompt.");
    }
    throw new ImageApiError(502, "Could not reach the image service.");
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[creative-studio] OpenAI edit error", res.status, detail.slice(0, 500));
    if (res.status === 400) {
      try {
        const err = JSON.parse(detail);
        throw new ImageApiError(400, err?.error?.message || "Edit request rejected.");
      } catch (e) {
        if (e instanceof ImageApiError) throw e;
      }
      throw new ImageApiError(400, "The edit request was rejected. Try different images or prompt.");
    }
    if (res.status === 429) throw new ImageApiError(429, "Rate limited. Wait a moment and try again.");
    throw new ImageApiError(502, "Image editing failed. Try again.");
  }

  const json = await res.json().catch(() => null);
  const data = json?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ImageApiError(502, "No images were returned.");
  }

  return data.map((d: any) => ({
    b64: d.b64_json,
    revisedPrompt: d.revised_prompt || undefined,
  }));
}

// ── Prompt Enhancement ───────────────────────────────────────────────────────

const ENHANCE_SYSTEM = `You are a visual prompt engineer for a real estate marketing AI image generator.

When the user gives you a brief description, expand it into a detailed, vivid image generation prompt.

Rules:
- Focus on real estate and property marketing visuals
- Include specific details: lighting, materials, textures, atmosphere, camera angle
- Mention photographic style (editorial, architectural, lifestyle, aerial)
- Keep it under 300 words
- Never invent specific property details (prices, RERA numbers, phone numbers)
- If the user mentions a specific BHK type, describe appropriate interiors
- For banners, describe the background visual only — text will be added separately
- Use professional, premium aesthetic language
- Output ONLY the enhanced prompt text, no explanation`;

export async function enhancePrompt(shortPrompt: string): Promise<string> {
  const res = await fetch(
    process.env.OPENAI_BASE_URL?.replace(/\/+$/, "").concat("/v1/chat/completions") ||
      "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: ENHANCE_SYSTEM },
          { role: "user", content: shortPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(20_000),
    }
  ).catch(() => {
    throw new ImageApiError(502, "Could not reach the AI service for prompt enhancement.");
  });

  if (!res.ok) {
    throw new ImageApiError(502, "Prompt enhancement failed.");
  }

  const json = await res.json().catch(() => null);
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ImageApiError(502, "Prompt enhancement returned empty.");
  return text;
}
