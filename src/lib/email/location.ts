// lib/email/location.ts — approximate location for an IP address.
//
// Split out of the old lib/mailer.ts, which mixed transport, templates and this
// together. It belongs with email because the login alert is the only thing that
// asks for it, but it is not a template and not a transport.
//
// ── It reports what is known, not a plausible guess ─────────────────────────
// This CRM has no IP-geolocation provider — no MaxMind database, no ipinfo or
// ip-api key, nothing. The "Approximate location" line still appears in the
// login alert because the spec asks for it and because an operator who adds a
// provider later should not have to change the template. What it must never do
// is invent a city: a security email that confidently names the wrong place
// trains the reader to distrust the whole message, which is worse than an honest
// "unavailable".

/**
 * Best-effort location for an IP address.
 *
 * Returns a truthful answer in every case:
 *   * private/loopback ranges  → "Local network"
 *   * no provider configured   → says so explicitly
 *
 * To add a provider, replace the final return with a lookup. Keep it inside a
 * try/catch and keep the timeout short — this runs on the login path, and a slow
 * geolocation API must never hold up a sign-in.
 */
export function resolveApproximateLocation(ip: string): string {
  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  // The ::ffff: prefix is an IPv4 address carried inside an IPv6 socket.
  const address = (ip || "").split(",")[0].trim().replace(/^::ffff:/i, "");

  if (!address || address === "unknown") return "Unavailable (no IP recorded)";
  if (address === "::1" || address === "127.0.0.1") return "Local network (loopback)";
  if (/^10\./.test(address)) return "Local network";
  if (/^192\.168\./.test(address)) return "Local network";
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return "Local network";

  return "Unavailable (no geolocation provider configured)";
}
