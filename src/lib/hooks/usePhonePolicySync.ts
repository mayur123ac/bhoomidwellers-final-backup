"use client";

// lib/hooks/usePhonePolicySync.ts
//
// Subscribes to the org's Supabase Realtime channel and calls invalidateCpCache()
// whenever a PHONE_POLICY_CHANGED broadcast arrives. This causes every mounted
// useCpResource panel to re-fetch its data from the server, which will now return
// masked (or unmasked) phone numbers according to the updated policy.
//
// Security note: this hook only *triggers* a refetch. The server still enforces
// the policy on every request — Realtime is not the security boundary. A client
// that ignores this hook (e.g. an old session tab) will still receive masked data
// on the next server request because the policy is checked server-side each time.

import { useEffect, useRef } from "react";
import { getStoredCrmUser } from "@/lib/authSession";
import { invalidateCpCache } from "@/lib/hooks/useCpResource";
import { useRealtimeOrg } from "@/lib/supabase/useRealtimeOrg";

/**
 * Mount this once near the top of any page that displays CP phone numbers.
 * When the admin changes a phone access policy, all connected sessions automatically
 * re-fetch their CP data and display freshly masked/unmasked phones.
 */
export function usePhonePolicySync() {
  const user = useRef(getStoredCrmUser() as { organization_id?: string } | null);

  const orgId = user.current?.organization_id ?? null;

  useRealtimeOrg({
    organizationId: orgId,
    events: {
      PHONE_POLICY_CHANGED: () => {
        // Drop all CP-related cached responses so the next useCpResource render
        // triggers a fresh server fetch with the new policy applied.
        invalidateCpCache();
      },
    },
    enabled: !!orgId,
  });
}
