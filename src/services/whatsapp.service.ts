// services/whatsapp.service.ts — the notification engine.
//
// The only module that touches both the database and the Meta transport, and
// therefore the only one that has to reason about ordering, idempotency and
// failure. Route handlers call notifyChannelPartnerRegistered() /
// notifyCpLeadAssigned() and nothing else.
//
// ── Three invariants ─────────────────────────────────────────────────────────
//
// 1. A notification never breaks the write that triggered it.
//    The notify* entry points are synchronous, void-returning, and swallow
//    everything. Drop the notification_logs table entirely and both trigger
//    routes still return 201.
//
// 2. A row is logged before it is sent, never after.
//    The log row is the queue. If the process dies between "sent to Meta" and
//    "recorded it", the row still exists in 'sending' and the stale-lock reaper
//    reclaims it. The reverse ordering would lose the record entirely.
//
// 3. A send never happens inside a transaction.
//    lib/db.ts runs a pool of 10. Holding a client across a 10-second Meta call
//    would let ten concurrent registrations exhaust the pool and stall every
//    unrelated query in the CRM. Claim in a transaction, commit, then send.

import type { PoolClient } from "pg";
import { query, transaction } from "@/lib/db";
import { SOURCING_MANAGER_ROLE_PREDICATE } from "@/lib/sourcingAssignment";
import { toE164, toMetaRecipient, maskPhone, describeE164Failure } from "@/lib/phone";
import { sendTemplate, sendText } from "@/lib/whatsapp-client";
import {
  assertConfigured,
  configSummary,
  isConfigured,
  readConfig,
  redactSecrets,
  redactDeep,
} from "@/config/whatsapp.config";
import { TEMPLATE_REGISTRY } from "@/templates/channel-partner.template";
import {
  WhatsAppError,
  type NotificationStatus,
  type NotificationType,
  type SubjectType,
  type TemplateKey,
  type WebhookStatusUpdate,
} from "@/types/whatsapp.types";

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Postgres "relation does not exist" — the migration has not been run yet. */
const PG_UNDEFINED_TABLE = "42P01";

function isMissingTable(err: any): boolean {
  return err?.code === PG_UNDEFINED_TABLE;
}

let warnedMissingTable = false;

/**
 * Every failure inside this module funnels here. Nothing rethrows to a caller in
 * a request path — the whole point is that a broken notification pipeline is
 * invisible to the user completing a registration.
 */
function swallow(context: string, err: unknown): void {
  if (isMissingTable(err)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn(
        "[whatsapp] notification_logs does not exist — notifications are being discarded. " +
          "Run: node scripts/run_sql_migration.js 2026-07-30_whatsapp_notification_logs.sql"
      );
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[whatsapp] ${context}: ${redactSecrets(message)}`);
}

function jitter(ms: number): number {
  // ±20%. A Meta outage otherwise produces a synchronised thundering herd the
  // moment service resumes, which is the worst possible time to pile on.
  return Math.max(1_000, Math.round(ms * (0.8 + Math.random() * 0.4)));
}

function delayForAttempt(attemptNumber: number): number {
  const { config } = readConfig();
  const delays = config?.retryDelaysMs ?? [30_000, 120_000, 600_000];
  // attemptNumber is 1-based: the delay before attempt 2 is delays[0].
  return jitter(delays[attemptNumber - 1] ?? delays[delays.length - 1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipient resolution
// ─────────────────────────────────────────────────────────────────────────────

interface Recipient {
  id: number;
  name: string;
  whatsapp_number: string | null;
}

/**
 * Looks up the target manager.
 *
 * Neither trigger route has this in scope — channel-partners never joins users
 * for the assignee, and walkin_enquiries only carries {id, name}. The role and
 * is_active re-check is deliberate: a partner may still point at someone who has
 * since been deactivated or moved off the Sourcing desk, and paging them would
 * send partner details to a person no longer entitled to them.
 *
 * SOURCING_MANAGER_ROLE_PREDICATE is reused rather than retyped — it references
 * a bare `role` column, so the table must not be aliased here.
 */
async function resolveRecipient(userId: number): Promise<Recipient | null> {
  const rows = await query<Recipient>(
    `SELECT id, name, whatsapp_number
       FROM users
      WHERE id = $1
        AND is_active = true
        AND ${SOURCING_MANAGER_ROLE_PREDICATE}
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────────────────

export interface EnqueueInput {
  type: NotificationType;
  templateKey: TemplateKey;
  templateInput: Record<string, unknown>;
  receiverUserId: number | null;
  subjectType: SubjectType | null;
  subjectId: number | null;
}

export interface EnqueueResult {
  logId: number | null;
  status: NotificationStatus;
  reason?: string;
}

interface InsertRowInput {
  type: string;
  receiver: string | null;
  receiverUserId: number | null;
  receiverPhone: string | null;
  subjectType: string | null;
  subjectId: number | null;
  templateName: string | null;
  status: NotificationStatus;
  payload: unknown;
  lastError: string | null;
  lastErrorCode: string | null;
  nextRetryAt: boolean;
}

/**
 * The single INSERT. ON CONFLICT DO NOTHING against uq_notification_logs_subject
 * is what makes a double-submitted form produce one message rather than two.
 * Returns null when the conflict fired.
 */
async function insertLog(i: InsertRowInput): Promise<number | null> {
  const rows = await query<{ id: number }>(
    `INSERT INTO notification_logs (
       channel, type, receiver, receiver_user_id, receiver_phone,
       subject_type, subject_id, template_name, status, payload,
       last_error, last_error_code, next_retry_at, max_retries
     ) VALUES (
       'whatsapp', $1, $2, $3, $4,
       $5, $6, $7, $8, $9::jsonb,
       $10, $11, CASE WHEN $12::boolean THEN now() ELSE NULL END, $13
     )
     ON CONFLICT (type, subject_id) WHERE subject_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      i.type,
      i.receiver,
      i.receiverUserId,
      i.receiverPhone,
      i.subjectType,
      i.subjectId,
      i.templateName,
      i.status,
      i.payload === undefined ? null : JSON.stringify(redactDeep(i.payload)),
      i.lastError,
      i.lastErrorCode,
      i.nextRetryAt,
      readConfig().config?.maxRetries ?? 3,
    ]
  );
  return rows[0]?.id ?? null;
}

/**
 * Resolves the recipient, builds the payload, and writes exactly one row.
 *
 * Every early exit still writes a row. That is the design: a notification that
 * was never sent is an operational fact somebody needs to see, and silence is
 * the one outcome that guarantees nobody will.
 */
export async function enqueueNotification(input: EnqueueInput): Promise<EnqueueResult> {
  const def = TEMPLATE_REGISTRY[input.templateKey];
  const cfg = readConfig().config;
  const languageCode = cfg?.templateLanguage ?? "en_US";

  const base = {
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    templateName: def?.name ?? null,
  };

  // ── 1. No assignee at all ────────────────────────────────────────────────
  if (!input.receiverUserId) {
    const id = await insertLog({
      ...base,
      receiver: null,
      receiverUserId: null,
      receiverPhone: null,
      status: "skipped",
      payload: { request: null },
      lastError: "No Sourcing Manager is assigned to this record.",
      lastErrorCode: "NO_ASSIGNEE",
      nextRetryAt: false,
    });
    return { logId: id, status: "skipped", reason: "NO_ASSIGNEE" };
  }

  // ── 2. Assignee is not a reachable Sourcing Manager ──────────────────────
  const recipient = await resolveRecipient(input.receiverUserId);
  if (!recipient) {
    const id = await insertLog({
      ...base,
      receiver: null,
      receiverUserId: input.receiverUserId,
      receiverPhone: null,
      status: "skipped",
      payload: { request: null },
      lastError: "Assigned user is not an active Sourcing Manager.",
      lastErrorCode: "MISSING_RECIPIENT",
      nextRetryAt: false,
    });
    return { logId: id, status: "skipped", reason: "MISSING_RECIPIENT" };
  }

  // ── 3. No number on file ─────────────────────────────────────────────────
  // Skipped, not dead: nothing is wrong with the data, a prerequisite is simply
  // absent. This row is what tells an admin "Amit Desai has no WhatsApp number"
  // instead of leaving them to wonder why alerts never arrive.
  if (!recipient.whatsapp_number || !recipient.whatsapp_number.trim()) {
    const id = await insertLog({
      ...base,
      receiver: recipient.name,
      receiverUserId: recipient.id,
      receiverPhone: null,
      status: "skipped",
      payload: { request: null },
      lastError: `${recipient.name} has no WhatsApp number saved in Settings.`,
      lastErrorCode: "MISSING_RECIPIENT",
      nextRetryAt: false,
    });
    return { logId: id, status: "skipped", reason: "MISSING_RECIPIENT" };
  }

  // ── 4. Number present but unusable ───────────────────────────────────────
  // Dead, not skipped: this is a data defect a human must correct, and it should
  // never be silently retried into existence.
  const phone = toE164(recipient.whatsapp_number, cfg?.defaultCountryCode ?? "91");
  if (!phone.ok) {
    const id = await insertLog({
      ...base,
      receiver: recipient.name,
      receiverUserId: recipient.id,
      receiverPhone: null,
      status: "dead",
      payload: { request: null, raw_phone: String(recipient.whatsapp_number) },
      lastError: `${describeE164Failure(phone.reason)} (stored: "${recipient.whatsapp_number}")`,
      lastErrorCode: "INVALID_PHONE",
      nextRetryAt: false,
    });
    return { logId: id, status: "dead", reason: "INVALID_PHONE" };
  }

  // ── 5. Build the message ─────────────────────────────────────────────────
  // The recipient's display name is injected here rather than being passed in by
  // the caller. The trigger routes only have an id in scope, and this is the
  // layer that just resolved it — so the name in the message and the row the
  // message was addressed to cannot disagree.
  let request: unknown;
  try {
    const template = def.build(
      { ...input.templateInput, sourcingManager: recipient.name },
      languageCode
    );
    request = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toMetaRecipient(phone.e164),
      type: "template",
      template,
    };
  } catch (err: any) {
    const id = await insertLog({
      ...base,
      receiver: recipient.name,
      receiverUserId: recipient.id,
      receiverPhone: phone.e164,
      status: "dead",
      payload: { request: null },
      lastError: redactSecrets(`Template build failed: ${err?.message ?? err}`),
      lastErrorCode: "INVALID_TEMPLATE",
      nextRetryAt: false,
    });
    return { logId: id, status: "dead", reason: "INVALID_TEMPLATE" };
  }

  // ── 6. Not configured yet ────────────────────────────────────────────────
  // The pre-credentials path, and the core of "no code changes to go live". The
  // row carries the FULLY BUILT payload, so the resolved recipient and the exact
  // parameter order can be audited before Meta has ever seen a byte.
  if (!isConfigured()) {
    const { missing } = readConfig();
    const disabled = missing.length === 0;
    const id = await insertLog({
      ...base,
      receiver: recipient.name,
      receiverUserId: recipient.id,
      receiverPhone: phone.e164,
      status: "skipped",
      payload: { request },
      lastError: disabled
        ? "WhatsApp sending is disabled (WHATSAPP_ENABLED=false)."
        : `WhatsApp is not configured. Missing: ${missing.join(", ")}`,
      lastErrorCode: disabled ? "DISABLED" : "CONFIG_MISSING",
      nextRetryAt: false,
    });
    return { logId: id, status: "skipped", reason: disabled ? "DISABLED" : "CONFIG_MISSING" };
  }

  // ── 7. Queue it ──────────────────────────────────────────────────────────
  const id = await insertLog({
    ...base,
    receiver: recipient.name,
    receiverUserId: recipient.id,
    receiverPhone: phone.e164,
    status: "pending",
    payload: { request, attempts: [] },
    lastError: null,
    lastErrorCode: null,
    nextRetryAt: true,
  });

  if (id === null) {
    // The uniqueness index fired: this exact event is already queued or sent.
    return { logId: null, status: "skipped", reason: "DUPLICATE" };
  }

  scheduleAttempt(id, 0);
  return { logId: id, status: "pending" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fire-and-forget entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contractually never throws and never rejects.
 *
 * Promise.resolve().then(fn) rather than a bare `void fn()` is deliberate: it
 * converts even a SYNCHRONOUS throw inside fn into a rejection the attached
 * .catch handles. A bare void call would leave that as an unhandled rejection,
 * which under --unhandled-rejections=throw terminates the process — turning a
 * failed notification into a crashed CRM.
 */
export function notifyInBackground(input: EnqueueInput): void {
  Promise.resolve()
    .then(() => enqueueNotification(input))
    .catch((err) => swallow(`enqueue ${input.type}`, err));
}

/** Called from POST /api/channel-partners after COMMIT, for new partners only. */
export function notifyChannelPartnerRegistered(args: {
  partner: any;
  registeredBy: string | null;
}): void {
  const p = args.partner ?? {};
  notifyInBackground({
    type: "cp_registration",
    templateKey: "cp_registration",
    receiverUserId: p.assigned_sourcing_manager_id ? Number(p.assigned_sourcing_manager_id) : null,
    subjectType: "channel_partner",
    subjectId: p.id ? Number(p.id) : null,
    templateInput: {
      companyName: p.company_name ?? p.name ?? null,
      // The Channel Partner's own person, not our staff. See the template file.
      contactPerson: p.name ?? null,
      phone: p.phone ?? null,
      address: p.office_address ?? null,
      city: p.city ?? null,
      pincode: p.pin_code ?? null,
      gst: p.gst_number ?? null,
      attendee: p.owner_contact_person ?? null,
      // sourcingManager is injected by enqueueNotification, which is the layer
      // that resolves the recipient — see step 5 there.
      createdAt: p.created_at ?? new Date(),
      registeredBy: args.registeredBy ?? null,
    },
  });
}

/** Called from POST /api/walkin_enquiries after COMMIT, for CP-sourced leads. */
export function notifyCpLeadAssigned(args: { lead: any; loggedBy: string | null }): void {
  const l = args.lead ?? {};
  notifyInBackground({
    type: "cp_lead_assigned",
    templateKey: "cp_lead_assigned",
    receiverUserId: l.sourcing_manager_id ? Number(l.sourcing_manager_id) : null,
    subjectType: "walkin_enquiry",
    subjectId: l.id ? Number(l.id) : null,
    templateInput: {
      clientName: l.name ?? null,
      clientPhone: l.phone ?? null,
      configuration: l.configuration ?? null,
      budget: l.budget ?? null,
      partnerName: l.cp_company || l.cp_name || null,
      loggedBy: args.loggedBy ?? l.assigned_receptionist ?? null,
      createdAt: l.created_at ?? new Date(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────

/** In-process timers, one per row at most. */
const timers = new Map<number, NodeJS.Timeout>();

/** Longer waits are left to the sweep; an in-process timer that far out is a lie. */
const MAX_IN_PROCESS_DELAY_MS = 15 * 60 * 1000;

function scheduleAttempt(logId: number, delayMs: number): void {
  if (timers.has(logId)) return;
  if (delayMs > MAX_IN_PROCESS_DELAY_MS) return;

  // setTimeout, not queueMicrotask: a macrotask runs after the current tick's
  // response flush, so the HTTP 201 for the registration is already on the wire
  // before the first Meta byte moves.
  const t = setTimeout(() => {
    timers.delete(logId);
    void sendNow(logId).catch((err) => swallow(`send ${logId}`, err));
  }, delayMs);

  // Without unref() these keep the event loop alive and `next dev` will not exit
  // on Ctrl-C while any retry is pending.
  if (typeof t.unref === "function") t.unref();
  timers.set(logId, t);
}

/**
 * Claims one row and sends it.
 *
 * The claim is a single statement with FOR UPDATE SKIP LOCKED, and it is the
 * ENTIRE double-send defence: the in-process timer and a concurrent sweep can
 * both target the same row, exactly one wins, and the loser gets zero rows and
 * does nothing. Writing status='sending' is what extends that protection across
 * the network call, after the claiming transaction has already committed.
 */
export async function sendNow(logId: number): Promise<NotificationStatus | null> {
  let row: any;
  try {
    row = await transaction(async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE notification_logs
            SET status = 'sending', locked_at = now()
          WHERE id = (
            SELECT id FROM notification_logs
             WHERE id = $1
               AND status IN ('pending','failed')
               AND retry_count < max_retries
             FOR UPDATE SKIP LOCKED
          )
          RETURNING *`,
        [logId]
      );
      return res.rows[0] ?? null;
    });
  } catch (err) {
    swallow(`claim ${logId}`, err);
    return null;
  }

  if (!row) return null; // already terminal, or someone else has it
  return sendClaimed(row);
}

/**
 * Sends a row that has ALREADY been claimed into 'sending'.
 *
 * Split out from sendNow so the sweep — which claims a whole batch in one
 * statement — does not re-claim each row individually and find it locked by
 * itself.
 */
async function sendClaimed(row: any): Promise<NotificationStatus> {
  const attemptNumber = Number(row.retry_count ?? 0) + 1;
  const request = row.payload?.request;

  if (!request) {
    await settleDead(row.id, "Log row has no request payload to send.", "UNKNOWN", attemptNumber);
    return "dead";
  }

  try {
    const cfg = assertConfigured();
    const result = await sendTemplate(request.to, request.template, cfg);

    await query(
      `UPDATE notification_logs
          SET status = 'sent', message_id = $2, sent_at = now(),
              next_retry_at = NULL, locked_at = NULL,
              last_error = NULL, last_error_code = NULL,
              retry_count = $3,
              payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('response', $4::jsonb)
        WHERE id = $1`,
      [row.id, result.messageId, attemptNumber, JSON.stringify(redactDeep(result.raw))]
    );
    return "sent";
  } catch (err) {
    const wa = WhatsAppError.from(err);
    const maxRetries = Number(row.max_retries ?? 3);
    const canRetry = wa.retryable && attemptNumber < maxRetries;

    if (!canRetry) {
      await settleDead(row.id, wa.toLogString(), wa.code, attemptNumber, wa);
      return "dead";
    }

    const delay = delayForAttempt(attemptNumber);
    try {
      await query(
        `UPDATE notification_logs
            SET status = 'failed', retry_count = $2, locked_at = NULL,
                next_retry_at = now() + ($3 || ' milliseconds')::interval,
                last_error = $4, last_error_code = $5,
                payload = COALESCE(payload, '{}'::jsonb) ||
                          jsonb_build_object('attempts',
                            COALESCE(payload->'attempts', '[]'::jsonb) || $6::jsonb)
          WHERE id = $1`,
        [
          row.id,
          attemptNumber,
          String(delay),
          redactSecrets(wa.toLogString()),
          wa.code,
          JSON.stringify([
            { at: new Date().toISOString(), code: wa.code, httpStatus: wa.httpStatus ?? null },
          ]),
        ]
      );
    } catch (dbErr) {
      swallow(`settle-retry ${row.id}`, dbErr);
      return "failed";
    }
    scheduleAttempt(row.id, delay);
    return "failed";
  }
}

async function settleDead(
  id: number,
  message: string,
  code: string,
  attemptNumber: number,
  wa?: WhatsAppError
): Promise<void> {
  try {
    await query(
      `UPDATE notification_logs
          SET status = 'dead', failed_at = now(), retry_count = $2,
              next_retry_at = NULL, locked_at = NULL,
              last_error = $3, last_error_code = $4,
              payload = COALESCE(payload, '{}'::jsonb) ||
                        jsonb_build_object('attempts',
                          COALESCE(payload->'attempts', '[]'::jsonb) || $5::jsonb)
        WHERE id = $1`,
      [
        id,
        attemptNumber,
        redactSecrets(message),
        code,
        JSON.stringify([
          {
            at: new Date().toISOString(),
            code,
            httpStatus: wa?.httpStatus ?? null,
            message: redactSecrets(message),
          },
        ]),
      ]
    );
  } catch (err) {
    swallow(`settle-dead ${id}`, err);
  }
}

/**
 * Reclaims rows stranded in 'sending'.
 *
 * Without this, one crash or redeploy mid-send leaves a row locked forever,
 * invisible to both the timer and the sweep — a silent, unbounded leak of
 * exactly the notifications that matter most.
 *
 * Accepted tradeoff: a row reclaimed at the five-minute mark MIGHT have actually
 * reached Meta, so a hard crash can produce one duplicate message. Five minutes
 * is far beyond the 10-second timeout, so this only fires on a genuinely dead
 * process, and one duplicate alert beats a permanently lost one.
 */
export async function reapStaleLocks(): Promise<number> {
  try {
    const rows = await query<{ id: number }>(
      `UPDATE notification_logs
          SET status = 'failed', locked_at = NULL, next_retry_at = now(),
              last_error = 'Reclaimed after a stale lock (process restarted mid-send).',
              last_error_code = 'STALE_LOCK'
        WHERE status = 'sending'
          AND locked_at < now() - interval '5 minutes'
        RETURNING id`
    );
    return rows.length;
  } catch (err) {
    swallow("reap", err);
    return 0;
  }
}

export interface SweepReport {
  reaped: number;
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  durationMs: number;
}

/**
 * The durable backstop. Claims everything due in one statement, then sends the
 * batch sequentially — Meta rate-limits per phone number id, and the sweep is
 * not latency-sensitive, so parallelism would only buy 429s.
 */
export async function processDue(limit = 25): Promise<SweepReport> {
  const started = Date.now();
  const report: SweepReport = { reaped: 0, claimed: 0, sent: 0, failed: 0, dead: 0, durationMs: 0 };

  report.reaped = await reapStaleLocks();

  let rows: any[] = [];
  try {
    rows = await transaction(async (client: PoolClient) => {
      const res = await client.query(
        `WITH due AS (
           SELECT id FROM notification_logs
            WHERE status IN ('pending','failed')
              AND next_retry_at IS NOT NULL
              AND next_retry_at <= now()
              AND retry_count < max_retries
            ORDER BY next_retry_at ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
         )
         UPDATE notification_logs n
            SET status = 'sending', locked_at = now()
           FROM due
          WHERE n.id = due.id
          RETURNING n.*`,
        [Math.max(1, Math.min(limit, 100))]
      );
      return res.rows;
    });
  } catch (err) {
    swallow("sweep-claim", err);
    report.durationMs = Date.now() - started;
    return report;
  }

  report.claimed = rows.length;
  for (const row of rows) {
    try {
      const outcome = await sendClaimed(row);
      if (outcome === "sent") report.sent += 1;
      else if (outcome === "dead") report.dead += 1;
      else report.failed += 1;
    } catch (err) {
      swallow(`sweep-send ${row.id}`, err);
      report.failed += 1;
    }
  }

  report.durationMs = Date.now() - started;
  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional in-process sweep interval
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the keepalive precedent in lib/db.ts, and is OFF by default.
//
// On a serverless host there is no long-lived process, so this would never fire
// and relying on it would be a silent lie; under `next dev` HMR you can end up
// with several. The load-bearing mechanism is the endpoint plus an external
// cron. Enable this only for a long-lived self-hosted `next start`.
if (typeof window === "undefined") {
  const interval = readConfig().config?.sweepIntervalMs ?? 0;
  if (interval > 0) {
    const handle = setInterval(() => {
      void processDue(25).catch(() => {});
    }, Math.max(30_000, interval));
    if (typeof handle.unref === "function") handle.unref();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies one delivery receipt. Returns true when a row actually changed.
 *
 * Progress statuses are guarded by a rank comparison so an out-of-order webhook
 * — which Meta genuinely delivers — can never move a row backwards from read to
 * delivered. Timestamps go straight into to_timestamp() rather than through a
 * JS Date, avoiding a timezone round-trip on a value that is already absolute.
 */
export async function applyStatusUpdate(u: WebhookStatusUpdate): Promise<boolean> {
  try {
    if (u.status === "failed") {
      // A delivery failure is terminal and does NOT re-enter the retry ladder.
      // At this stage the causes are 131026 (recipient cannot receive), 131047
      // (outside the 24-hour window) or 470 — the identical template to the
      // identical number will fail identically, so retrying burns quota and
      // hides the real problem.
      const detail = u.errorTitle
        ? `Meta reported delivery failure: ${u.errorTitle}${u.errorCode ? ` (${u.errorCode})` : ""}`
        : "Meta reported delivery failure.";
      const rows = await query<{ id: number }>(
        `UPDATE notification_logs
            SET status = 'dead',
                failed_at = COALESCE(failed_at, to_timestamp($2)),
                last_error = $3, last_error_code = 'META_DELIVERY_FAILED',
                next_retry_at = NULL, locked_at = NULL
          WHERE message_id = $1
            AND status NOT IN ('read','dead')
          RETURNING id`,
        [u.messageId, u.timestampUnix, redactSecrets(detail)]
      );
      return rows.length > 0;
    }

    const rows = await query<{ id: number }>(
      `UPDATE notification_logs
          SET status = $2,
              sent_at      = COALESCE(sent_at,      CASE WHEN $2 IN ('sent','delivered','read') THEN to_timestamp($3) END),
              delivered_at = COALESCE(delivered_at, CASE WHEN $2 IN ('delivered','read')        THEN to_timestamp($3) END),
              read_at      = COALESCE(read_at,      CASE WHEN $2 = 'read'                       THEN to_timestamp($3) END),
              next_retry_at = NULL, locked_at = NULL
        WHERE message_id = $1
          AND (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
            <  (CASE $2     WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
        RETURNING id`,
      [u.messageId, u.status, u.timestampUnix]
    );
    return rows.length > 0;
  } catch (err) {
    swallow(`webhook ${u.messageId}`, err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin queries
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFilters {
  limit?: number;
  offset?: number;
  status?: string | null;
  type?: string | null;
  q?: string | null;
  includePayload?: boolean;
}

export async function listNotifications(f: ListFilters) {
  const limit = Math.max(1, Math.min(Number(f.limit) || 50, 200));
  const offset = Math.max(0, Number(f.offset) || 0);

  const params: any[] = [];
  const where: string[] = [];

  if (f.status) {
    params.push(f.status);
    where.push(`n.status = $${params.length}`);
  }
  if (f.type) {
    params.push(f.type);
    where.push(`n.type = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(
      `(n.receiver ILIKE $${params.length} OR n.receiver_phone ILIKE $${params.length}
        OR cp.name ILIKE $${params.length} OR w.name ILIKE $${params.length})`
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // payload can run to several KB per row, so it is excluded from the list
  // projection unless explicitly requested.
  const payloadCol = f.includePayload ? "n.payload," : "";

  const joins = `
    LEFT JOIN channel_partners cp ON n.subject_type = 'channel_partner' AND cp.id = n.subject_id
    LEFT JOIN walkin_enquiries w  ON n.subject_type = 'walkin_enquiry'  AND w.id  = n.subject_id`;

  params.push(limit, offset);
  const rows = await query(
    `SELECT n.id, n.channel, n.type, n.template_name,
            n.receiver, n.receiver_user_id, n.receiver_phone,
            n.subject_type, n.subject_id,
            n.status, n.message_id,
            n.retry_count, n.max_retries, n.next_retry_at,
            n.last_error, n.last_error_code,
            ${payloadCol}
            n.created_at, n.sent_at, n.delivered_at, n.read_at, n.failed_at,
            COALESCE(cp.name, w.name) AS subject_name
       FROM notification_logs n
       ${joins}
       ${whereSql}
      ORDER BY n.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const totalRows = await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM notification_logs n ${joins} ${whereSql}`,
    params.slice(0, params.length - 2)
  );

  return { rows, total: Number(totalRows[0]?.c ?? 0) };
}

export interface ReadinessReport {
  table_present: boolean;
  configuration: ReturnType<typeof configSummary>;
  templates: Array<{ key: string; name: string; paramCount: number }>;
  counts: Record<string, number>;
  due_now: number;
  stuck_sending: number;
  managers_missing_whatsapp: Array<{ id: number; name: string }>;
  migration?: string;
}

/**
 * The "is this thing ready?" answer, in one object.
 *
 * managers_missing_whatsapp is the highest-value field here: an unset
 * whatsapp_number is by far the most common cause of a manager never hearing
 * about their partners, and it produces no error anywhere else in the system.
 */
export async function readiness(): Promise<ReadinessReport> {
  const templates = Object.entries(TEMPLATE_REGISTRY).map(([key, def]) => ({
    key,
    name: def.name,
    paramCount: def.paramCount,
  }));

  const base: ReadinessReport = {
    table_present: true,
    configuration: configSummary(),
    templates,
    counts: {},
    due_now: 0,
    stuck_sending: 0,
    managers_missing_whatsapp: [],
  };

  try {
    const counts = await query<{ status: string; c: number }>(
      `SELECT status, COUNT(*)::int AS c FROM notification_logs GROUP BY status`
    );
    for (const r of counts) base.counts[r.status] = Number(r.c);

    const due = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM notification_logs
        WHERE status IN ('pending','failed') AND next_retry_at IS NOT NULL
          AND next_retry_at <= now() AND retry_count < max_retries`
    );
    base.due_now = Number(due[0]?.c ?? 0);

    const stuck = await query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM notification_logs WHERE status = 'sending'`
    );
    base.stuck_sending = Number(stuck[0]?.c ?? 0);
  } catch (err) {
    if (isMissingTable(err)) {
      base.table_present = false;
      base.migration = "scripts/migrations/2026-07-30_whatsapp_notification_logs.sql";
    } else {
      throw err;
    }
  }

  try {
    base.managers_missing_whatsapp = await query<{ id: number; name: string }>(
      `SELECT id, name FROM users
        WHERE is_active = true
          AND ${SOURCING_MANAGER_ROLE_PREDICATE}
          AND COALESCE(TRIM(whatsapp_number), '') = ''
        ORDER BY name`
    );
  } catch (err) {
    swallow("readiness-managers", err);
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad-hoc send (POST /api/whatsapp)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-off send from the manual endpoint. Unlike the notification path this DOES
 * throw, because its caller is a human waiting on an HTTP response who needs to
 * be told what went wrong.
 *
 * Logged with subject_id = NULL, which the partial uniqueness index exempts, so
 * the same number can be messaged repeatedly.
 */
export async function sendAdHocMessage(args: {
  phoneRaw: string;
  message?: string;
  template?: { name: string; params?: string[] };
  actor: string;
}): Promise<{ logId: number | null; messageId: string }> {
  const cfg = assertConfigured();

  const phone = toE164(args.phoneRaw, cfg.defaultCountryCode);
  if (!phone.ok) {
    throw new WhatsAppError("INVALID_PHONE", describeE164Failure(phone.reason), { retryable: false });
  }
  const to = toMetaRecipient(phone.e164);

  let request: unknown;
  let templateName: string | null = null;
  if (args.template?.name) {
    templateName = args.template.name;
    request = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: args.template.name,
        language: { code: cfg.templateLanguage },
        components: (args.template.params ?? []).length
          ? [
              {
                type: "body",
                parameters: (args.template.params ?? []).map((p) => ({
                  type: "text" as const,
                  text: String(p),
                })),
              },
            ]
          : [],
      },
    };
  } else {
    request = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: args.message ?? "" },
    };
  }

  let logId: number | null = null;
  try {
    logId = await insertLog({
      type: "manual",
      receiver: args.actor,
      receiverUserId: null,
      receiverPhone: phone.e164,
      subjectType: null,
      subjectId: null,
      templateName,
      status: "sending",
      payload: { request },
      lastError: null,
      lastErrorCode: null,
      nextRetryAt: false,
    });
  } catch (err) {
    // A missing table must not stop a human-initiated send from going out.
    swallow("adhoc-log", err);
  }

  try {
    const result = args.template?.name
      ? await sendTemplate(to, (request as any).template, cfg)
      : await sendText(to, args.message ?? "", cfg);

    if (logId) {
      await query(
        `UPDATE notification_logs
            SET status = 'sent', message_id = $2, sent_at = now(), retry_count = 1,
                locked_at = NULL,
                payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('response', $3::jsonb)
          WHERE id = $1`,
        [logId, result.messageId, JSON.stringify(redactDeep(result.raw))]
      ).catch((err) => swallow("adhoc-settle", err));
    }
    console.log(`[whatsapp] manual send to ${maskPhone(phone.e164)} by ${args.actor}`);
    return { logId, messageId: result.messageId };
  } catch (err) {
    const wa = WhatsAppError.from(err);
    if (logId) await settleDead(logId, wa.toLogString(), wa.code, 1, wa);
    throw wa;
  }
}
