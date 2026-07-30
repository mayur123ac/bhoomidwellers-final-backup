// lib/phone.ts — E.164 normalization for outbound messaging.
//
// ── Why this is not normalizeCpPhone ─────────────────────────────────────────
//
// Two phone normalizers already exist and neither can be reused here:
//
//   normalizeCpPhone  (lib/cpRbac.ts)            → last 10 digits, "" on failure
//   normalizePhone    (lib/cpCommissionEngine.ts) → last 10 digits, null on failure
//
// Their output is a JOIN KEY, not a dialable number. It is matched against
// SQL_NORMALIZED_PHONE and the idx_channel_partners_phone_norm expression index
// that Channel Partner dedup depends on, and it deliberately collapses
// "+91 98765 43210", "09876543210" and "9876543210" onto one value so that
// re-registering a partner finds the existing row. Widening either function to
// emit a country code would change what that index matches and silently break
// dedup; narrowing this one to ten digits would send WhatsApp messages to a
// number with no country code, which Meta rejects.
//
// Different contract, different function. The existing two are untouched.
//
// ── Why it lives in lib/ ─────────────────────────────────────────────────────
// It sits beside the two normalizers it must be distinguished from, and it is a
// generic concern — an SMS or IVR feature would want it too. Keeping it out of
// the WhatsApp module means a future caller does not drag in the WhatsApp config
// graph just to format a number.

export type E164FailureReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "not_numeric"
  | "unparseable";

export type E164Result =
  | {
      ok: true;
      /** Canonical form with the leading plus: "+919876543210". */
      e164: string;
      /** The same number as bare digits: "919876543210". What Meta wants. */
      digits: string;
    }
  | { ok: false; reason: E164FailureReason };

/** E.164 permits 1–15 digits; the leading digit is never zero. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * Coerces whatever is stored in users.whatsapp_number into E.164.
 *
 * This has to be forgiving, because that column is written verbatim by
 * WhatsAppSettingsCard.tsx — it does no stripping at all, and its help text only
 * *asks* for "country code without the + sign". Real values include "+91 98765
 * 43210", "09876543210" and "919876543210". Assuming clean digits would silently
 * drop notifications for whoever typed it differently.
 *
 * It is forgiving in formatting, strict in semantics: a 10-digit number that
 * cannot be an Indian mobile is rejected rather than having a country code
 * guessed onto it, because sending to the wrong person is worse than not
 * sending.
 */
export function toE164(raw: unknown, defaultCountryCode = "91"): E164Result {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, reason: "empty" };

  const hadPlus = s.startsWith("+");
  // Strips spaces, hyphens, parentheses, dots and the plus in one pass.
  let d = s.replace(/\D/g, "");
  if (!d) return { ok: false, reason: "not_numeric" };

  let candidate: string;

  if (hadPlus) {
    // An explicit plus is a claim that the country code is already present.
    // Trust it — this is the only branch that can produce a non-Indian number.
    candidate = "+" + d;
  } else {
    // "00" is the international access prefix: 00 91 98765 43210.
    if (d.startsWith("00") && d.length >= 12) d = d.slice(2);
    // A single leading zero is India's national trunk prefix: 0 98765 43210.
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);

    if (d.length === 10) {
      // Indian mobile numbers begin 6, 7, 8 or 9. A 10-digit number starting
      // 0-5 is a landline with an STD code, or junk; defaulting a country code
      // onto it would produce a plausible-looking wrong number.
      if (!/^[6-9]/.test(d)) return { ok: false, reason: "unparseable" };
      candidate = "+" + defaultCountryCode + d;
    } else if (d.length >= 11 && d.length <= 15) {
      // Long enough to already carry a country code.
      candidate = "+" + d;
    } else if (d.length < 10) {
      return { ok: false, reason: "too_short" };
    } else {
      return { ok: false, reason: "too_long" };
    }
  }

  if (!E164_PATTERN.test(candidate)) {
    if (candidate.length - 1 > 15) return { ok: false, reason: "too_long" };
    if (candidate.length - 1 < 8) return { ok: false, reason: "too_short" };
    return { ok: false, reason: "unparseable" };
  }

  return { ok: true, e164: candidate, digits: candidate.slice(1) };
}

/**
 * Meta's `to` field wants bare digits.
 *
 * Both forms are accepted by the API, but the no-plus form is what its docs use
 * and what comes back as `wa_id` in delivery webhooks — so storing "+91…" and
 * sending "91…" keeps receiver_phone ↔ recipient_id comparison to a single
 * strip on one side.
 */
export function toMetaRecipient(e164: string): string {
  return e164.startsWith("+") ? e164.slice(1) : e164;
}

/**
 * For console output only. notification_logs.receiver_phone stores the number
 * unmasked — it is business data the admin screen has to show — but logs get
 * scraped, shipped and pasted into tickets, so they get this instead.
 */
export function maskPhone(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.length <= 6) return "*".repeat(s.length);
  const head = s.slice(0, 5);
  const tail = s.slice(-3);
  return `${head}${"*".repeat(Math.max(1, s.length - 8))}${tail}`;
}

/** Human-readable explanation for a failed normalization, for last_error. */
export function describeE164Failure(reason: E164FailureReason): string {
  switch (reason) {
    case "empty":
      return "No phone number on file.";
    case "too_short":
      return "Phone number has too few digits to be valid.";
    case "too_long":
      return "Phone number has more than 15 digits.";
    case "not_numeric":
      return "Phone number contains no digits.";
    case "unparseable":
      return "Phone number is not a recognisable mobile number.";
  }
}
