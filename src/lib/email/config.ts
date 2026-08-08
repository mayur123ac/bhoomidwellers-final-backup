// lib/email/config.ts — SMTP and sender configuration, read from the environment.
//
// One module reads these variables. Nothing else in the CRM touches
// process.env for mail, so "what is the from address" has one answer and
// changing it is one edit.
//
// ── Why the environment is read on every call ───────────────────────────────
// Not cached at module scope, for the reason set out in lib/secretsCrypto.ts:
// `next build` evaluates route modules with an environment that may not include
// .env.local, and a module-scope read would freeze that absence into the build —
// producing a deployment that believes it has no mail transport no matter what
// is set at runtime.
//
// The cost is a handful of property reads per email, against a network call.
//
// ── Credentials never leave the server ──────────────────────────────────────
// Every name here is server-only. None is prefixed NEXT_PUBLIC_, which is what
// would put it in the client bundle, and nothing in this module is imported by
// a client component. The one value safe to show a user is the from-address,
// and even that is surfaced through a server route rather than read directly.

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (SMTPS). True for 465, false for STARTTLS ports. */
  secure: boolean;
  user: string;
  password: string;
}

export interface SenderConfig {
  fromName: string;
  fromEmail: string;
  /** Where replies go. Falls back to the support address. */
  replyTo: string;
  supportEmail: string;
  /** Absolute base URL, for links in emails. May be empty. */
  appUrl: string;
  companyName: string;
}

export type ProviderKind = "smtp" | "resend" | "console";

/* ══════════════════════════════════════════════════════════════════════════
   Reading
   ══════════════════════════════════════════════════════════════════════════ */

function str(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * SMTP_SECURE, three-valued.
 *
 * Unset is NOT the same as false. When unset the port decides — 465 is implicit
 * TLS, everything else is STARTTLS — because that inference is right in almost
 * every case and getting it wrong produces a hang rather than an error: the
 * client waits for a greeting that never arrives. An explicit value always wins,
 * for the hosts where the convention does not hold.
 */
function readSecure(port: number): boolean {
  const raw = str("SMTP_SECURE").toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return port === 465;
}

/**
 * Google displays an App Password as four groups of four lowercase letters —
 * "abcd efgh ijkl mnop" — and the spaces are presentation, not password. They
 * get copied along with it constantly, and the result is a 19-character string
 * that fails authentication with "Username and Password not accepted", which
 * reads like a wrong password rather than a formatting problem.
 *
 * Stripped ONLY when the value matches that exact shape. A blanket
 * whitespace-strip would be wrong: a password on some other SMTP host may
 * legitimately contain a space, and silently mangling it would be a worse bug
 * than the one being fixed.
 */
const GOOGLE_APP_PASSWORD_RE = /^[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}$/;

function normalisePassword(raw: string): string {
  return GOOGLE_APP_PASSWORD_RE.test(raw) ? raw.replace(/ /g, "") : raw;
}

export function readSmtpConfig(): SmtpConfig | null {
  const host = str("SMTP_HOST");
  const user = str("SMTP_USER");
  // SMTP_PASS is accepted as an alias. Nodemailer's own examples use `pass`,
  // and mistyping this one produces an authentication failure that reads like a
  // wrong password rather than a missing variable.
  const password = normalisePassword(str("SMTP_PASSWORD") || str("SMTP_PASS"));

  if (!host || !user || !password) return null;

  const port = Number(str("SMTP_PORT") || "587");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  return { host, port, secure: readSecure(port), user, password };
}

/**
 * The sender identity.
 *
 * MAIL_FROM_NAME / MAIL_FROM_EMAIL are the documented pair. The older single
 * MAIL_FROM ("Bhoomi CRM <x@y.com>") is still parsed as a fallback so an
 * existing deployment does not go dark the moment this ships — it was the only
 * supported form until now, and a config change that silently stops mail is the
 * worst possible way to roll out a mail system.
 */
export function readSenderConfig(): SenderConfig {
  let fromName = str("MAIL_FROM_NAME");
  let fromEmail = str("MAIL_FROM_EMAIL");

  if (!fromEmail) {
    const legacy = str("MAIL_FROM");
    // "Display Name <address@host>" or a bare address.
    const match = legacy.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
    if (match) {
      if (!fromName) fromName = match[1].replace(/^"|"$/g, "").trim();
      fromEmail = match[2].trim();
    } else if (legacy) {
      fromEmail = legacy;
    }
  }

  const supportEmail = str("MAIL_SUPPORT_EMAIL") || str("SUPPORT_EMAIL") || fromEmail;

  return {
    fromName: fromName || "Bhoomi Dwellers CRM",
    fromEmail,
    replyTo: str("MAIL_REPLY_TO") || supportEmail,
    supportEmail,
    appUrl: (str("APP_BASE_URL") || str("NEXT_PUBLIC_APP_URL") || "").replace(/\/+$/, ""),
    companyName: str("MAIL_COMPANY_NAME") || "Bhoomi Dwellers",
  };
}

/**
 * The RFC 5322 From header.
 *
 * The display name is quoted and any quote or backslash inside it escaped.
 * A raw name containing `"` would otherwise terminate the quoted string early
 * and let the rest be parsed as header syntax — the same class of bug as the
 * header-injection guard in lib/email/types.ts, reached through configuration
 * rather than through user input.
 */
export function formatFromHeader(sender: SenderConfig): string {
  if (!sender.fromEmail) return "";
  if (!sender.fromName) return sender.fromEmail;
  const name = sender.fromName.replace(/[\\"]/g, (c) => `\\${c}`);
  return `"${name}" <${sender.fromEmail}>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Provider selection
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Which provider a send would use right now.
 *
 * SMTP is checked FIRST. That is the change this module introduces: Resend used
 * to win whenever a key was present, which meant a deployment that configured
 * SMTP still sent through Resend and could not work out why. SMTP is now the
 * default provider and Resend is the explicit opt-out, via EMAIL_PROVIDER.
 */
export function activeProvider(): ProviderKind {
  const forced = str("EMAIL_PROVIDER").toLowerCase();

  if (forced === "smtp") return readSmtpConfig() ? "smtp" : "console";
  if (forced === "resend") return str("RESEND_API_KEY") ? "resend" : "console";
  if (forced === "console") return "console";

  if (readSmtpConfig()) return "smtp";
  if (str("RESEND_API_KEY")) return "resend";
  return "console";
}

/** Whether a real transport is configured. */
export function isMailConfigured(): boolean {
  return activeProvider() !== "console";
}

/* ══════════════════════════════════════════════════════════════════════════
   Validation
   ══════════════════════════════════════════════════════════════════════════ */

export interface ConfigProblem {
  variable: string;
  message: string;
  /** `error` means mail cannot be sent. `warning` means it can, but badly. */
  severity: "error" | "warning";
}

/**
 * Check the configuration without opening a connection.
 *
 * Reports EVERY problem rather than the first, because the usual failure is a
 * fresh deployment missing three variables, and finding them one restart at a
 * time is the slowest possible way to do it.
 */
export function validateMailConfig(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const provider = activeProvider();
  const sender = readSenderConfig();

  if (provider === "console") {
    const partial = str("SMTP_HOST") || str("SMTP_USER") || str("SMTP_PASSWORD") || str("SMTP_PASS");
    problems.push({
      variable: "SMTP_HOST",
      severity: "error",
      message: partial
        ? "SMTP is partly configured — SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all required. " +
          "Email will be logged to the console instead of sent."
        : "No mail transport is configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and " +
          "SMTP_PASSWORD. Email will be logged to the console instead of sent.",
    });
  }

  if (!sender.fromEmail) {
    problems.push({
      variable: "MAIL_FROM_EMAIL",
      severity: "error",
      message: "No sender address. Set MAIL_FROM_EMAIL (and MAIL_FROM_NAME).",
    });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(sender.fromEmail)) {
    problems.push({
      variable: "MAIL_FROM_EMAIL",
      severity: "error",
      message: `"${sender.fromEmail}" is not a valid email address.`,
    });
  }

  // SMTP_HOST is a hostname, not a mailbox. Putting the account address here is
  // an easy mistake — it is the value that goes in SMTP_USER on the next line —
  // and it fails as a DNS lookup for a name that cannot resolve, which does not
  // point at the cause. Caught by shape rather than left to the network.
  const rawHost = str("SMTP_HOST");
  if (rawHost.includes("@")) {
    problems.push({
      variable: "SMTP_HOST",
      severity: "error",
      message:
        `"${rawHost}" is an email address, not a mail server hostname. SMTP_HOST should be ` +
        `the server (for example smtp.gmail.com); the address belongs in SMTP_USER.`,
    });
  }

  if (provider === "smtp") {
    const smtp = readSmtpConfig();

    // Port 25 is blocked outbound by essentially every cloud host and is not
    // authenticated submission. It is almost always a copied-from-somewhere
    // value, and it fails as a timeout — the least diagnosable failure there is.
    if (smtp && smtp.port === 25) {
      problems.push({
        variable: "SMTP_PORT",
        severity: "warning",
        message:
          "Port 25 is for server-to-server relay and is blocked outbound by most hosts. " +
          "Use 587 (STARTTLS) or 465 (implicit TLS) for authenticated submission.",
      });
    }

    if (smtp && !smtp.secure && smtp.port !== 587 && smtp.port !== 25) {
      problems.push({
        variable: "SMTP_SECURE",
        severity: "warning",
        message: `Port ${smtp.port} with SMTP_SECURE=false. If this host expects implicit TLS, the connection will hang rather than fail. Set SMTP_SECURE explicitly.`,
      });
    }

    // A from-address on a different domain from the SMTP account is the usual
    // cause of mail landing in spam, and of relays refusing the message
    // outright with "sender not owned".
    if (smtp && sender.fromEmail) {
      const fromDomain = sender.fromEmail.split("@")[1]?.toLowerCase();
      const userDomain = smtp.user.includes("@")
        ? smtp.user.split("@")[1]?.toLowerCase()
        : undefined;

      if (fromDomain && userDomain && fromDomain !== userDomain) {
        problems.push({
          variable: "MAIL_FROM_EMAIL",
          severity: "warning",
          message:
            `The sender domain (${fromDomain}) differs from the SMTP account domain ` +
            `(${userDomain}). Many providers refuse to relay this, and receivers that ` +
            `accept it often mark it as spam. Check SPF and DKIM for ${fromDomain}.`,
        });
      }
    }
  }

  if (provider === "resend" && /onboarding@resend\.dev/i.test(sender.fromEmail)) {
    problems.push({
      variable: "MAIL_FROM_EMAIL",
      severity: "warning",
      message:
        "onboarding@resend.dev can only deliver to the address the Resend account was " +
        "registered with. Every other recipient is refused with a 403.",
    });
  }

  if (!sender.appUrl) {
    problems.push({
      variable: "APP_BASE_URL",
      severity: "warning",
      message:
        "No base URL, so links in emails (invitations, 'Was this you?') will be omitted " +
        "or relative. Set APP_BASE_URL to the CRM's public address.",
    });
  }

  return problems;
}

/**
 * Startup check. Logs, and deliberately does not throw.
 *
 * Called from instrumentation.ts. A missing SMTP password must not stop the CRM
 * from booting: leads, bookings and reports have nothing to do with email, and
 * taking the whole application down over an unsent password-change alert trades
 * a small problem for a total outage. The console provider keeps the send path
 * working and honest in the meantime.
 */
export function reportMailConfigAtStartup(): void {
  const problems = validateMailConfig();
  const provider = activeProvider();

  if (problems.length === 0) {
    console.info(`[email] provider=${provider}, sender=${readSenderConfig().fromEmail}`);
    return;
  }

  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");

  console.warn(
    `[email] provider=${provider} — ${errors.length} error(s), ${warnings.length} warning(s):`
  );
  for (const problem of errors) console.error(`  ✗ ${problem.variable}: ${problem.message}`);
  for (const problem of warnings) console.warn(`  ! ${problem.variable}: ${problem.message}`);
}
