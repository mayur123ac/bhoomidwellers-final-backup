// @vitest-environment node
//
// Two-way WhatsApp: the inbound webhook, lead matching, delivery-status
// transitions and the permission predicate.
//
// ── Why this drives the real webhook handler ────────────────────────────────
// The webhook is the one part of the feature that cannot be tested the way the
// app uses it: that would need a public URL, Meta's dashboard pointed at it, and
// a real customer sending real messages. So the tests build correctly-SIGNED
// synthetic Meta payloads and hand them to handleWebhookPost() — the same
// function the route calls, with signature verification, parsing, idempotency and
// the conversation counters all live. Only the network hop is absent.
//
// ── Why it does NOT wipe the database ───────────────────────────────────────
// The other integration suites call wipeAll() against a throwaway database. This
// one runs against the shared Neon test branch, which carries 300-odd real-shaped
// leads that the matching logic is worth exercising against. It therefore creates
// only rows with its own timestamped phone numbers and deletes exactly those in
// afterAll. Nothing pre-existing is touched.
//
// Skips itself unless a business number is mapped — see
// scripts/seed_whatsapp_number.cjs.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ── .env.local, the way Next resolves it (real env wins) ───────────────────
const ENV_PATH = path.join(process.cwd(), ".env.local");
if (fs.existsSync(ENV_PATH)) {
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "";
const HAS_DB = Boolean(process.env.DATABASE_URL);

// A production endpoint must never be the target of a suite that writes.
const isProd = /ep-long-cloud|ep-mute-credit/.test(process.env.DATABASE_URL ?? "");
const ready = HAS_DB && !isProd && Boolean(PHONE_NUMBER_ID) && Boolean(APP_SECRET);

const describeIf = ready ? describe : describe.skip;

// ── module handles, imported lazily so the skip path costs nothing ─────────
let handleWebhookPost: any, handleVerification: any;
let conv: any, access: any, db: any;

let ORG = "";
let stamp = "";
let NEW_CUSTOMER = "", UNKNOWN = "", DUPLICATE = "";
const createdLeads: number[] = [];
const createdPhones: string[] = [];

// ── payload builders ───────────────────────────────────────────────────────
function inboundPayload(o: {
  from: string; text?: string; wamid: string; name?: string;
  ts?: number; type?: string; phoneNumberId?: string;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: {
            display_phone_number: "15550001111",
            phone_number_id: o.phoneNumberId ?? PHONE_NUMBER_ID,
          },
          contacts: [{ profile: { name: o.name ?? "Test Customer" }, wa_id: o.from }],
          messages: [{
            from: o.from,
            id: o.wamid,
            timestamp: String(o.ts ?? Math.floor(Date.now() / 1000)),
            type: o.type ?? "text",
            ...(o.type && o.type !== "text" ? {} : { text: { body: o.text ?? "" } }),
          }],
        },
      }],
    }],
  };
}

function statusPayload(o: { wamid: string; status: string; recipient: string; ts?: number }) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550001111", phone_number_id: PHONE_NUMBER_ID },
          statuses: [{
            id: o.wamid,
            status: o.status,
            timestamp: String(o.ts ?? Math.floor(Date.now() / 1000)),
            recipient_id: o.recipient,
          }],
        },
      }],
    }],
  };
}

/** Signs the payload exactly as Meta does: HMAC-SHA256 over the raw bytes. */
function post(payload: unknown, opts: { badSignature?: boolean } = {}) {
  const raw = JSON.stringify(payload);
  const sig = opts.badSignature
    ? "sha256=" + "0".repeat(64)
    : "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex");
  return handleWebhookPost({ rawBody: raw, signature: sig });
}

async function newLead(name: string, phone10: string, assignedTo: string): Promise<number> {
  const rows: Array<{ id: number }> = await db.query(
    `INSERT INTO public.walkin_enquiries (name, phone, assigned_to, status, organization_id, sr_no)
     VALUES ($1,$2,$3,'New',$4,(SELECT COALESCE(MAX(sr_no),0)+1 FROM public.walkin_enquiries))
     RETURNING id`,
    [name, phone10, assignedTo, ORG]
  );
  createdLeads.push(rows[0].id);
  return rows[0].id;
}

const convByPhone = (p: string) =>
  db.query(
    `SELECT * FROM public.whatsapp_conversations WHERE organization_id=$1 AND customer_phone=$2`,
    [ORG, `+${p}`]
  );

describeIf("WhatsApp two-way messaging", () => {
  beforeAll(async () => {
    ({ handleWebhookPost, handleVerification } = await import("@/webhooks/whatsapp.webhook"));
    conv = await import("@/lib/whatsappConversations");
    access = await import("@/lib/whatsappAccess");
    db = await import("@/lib/db");

    const rows = await db.query(
      `SELECT organization_id FROM public.whatsapp_business_numbers WHERE phone_number_id=$1`,
      [PHONE_NUMBER_ID]
    );
    if (rows.length === 0) {
      throw new Error(
        "No business-number mapping. Run: node scripts/seed_whatsapp_number.cjs <org-slug>"
      );
    }
    ORG = rows[0].organization_id;

    // Timestamped so reruns cannot collide with each other or with real leads.
    //
    // Shaped like genuine Indian mobiles — "91" + a 10-digit number starting 9 —
    // because that is what Meta puts in wa_id, and because a fabricated number of
    // the wrong length normalizes differently from the 10-digit form stored on
    // the lead, which would silently split one customer across two threads.
    stamp = String(Date.now()).slice(-7);
    NEW_CUSTOMER = `919${stamp}01`;
    UNKNOWN = `919${stamp}02`;
    DUPLICATE = `919${stamp}03`;
    createdPhones.push(NEW_CUSTOMER, UNKNOWN, DUPLICATE);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    for (const p of createdPhones) {
      await db.query(
        `DELETE FROM public.whatsapp_messages WHERE conversation_id IN
           (SELECT id FROM public.whatsapp_conversations WHERE customer_phone=$1)`,
        [`+${p}`]
      );
      await db.query(`DELETE FROM public.whatsapp_conversations WHERE customer_phone=$1`, [`+${p}`]);
    }
    if (createdLeads.length) {
      await db.query(`DELETE FROM public.walkin_enquiries WHERE id = ANY($1)`, [createdLeads]);
    }
    await db.query(
      `DELETE FROM public.whatsapp_webhook_failures WHERE phone_number_id='999999999999999'`
    );
  }, 60_000);

  // ════════════════════════════════════════════════════════════════════════
  describe("phone normalization convergence", () => {
    // THE invariant the whole feature rests on.
    //
    // A conversation is keyed on customer_phone in E.164. Two code paths write
    // that key: the webhook, from Meta's wa_id ("919930816041"), and open-from-
    // lead, from walkin_enquiries.phone (whatever the front desk typed). If those
    // two disagree for the same human being, the CRM opens TWO threads for one
    // WhatsApp conversation and the employee sees an empty panel while the
    // customer's reply sits in the other one.
    //
    // Every stored format in this table must converge on the same string.
    it("agrees between Meta's wa_id and every stored lead format", async () => {
      const { toE164 } = await import("@/lib/phone");
      const expected = "+919930816041";

      for (const stored of [
        "919930816041",     // what Meta sends as wa_id
        "9930816041",       // bare 10-digit, the common case
        "09930816041",      // national trunk prefix
        "+91 99308 16041",  // pasted from a contact card
        "+919930816041",
        "0091 9930816041",  // international access prefix
        "99308-16041",
      ]) {
        const r = toE164(stored);
        expect(r.ok, `${stored} failed to parse`).toBe(true);
        expect(r.ok && r.e164, `${stored} normalized wrongly`).toBe(expected);
      }
    });

    it("refuses to guess a country code for a non-mobile", async () => {
      const { toE164 } = await import("@/lib/phone");
      // A 10-digit landline would otherwise become a plausible wrong number.
      expect(toE164("0221234567").ok).toBe(false);
      expect(toE164("").ok).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("webhook handshake", () => {
    it("echoes the challenge as bare text for a correct verify token", () => {
      const r = handleVerification({
        mode: "subscribe",
        token: process.env.VERIFY_TOKEN!,
        challenge: "CHAL123",
      });
      expect(r.status).toBe(200);
      expect(r.body).toBe("CHAL123");
      // JSON quoting here would make Meta reject the subscription.
      expect(r.contentType).toBe("text/plain");
    });

    it("rejects a wrong verify token", () => {
      const r = handleVerification({ mode: "subscribe", token: "wrong", challenge: "C" });
      expect(r.status).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("signature verification", () => {
    it("rejects a forged signature and stores nothing", async () => {
      const wamid = `wamid.FORGED${stamp}`;
      const r = await post(inboundPayload({ from: UNKNOWN, text: "forged", wamid }), {
        badSignature: true,
      });
      expect(r.status).toBe(401);

      const rows = await db.query(
        `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE whatsapp_message_id=$1`,
        [wamid]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("unknown number (spec §5)", () => {
    it("parks the thread as unmatched rather than attaching it at random", async () => {
      const r = await post(
        inboundPayload({
          from: UNKNOWN,
          text: "Hello, I saw your hoarding",
          wamid: `wamid.UNK${stamp}`,
          name: "Walk By",
        })
      );
      expect(r.status).toBe(200);
      expect(r.body.inboundStored).toBe(1);

      const rows = await convByPhone(UNKNOWN);
      expect(rows).toHaveLength(1);
      expect(rows[0].match_state).toBe("unmatched");
      expect(rows[0].lead_id).toBeNull();
      expect(rows[0].unread_count).toBe(1);
      expect(rows[0].customer_profile_name).toBe("Walk By");
      // Opens the 24-hour window.
      expect(rows[0].last_inbound_at).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("duplicate webhook delivery (spec §10)", () => {
    it("is idempotent and does not double-count unread", async () => {
      const wamid = `wamid.UNK${stamp}`; // same id as the message already stored
      const r = await post(
        inboundPayload({ from: UNKNOWN, text: "Hello, I saw your hoarding", wamid, name: "Walk By" })
      );
      expect(r.status).toBe(200);
      expect(r.body.inboundStored).toBe(0);
      expect(r.body.inboundDuplicates).toBe(1);

      const msgs = await db.query(
        `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE whatsapp_message_id=$1`,
        [wamid]
      );
      expect(msgs[0].n).toBe(1);

      const rows = await convByPhone(UNKNOWN);
      expect(rows[0].unread_count).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("known number", () => {
    it("matches the message to its lead", async () => {
      const leadId = await newLead("WA Test Lead", NEW_CUSTOMER.slice(2), "Megha");
      const wamid = `wamid.KNOWN${stamp}`;

      const r = await post(
        inboundPayload({ from: NEW_CUSTOMER, text: "Yes, tomorrow works.", wamid })
      );
      expect(r.body.inboundStored).toBe(1);

      const rows = await convByPhone(NEW_CUSTOMER);
      expect(rows[0].match_state).toBe("matched");
      expect(rows[0].lead_id).toBe(leadId);
      expect(rows[0].last_message_preview).toBe("Yes, tomorrow works.");
      expect(rows[0].last_message_direction).toBe("inbound");

      const msg = await db.query(
        `SELECT lead_id, status FROM public.whatsapp_messages WHERE whatsapp_message_id=$1`,
        [wamid]
      );
      expect(msg[0].lead_id).toBe(leadId);
      expect(msg[0].status).toBe("received");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("duplicate CRM leads (spec §5)", () => {
    it("flags the thread ambiguous instead of picking one", async () => {
      await newLead("Dup Lead A", DUPLICATE.slice(2), "Megha");
      await newLead("Dup Lead B", DUPLICATE.slice(2), "Ravi");

      const r = await post(
        inboundPayload({ from: DUPLICATE, text: "Which flat was it?", wamid: `wamid.DUP${stamp}` })
      );
      expect(r.body.inboundStored).toBe(1);

      const rows = await convByPhone(DUPLICATE);
      expect(rows[0].match_state).toBe("ambiguous");
      expect(rows[0].lead_id).toBeNull();
      expect(rows[0].candidate_lead_ids).toHaveLength(2);
    });

    it("resolves on explicit association and backfills the history", async () => {
      const rows = await convByPhone(DUPLICATE);
      const conversationId = rows[0].id;
      const chosen = rows[0].candidate_lead_ids[0];

      const res = await conv.associateConversation({
        organizationId: ORG,
        conversationId,
        leadId: chosen,
      });
      expect(res.ok).toBe(true);
      expect(res.conversation.match_state).toBe("matched");

      // The lead's audit trail must start at the customer's first word.
      const msgs = await db.query(
        `SELECT lead_id FROM public.whatsapp_messages WHERE conversation_id=$1`,
        [conversationId]
      );
      expect(msgs.every((m: any) => m.lead_id === chosen)).toBe(true);
    });

    it("refuses to re-point an already-matched thread", async () => {
      const rows = await convByPhone(DUPLICATE);
      const other = rows[0].candidate_lead_ids[1];
      const res = await conv.associateConversation({
        organizationId: ORG,
        conversationId: rows[0].id,
        leadId: other,
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("already_matched");
    });

    it("refuses a lead from another tenant", async () => {
      const rows = await convByPhone(UNKNOWN);
      const res = await conv.associateConversation({
        organizationId: ORG,
        conversationId: rows[0].id,
        leadId: 999_999_999,
      });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("lead_not_found");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("outbound lifecycle (spec §3)", () => {
    it("starts in 'sending' and freezes the sender identity", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      const out = await conv.createOutbound({
        organizationId: ORG,
        conversationId: rows[0].id,
        leadId: rows[0].lead_id,
        senderUserId: null,
        senderName: "Megha",
        senderRole: "Sales Manager",
        text: "Perfect. What time would suit you?",
        clientToken: `tok-${stamp}`,
      });

      expect(out.message.status).toBe("sending");
      expect(out.message.sender_name).toBe("Megha");
      expect(out.message.sender_role).toBe("Sales Manager");
      expect(out.message.whatsapp_message_id).toBeNull();
    });

    it("treats a repeated clientToken as a double-submit, not a second message", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      const again = await conv.createOutbound({
        organizationId: ORG,
        conversationId: rows[0].id,
        leadId: rows[0].lead_id,
        senderUserId: null,
        senderName: "Megha",
        senderRole: "Sales Manager",
        text: "Perfect. What time would suit you?",
        clientToken: `tok-${stamp}`,
      });
      expect(again.duplicate).toBe(true);
    });

    it("moves through sent → delivered → read from webhook receipts", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      const msgs = await db.query(
        `SELECT id FROM public.whatsapp_messages
          WHERE conversation_id=$1 AND direction='outbound' ORDER BY id LIMIT 1`,
        [rows[0].id]
      );
      const messageId = msgs[0].id;
      const wamid = `wamid.OUT${stamp}`;

      const sent = await conv.markOutboundSent(messageId, wamid);
      expect(sent.status).toBe("sent");
      expect(sent.whatsapp_message_id).toBe(wamid);

      const d = await post(statusPayload({ wamid, status: "delivered", recipient: NEW_CUSTOMER }));
      expect(d.body.conversationUpdated).toBe(1);
      let cur = await db.query(
        `SELECT status, delivered_at FROM public.whatsapp_messages WHERE id=$1`,
        [messageId]
      );
      expect(cur[0].status).toBe("delivered");
      expect(cur[0].delivered_at).not.toBeNull();

      const rd = await post(statusPayload({ wamid, status: "read", recipient: NEW_CUSTOMER }));
      expect(rd.body.conversationUpdated).toBe(1);
      cur = await db.query(`SELECT status FROM public.whatsapp_messages WHERE id=$1`, [messageId]);
      expect(cur[0].status).toBe("read");
    });

    it("does not regress a read message when a late 'delivered' arrives", async () => {
      // Routine, not exotic: receipts are generated on the handset and batched,
      // so they arrive out of order.
      const wamid = `wamid.OUT${stamp}`;
      const late = await post(statusPayload({ wamid, status: "delivered", recipient: NEW_CUSTOMER }));
      expect(late.body.conversationUpdated).toBe(0);

      const rows = await db.query(
        `SELECT status FROM public.whatsapp_messages WHERE whatsapp_message_id=$1`,
        [wamid]
      );
      expect(rows[0].status).toBe("read");
    });

    it("records a failure with a reason the UI can show", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      const out = await conv.createOutbound({
        organizationId: ORG,
        conversationId: rows[0].id,
        leadId: rows[0].lead_id,
        senderUserId: null,
        senderName: "Megha",
        senderRole: "Sales Manager",
        text: "This one fails",
        clientToken: `tok-fail-${stamp}`,
      });
      const failed = await conv.markOutboundFailed(
        out.message.id,
        "META_API_ERROR",
        "Simulated: recipient cannot receive messages"
      );
      expect(failed.status).toBe("failed");
      expect(failed.error_message).toMatch(/recipient cannot receive/);
      expect(failed.failed_at).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("status transition rules", () => {
    it("only moves forward", () => {
      expect(conv.isForwardTransition("sending", "sent")).toBe(true);
      expect(conv.isForwardTransition("sent", "delivered")).toBe(true);
      expect(conv.isForwardTransition("delivered", "read")).toBe(true);
      expect(conv.isForwardTransition("read", "delivered")).toBe(false);
      expect(conv.isForwardTransition("delivered", "sent")).toBe(false);
    });

    it("cannot fail a message that already reached the handset", () => {
      expect(conv.isForwardTransition("sending", "failed")).toBe(true);
      expect(conv.isForwardTransition("sent", "failed")).toBe(true);
      expect(conv.isForwardTransition("delivered", "failed")).toBe(false);
      expect(conv.isForwardTransition("read", "failed")).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("unmapped business number", () => {
    it("refuses to guess a tenant, answers 200, and logs the failure", async () => {
      const r = await post(
        inboundPayload({
          from: UNKNOWN,
          text: "wrong number id",
          wamid: `wamid.NOMAP${stamp}`,
          phoneNumberId: "999999999999999",
        })
      );
      // 200 because sustained non-2xx makes Meta disable the subscription.
      expect(r.status).toBe(200);
      expect(r.body.inboundUnroutable).toBe(1);
      expect(r.body.inboundStored).toBe(0);

      const failures = await db.query(
        `SELECT reason FROM public.whatsapp_webhook_failures
          WHERE phone_number_id='999999999999999' ORDER BY id DESC LIMIT 1`
      );
      expect(failures[0]?.reason).toBe("unmapped_number");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("24-hour window (spec §13)", () => {
    it("is open just after an inbound message", () => {
      expect(conv.windowState(new Date()).open).toBe(true);
    });
    it("is closed 25 hours later", () => {
      expect(conv.windowState(new Date(Date.now() - 25 * 3600_000)).open).toBe(false);
    });
    it("is closed when the customer has never written", () => {
      expect(conv.windowState(null).open).toBe(false);
      expect(conv.windowState(null).expiresAt).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("late adoption", () => {
    it("adopts an orphan thread once the lead is created", async () => {
      const leadId = await newLead("Late Lead", UNKNOWN.slice(2), "Megha");

      const r = await post(
        inboundPayload({ from: UNKNOWN, text: "Still interested", wamid: `wamid.LATE${stamp}` })
      );
      expect(r.body.inboundStored).toBe(1);

      const rows = await convByPhone(UNKNOWN);
      expect(rows[0].match_state).toBe("matched");
      expect(rows[0].lead_id).toBe(leadId);
      expect(rows[0].unread_count).toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("unread counting (spec §14)", () => {
    it("clears, and clearing twice is idempotent", async () => {
      const rows = await convByPhone(UNKNOWN);
      expect(await conv.markConversationRead(ORG, rows[0].id)).toBe(0);
      expect(await conv.markConversationRead(ORG, rows[0].id)).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("permissions (spec §8)", () => {
    const org = () => ORG;
    const admin = () => ({ userId: 1, name: "Admin", role: "Admin", organizationId: org() });
    const megha = () => ({ userId: 2, name: "Megha", role: "Sales Manager", organizationId: org() });
    const ravi = () => ({ userId: 3, name: "Ravi", role: "Sales Manager", organizationId: org() });
    const head = () => ({ userId: 4, name: "Head", role: "Site Head", organizationId: org() });
    const sourcing = () => ({
      userId: 5, name: "Sourcer", role: "Sourcing Manager", organizationId: org(),
    });

    const meghasLead = { leadId: 1, matchState: "matched", assignedTo: "Megha" };
    const orphan = { leadId: null, matchState: "unmatched" };

    it("lets an admin see everything", () => {
      expect(access.canViewerSee(admin(), meghasLead)).toBe(true);
      expect(access.canViewerSee(admin(), orphan)).toBe(true);
    });

    it("lets an owner see their own lead's conversation", () => {
      expect(access.canViewerSee(megha(), meghasLead)).toBe(true);
    });

    it("does NOT let another sales manager see it", () => {
      expect(access.canViewerSee(ravi(), meghasLead)).toBe(false);
    });

    it("matches names case- and whitespace-insensitively", () => {
      // The same person is entered as "Megha", "megha " and "MEGHA" by different
      // people at the front desk; an exact match hides their own leads from them.
      expect(access.canViewerSee({ ...megha(), name: " megha " }, meghasLead)).toBe(true);
    });

    it("hides unmatched threads from a sales manager but not a site head", () => {
      expect(access.canViewerSee(megha(), orphan)).toBe(false);
      expect(access.canViewerSee(head(), orphan)).toBe(true);
    });

    it("lets a site head see a lead they oversee", () => {
      expect(
        access.canViewerSee(head(), {
          leadId: 2, matchState: "matched", overseeingSiteHead: "Head",
        })
      ).toBe(true);
    });

    it("fails closed for a role with no ownership columns", () => {
      expect(access.canViewerSee(sourcing(), meghasLead)).toBe(false);
      expect(access.conversationScope(sourcing(), 2).sql).toBe("FALSE");
    });

    it("restricts association to admin and site head", () => {
      expect(access.canAssociateConversations("Admin")).toBe(true);
      expect(access.canAssociateConversations("Site Head")).toBe(true);
      expect(access.canAssociateConversations("Sales Manager")).toBe(false);
      expect(access.canAssociateConversations("Receptionist")).toBe(false);
    });

    it("keeps the SQL predicate and the in-process check in agreement", async () => {
      const scope = access.conversationScope(megha(), 2, "c", "l");
      const rows = await db.query(
        `SELECT c.id FROM public.whatsapp_conversations c
           LEFT JOIN public.walkin_enquiries l ON l.id = c.lead_id
          WHERE c.organization_id = $1 AND ${scope.sql}`,
        [ORG, ...scope.params]
      );
      const ids = rows.map((r: any) => r.id);

      const mine = await convByPhone(NEW_CUSTOMER);   // assigned_to = Megha
      const dup = await convByPhone(DUPLICATE);       // associated to Dup Lead A (Megha)

      expect(ids).toContain(mine[0].id);
      expect(ids).toContain(dup[0].id);

      const raviScope = access.conversationScope(ravi(), 2, "c", "l");
      const raviRows = await db.query(
        `SELECT c.id FROM public.whatsapp_conversations c
           LEFT JOIN public.walkin_enquiries l ON l.id = c.lead_id
          WHERE c.organization_id = $1 AND ${raviScope.sql}`,
        [ORG, ...raviScope.params]
      );
      expect(raviRows.map((r: any) => r.id)).not.toContain(mine[0].id);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("deleting a lead that has a conversation", () => {
    // Regression test. whatsapp_conversations.lead_id is ON DELETE SET NULL, and
    // the CHECK constraint requires match_state = 'matched' to agree with
    // lead_id IS NOT NULL. Without the BEFORE DELETE trigger the referential
    // action leaves the two disagreeing, the constraint fires, and the DELETE is
    // rolled back — which would break lib/leadDeletion.ts for every lead that had
    // ever exchanged a WhatsApp message.
    it("succeeds, and orphans the thread instead of destroying the history", async () => {
      const phone = `919${String(Date.now()).slice(-7)}77`;
      createdPhones.push(phone);

      const leadId = await newLead("Doomed Lead", phone.slice(2), "Megha");
      await post(
        inboundPayload({ from: phone, text: "About to be deleted", wamid: `wamid.DEL${stamp}` })
      );

      const before = await convByPhone(phone);
      expect(before[0].match_state).toBe("matched");
      expect(before[0].lead_id).toBe(leadId);
      const conversationId = before[0].id;

      // The operation that used to fail.
      await expect(
        db.query(`DELETE FROM public.walkin_enquiries WHERE id = $1`, [leadId])
      ).resolves.toBeDefined();

      const after = await db.query(
        `SELECT lead_id, match_state FROM public.whatsapp_conversations WHERE id = $1`,
        [conversationId]
      );
      expect(after[0].lead_id).toBeNull();
      expect(after[0].match_state).toBe("unmatched");

      // The messages survive — they are the evidence in a dispute.
      const msgs = await db.query(
        `SELECT count(*)::int AS n FROM public.whatsapp_messages WHERE conversation_id = $1`,
        [conversationId]
      );
      expect(msgs[0].n).toBe(1);

      // Already deleted; keep afterAll from trying again.
      const i = createdLeads.indexOf(leadId);
      if (i > -1) createdLeads.splice(i, 1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  describe("tenant isolation", () => {
    const OTHER = "00000000-0000-0000-0000-000000000000";

    it("will not clear another tenant's thread", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      expect(await conv.markConversationRead(OTHER, rows[0].id)).toBeNull();
    });

    it("fails closed on a cross-tenant visibility lookup", async () => {
      const rows = await convByPhone(NEW_CUSTOMER);
      const v = await conv.loadVisibility(OTHER, rows[0].id);
      expect(v.leadId).toBeNull();
      expect(v.matchState).toBe("unmatched");
    });

    it("will not route an inbound message without a mapping", async () => {
      expect(await conv.organizationForPhoneNumberId("does-not-exist")).toBeNull();
    });
  });
});
