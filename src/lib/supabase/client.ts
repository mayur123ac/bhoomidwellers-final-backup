import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton — avoids crashing at module-load time during Vercel's
// static page prerendering, where NEXT_PUBLIC_* env vars may be absent.
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase env vars not set (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). " +
      "Add them to your Vercel project environment variables."
    );
  }

  _supabase = createClient(url, key);
  return _supabase;
}

/** Supabase browser client. Access via this getter to avoid build-time crashes. */
export { getSupabase };

// Backwards-compatible named export — lazy, won't crash at import time.
// Components that do `import { supabase } from ...` still work, but the
// client is only created on first property access at runtime.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  },
});
