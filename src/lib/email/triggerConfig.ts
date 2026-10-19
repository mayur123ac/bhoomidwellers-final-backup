// lib/email/triggerConfig.ts — runtime lookup of email trigger configuration.
//
// Called by EmailService before every send to check whether the trigger is
// enabled and to load any custom subject/body.
//
// Fail-safe policy: if the database lookup fails (table missing, connection
// error), a KNOWN trigger is treated as enabled with default templates —
// because the administrator never explicitly disabled it, and silently
// swallowing a password-reset OTP because of a transient DB error is worse
// than sending with the default wording.

import { TRIGGER_MAP } from "./triggerDefaults";

let queryFn: ((sql: string, params?: any[]) => Promise<any[]>) | null = null;

async function getQuery() {
  if (!queryFn) {
    const db = await import("@/lib/db");
    queryFn = db.query;
  }
  return queryFn;
}

export interface TriggerConfig {
  enabled: boolean;
  subject: string | null; // null = use template default
  body: string | null;    // null = use template default
}

/**
 * Load the persisted configuration for a trigger.
 *
 * Returns null only for unknown triggers. For known triggers with a missing
 * table row or a DB error, returns the safe default (enabled, no custom text).
 */
export async function loadTriggerConfig(triggerKey: string): Promise<TriggerConfig | null> {
  const defaults = TRIGGER_MAP.get(triggerKey);
  if (!defaults) return null;

  const safeDefault: TriggerConfig = { enabled: true, subject: null, body: null };

  try {
    const q = await getQuery();
    const rows = await q(
      "SELECT enabled, custom_subject, custom_body FROM email_trigger_config WHERE trigger_key = $1 LIMIT 1",
      [triggerKey]
    );

    if (rows.length === 0) return safeDefault;

    return {
      enabled: rows[0].enabled,
      subject: rows[0].custom_subject,
      body: rows[0].custom_body,
    };
  } catch {
    // Table doesn't exist or DB error — fail open for known triggers.
    return safeDefault;
  }
}
