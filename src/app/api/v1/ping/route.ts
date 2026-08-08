// app/api/v1/ping/route.ts — credential check.
//
// The only v1 route that takes no scope. It exists so an integrator can confirm
// a key is live, correctly formatted, within its IP allow-list and not rate
// limited BEFORE deciding which scopes it needs — and so that "is the key
// wrong or is my query wrong" is answerable in one request.
//
// It echoes back the key's own configuration, which is safe: the caller already
// holds the key, so learning its name and scopes tells them nothing they could
// not infer by trying every endpoint. It deliberately does not echo the IP
// allow-list, because a key leaked to a third party should not hand that party
// a map of which source addresses to spoof.

import { withApiKey } from "@/lib/apiV1";

export const dynamic = "force-dynamic";

export const GET = withApiKey("/api/v1/ping", null, async (ctx) => ({
  data: {
    ok: true,
    key: {
      name: ctx.key.name,
      prefix: ctx.key.key_prefix,
      scopes: ctx.key.scopes ?? [],
      expiresAt: ctx.key.expires_at,
    },
    serverTime: new Date().toISOString(),
  },
}));
