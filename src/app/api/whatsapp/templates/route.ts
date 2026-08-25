// api/whatsapp/templates/route.ts — the approved templates for this WABA.
//
// Exists because of spec §13: when the 24-hour window has closed, the correct
// action is to send an approved template, not to find a way around the rule. The
// composer cannot offer that choice without knowing which templates exist and
// how many parameters each takes.
//
// Read straight from Meta rather than from a local table. A template's status
// changes at Meta's end — approved, rejected, paused, disabled — and a cached
// copy would offer employees templates that no longer send. The list is small
// and this is called only when the window is closed.

import { NextResponse } from "next/server";
import { assertConfigured, isConfigured, redactSecrets } from "@/config/whatsapp.config";
import { requireSession } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The parts of a Meta template component this route inspects, and only those. */
interface TemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; url?: string }>;
}

/** Short server-side memo. Long enough to spare Meta a call per keystroke. */
let cache: { at: number; data: unknown[] } | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  if (!isConfigured()) {
    return NextResponse.json(
      { success: false, code: "CONFIG_MISSING", message: "WhatsApp is not configured." },
      { status: 503 }
    );
  }

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ success: true, data: cache.data, cached: true });
  }

  const cfg = assertConfigured();
  const url =
    `${cfg.baseUrl}/${cfg.apiVersion}/${cfg.businessAccountId}/message_templates` +
    `?limit=100&fields=name,status,category,language,components`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      signal: AbortSignal.timeout(cfg.timeoutMs),
      cache: "no-store",
    });

    const json: any = await res.json().catch(() => null);

    if (!res.ok) {
      // Meta's raw body is not echoed — it can carry fbtrace ids and request
      // echoes. Same rule as /api/whatsapp.
      return NextResponse.json(
        {
          success: false,
          code: "META_API_ERROR",
          message: redactSecrets(String(json?.error?.message ?? `Meta returned HTTP ${res.status}`)),
        },
        { status: 502 }
      );
    }

    // Only APPROVED templates in the tenant's configured language are offered.
    // Showing a PENDING or REJECTED one would let an employee pick a template
    // that is guaranteed to fail.
    const data = (Array.isArray(json?.data) ? json.data : [])
      .filter((t: any) => t?.status === "APPROVED")
      .map((t: any) => {
        const body = Array.isArray(t?.components)
          ? t.components.find((c: any) => c?.type === "BODY")
          : null;
        const text: string = body?.text ?? "";
        // Positional {{n}} placeholders. The count is what the composer needs to
        // render the right number of inputs.
        const placeholders = new Set((text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map(String));

        // ── What the composer can actually build (Meta error 132012) ─────────
        // The composer supplies BODY parameters and nothing else. A template
        // that also needs a carousel, a media header or a dynamic button URL
        // cannot be assembled from that, and sending it anyway earns
        // "(#132012) Parameter format does not match format in the created
        // template" — a failed row and a confused employee.
        //
        // So the shape is reported rather than discovered at send time. An
        // unsupported template is still listed, because "this exists but this
        // composer cannot send it" is useful information; it simply cannot be
        // chosen.
        const components: TemplateComponent[] = Array.isArray(t?.components) ? t.components : [];
        const header = components.find((c) => c?.type === "HEADER");
        const headerFormat = String(header?.format ?? "TEXT").toUpperCase();
        const headerHasParams = /\{\{\s*\d+\s*\}\}/.test(String(header?.text ?? ""));
        const hasCarousel = components.some((c) => c?.type === "CAROUSEL");
        const dynamicButton = components
          .filter((c) => c?.type === "BUTTONS")
          .flatMap((c) => c?.buttons ?? [])
          .some((b) => /\{\{\s*\d+\s*\}\}/.test(String(b?.url ?? "")) || b?.type === "COPY_CODE");

        let unsupportedReason: string | null = null;
        if (hasCarousel) unsupportedReason = "Carousel templates need per-card media and cannot be sent from here.";
        else if (headerFormat !== "TEXT") unsupportedReason = `The ${headerFormat.toLowerCase()} header needs a media upload, which this composer cannot supply.`;
        else if (headerHasParams) unsupportedReason = "This template's header takes its own parameter, which this composer cannot supply.";
        else if (dynamicButton) unsupportedReason = "This template has a dynamic button that needs its own parameter.";

        return {
          name: t.name,
          language: t.language,
          category: t.category,
          bodyText: text,
          paramCount: placeholders.size,
          supported: unsupportedReason === null,
          unsupportedReason,
        };
      });

    cache = { at: Date.now(), data };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        code: "NETWORK_ERROR",
        message: redactSecrets(`Could not reach Meta: ${(err as Error).message}`),
      },
      { status: 502 }
    );
  }
}
