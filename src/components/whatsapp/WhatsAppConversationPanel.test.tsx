// Component tests for the WhatsApp conversation panel.
//
// These cover the interaction contract the spec is explicit about and that a
// server-side test cannot reach: Enter sends while Shift+Enter does not (§2),
// a failed message stays visible and offers Retry (§3, §12), the composer is
// disabled while a send is in flight (§12), and the closed 24-hour window
// disables typing rather than letting the employee write into a void (§13).
//
// fetch is stubbed. The routes behind it have their own HTTP suite
// (whatsapp_http_test.cjs); what matters here is what the component DOES with
// each answer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WhatsAppConversationPanel from "./WhatsAppConversationPanel";
import { buildTheme } from "@/lib/crmTheme";

// The panel opens an EventSource. jsdom has none, and the realtime path is
// covered by whatsapp_realtime_test.cjs against a real server, so a stub that
// records construction is enough here.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  close() { this.readyState = 2; }
  /** Push a server event into the component, as the real stream would. */
  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}
(globalThis as any).EventSource = FakeEventSource;
(globalThis as any).EventSource.CONNECTING = 0;

const theme = buildTheme(false);

const conversation = {
  id: 42,
  leadId: 342,
  leadName: "Abhimanyu Prajapati",
  leadPhone: "9930816041",
  customerPhone: "+919930816041",
  customerProfileName: "Abhimanyu",
  matchState: "matched",
  candidateLeadIds: [],
  unreadCount: 1,
  lastMessageAt: new Date().toISOString(),
  lastMessagePreview: "Yes, I am available tomorrow.",
  lastMessageDirection: "inbound",
  assignedTo: "Megha",
  leadStatus: "Interested",
  followUpDate: "2026-08-26",
  leadIsLost: false,
  window: { open: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() },
};

const messages = [
  {
    id: "1", direction: "outbound", senderName: "Megha", senderRole: "Sales Manager",
    messageType: "text", messageText: "Hello Abhimanyu, are you available to discuss the property?",
    templateName: null, status: "read", errorCode: null, errorMessage: null,
    createdAt: new Date().toISOString(), sentAt: null, deliveredAt: null, readAt: null,
  },
  {
    id: "2", direction: "inbound", senderName: null, senderRole: null,
    messageType: "text", messageText: "Yes, I am available tomorrow.",
    templateName: null, status: "received", errorCode: null, errorMessage: null,
    createdAt: new Date().toISOString(), sentAt: null, deliveredAt: null, readAt: null,
  },
];

/** Builds a fetch stub; `overrides` lets one test change a single route. */
function stubFetch(overrides: Record<string, any> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const key = `${method} ${u.split("?")[0]}`;

    if (overrides[key]) return overrides[key](u, init);

    if (method === "GET" && u.startsWith("/api/whatsapp/conversations?")) {
      return json({ success: true, data: [conversation] });
    }
    if (method === "GET" && u === "/api/whatsapp/conversations/42") {
      return json({
        success: true,
        data: {
          ...conversation, canAssociate: false, candidates: [], messages,
        },
      });
    }
    if (method === "POST" && u === "/api/whatsapp/conversations/42/read") {
      return json({ success: true, data: { unreadCount: 0 } });
    }
    return json({ success: true, data: {} });
  });
}

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  FakeEventSource.instances = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Clicks the first conversation in the left-hand list.
 *
 * By role rather than by text: the list preview and the thread bubble carry the
 * SAME string (the preview is the last message), so a text query matches two
 * nodes once the thread is open and Testing Library throws on the ambiguity.
 */
async function openFirstConversation(user: ReturnType<typeof userEvent.setup>) {
  const item = await screen.findByRole("button", { name: /Abhimanyu/ });
  await user.click(item);
  // Wait on a string that exists ONLY in the thread — the outbound message.
  await screen.findByText(/are you available\s+to discuss the property/i);
}

async function openThread(fetchStub: ReturnType<typeof stubFetch>) {
  vi.stubGlobal("fetch", fetchStub);
  const user = userEvent.setup();
  render(
    <WhatsAppConversationPanel theme={theme} isDark={false} onClose={() => {}} />
  );
  await openFirstConversation(user);
  return user;
}

describe("WhatsAppConversationPanel", () => {
  it("renders the conversation history with both directions", async () => {
    await openThread(stubFetch());

    expect(
      screen.getByText(/are you available\s+to discuss the property/i)
    ).toBeInTheDocument();
    // Twice on purpose: once as the thread bubble, once as the list preview.
    expect(screen.getAllByText(/Yes, I am available tomorrow/).length).toBeGreaterThanOrEqual(2);
    // The outbound bubble is attributed; the inbound one is not.
    expect(screen.getByText(/Megha · Sales Manager/)).toBeInTheDocument();
  });

  it("shows the customer's name and number", async () => {
    await openThread(stubFetch());
    expect(screen.getAllByText(/Abhimanyu Prajapati/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("+919930816041").length).toBeGreaterThan(0);
  });

  it("opens a single SSE stream", async () => {
    await openThread(stubFetch());
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/whatsapp/events");
  });

  // ── spec §2: Enter sends, Shift+Enter makes a new line ──────────────────
  it("sends on Enter", async () => {
    // Captured from the override rather than read back off mock.calls, whose
    // tuple type does not carry the init argument.
    let sentBody: any = null;
    const send = vi.fn(async (_u: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? "{}"));
      return json({
        success: true,
        data: { ...messages[0], id: "99", messageText: "On my way", status: "sent" },
      });
    });
    const user = await openThread(
      stubFetch({ "POST /api/whatsapp/conversations/42/messages": send })
    );

    const box = screen.getByPlaceholderText(/Type your message/i);
    await user.type(box, "On my way");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sentBody.text).toBe("On my way");
    // Idempotency key, so a double submit cannot become two messages.
    expect(sentBody.clientToken).toBeTruthy();
  });

  it("does NOT send on Shift+Enter, and keeps the newline", async () => {
    const send = vi.fn(async () => json({ success: true, data: messages[0] }));
    const user = await openThread(
      stubFetch({ "POST /api/whatsapp/conversations/42/messages": send })
    );

    const box = screen.getByPlaceholderText(/Type your message/i) as HTMLTextAreaElement;
    await user.type(box, "first line");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(box, "second line");

    expect(send).not.toHaveBeenCalled();
    expect(box.value).toBe("first line\nsecond line");
  });

  it("does not send an empty or whitespace-only message", async () => {
    const send = vi.fn(async () => json({ success: true, data: messages[0] }));
    const user = await openThread(
      stubFetch({ "POST /api/whatsapp/conversations/42/messages": send })
    );

    const box = screen.getByPlaceholderText(/Type your message/i);
    await user.type(box, "   ");
    await user.keyboard("{Enter}");
    expect(send).not.toHaveBeenCalled();
  });

  // ── spec §3 / §12: failure is visible and retryable ─────────────────────
  it("keeps a failed message visible, shows why, and offers Retry", async () => {
    const failing = vi.fn(async () =>
      json({
        success: false,
        code: "META_API_ERROR",
        message: "Recipient cannot receive messages",
        data: {
          ...messages[0], id: "77", messageText: "This will fail",
          status: "failed", errorCode: "META_API_ERROR",
          errorMessage: "Recipient cannot receive messages",
        },
      })
    );
    const user = await openThread(
      stubFetch({ "POST /api/whatsapp/conversations/42/messages": failing })
    );

    await user.type(screen.getByPlaceholderText(/Type your message/i), "This will fail");
    await user.keyboard("{Enter}");

    // The draft is not silently discarded — the message is in the thread.
    expect(await screen.findByText("This will fail")).toBeInTheDocument();
    expect(screen.getAllByText(/Recipient cannot receive messages/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("retries a failed message against the retry endpoint", async () => {
    const retry = vi.fn(async () =>
      json({ success: true, data: { ...messages[0], id: "77", status: "sent" } })
    );
    const failing = vi.fn(async () =>
      json({
        success: false, code: "META_API_ERROR", message: "Temporary failure",
        data: {
          ...messages[0], id: "77", messageText: "Retry me",
          status: "failed", errorMessage: "Temporary failure",
        },
      })
    );
    const user = await openThread(
      stubFetch({
        "POST /api/whatsapp/conversations/42/messages": failing,
        "POST /api/whatsapp/messages/77/retry": retry,
      })
    );

    await user.type(screen.getByPlaceholderText(/Type your message/i), "Retry me");
    await user.keyboard("{Enter}");
    await screen.findByRole("button", { name: /Retry/i });

    await user.click(screen.getByRole("button", { name: /Retry/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });

  // ── spec §13: the closed window is explained, not worked around ─────────
  it("disables the composer and explains why when the 24h window is closed", async () => {
    const closed = {
      ...conversation,
      window: { open: false, expiresAt: null },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        if (method === "GET" && u.startsWith("/api/whatsapp/conversations?")) {
          return json({ success: true, data: [closed] });
        }
        if (method === "GET" && u === "/api/whatsapp/conversations/42") {
          return json({
            success: true,
            data: { ...closed, canAssociate: false, candidates: [], messages },
          });
        }
        return json({ success: true, data: { unreadCount: 0 } });
      })
    );

    const user = userEvent.setup();
    render(<WhatsAppConversationPanel theme={theme} isDark={false} onClose={() => {}} />);
    await openFirstConversation(user);

    expect(screen.getByText(/24-hour reply window is closed/i)).toBeInTheDocument();
    const box = screen.getByPlaceholderText(/only possible inside the 24-hour window/i);
    expect(box).toBeDisabled();
  });

  // ── spec §14: unread badges ─────────────────────────────────────────────
  it("shows an unread badge in the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.startsWith("/api/whatsapp/conversations?")) {
          return json({ success: true, data: [{ ...conversation, unreadCount: 3 }] });
        }
        return json({ success: true, data: {} });
      })
    );
    render(<WhatsAppConversationPanel theme={theme} isDark={false} onClose={() => {}} />);
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  // ── spec §5: an unmatched thread offers association to those who may ────
  it("offers candidate leads for an ambiguous thread", async () => {
    const ambiguous = {
      ...conversation,
      leadId: null, leadName: null, matchState: "ambiguous", candidateLeadIds: [207, 212],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        if (method === "GET" && u.startsWith("/api/whatsapp/conversations?")) {
          return json({ success: true, data: [ambiguous] });
        }
        if (method === "GET" && u === "/api/whatsapp/conversations/42") {
          return json({
            success: true,
            data: {
              ...ambiguous,
              canAssociate: true,
              candidates: [
                { id: 207, name: "Abhimanyu P", phone: "9930816041", assignedTo: "Megha", status: "New", isLost: false },
                { id: 212, name: "A Prajapati", phone: "9930816041", assignedTo: "Ravi", status: "Contacted", isLost: false },
              ],
              messages,
            },
          });
        }
        return json({ success: true, data: {} });
      })
    );

    const user = userEvent.setup();
    render(<WhatsAppConversationPanel theme={theme} isDark={false} onClose={() => {}} />);
    // Falls back to the WhatsApp profile name when there is no lead.
    await openFirstConversation(user);

    expect(await screen.findByText(/More than one lead has this number/i)).toBeInTheDocument();
    expect(screen.getByText("Abhimanyu P")).toBeInTheDocument();
    expect(screen.getByText("A Prajapati")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Link to this lead/i })).toHaveLength(2);
  });

  it("tells a sales manager that only an admin can link an orphan thread", async () => {
    const orphan = { ...conversation, leadId: null, leadName: null, matchState: "unmatched" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        if (method === "GET" && u.startsWith("/api/whatsapp/conversations?")) {
          return json({ success: true, data: [orphan] });
        }
        if (method === "GET" && u === "/api/whatsapp/conversations/42") {
          return json({
            success: true,
            data: { ...orphan, canAssociate: false, candidates: [], messages },
          });
        }
        return json({ success: true, data: {} });
      })
    );

    const user = userEvent.setup();
    render(<WhatsAppConversationPanel theme={theme} isDark={false} onClose={() => {}} />);
    await openFirstConversation(user);

    expect(
      await screen.findByText(/admin or site head can link this conversation/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Link to this lead/i })).toBeNull();
  });

  // ── spec §4/§7: a pushed message appears with no refetch ────────────────
  it("appends a message pushed over SSE without refetching the thread", async () => {
    const fetchStub = stubFetch();
    await openThread(fetchStub);

    const callsBefore = fetchStub.mock.calls.length;

    FakeEventSource.instances[0].emit({
      type: "message_created",
      conversationId: 42,
      leadId: 342,
      unreadCount: 1,
      ts: Date.now(),
      message: {
        id: "500", direction: "inbound", message_text: "One more thing…",
        message_type: "text", status: "received", created_at: new Date().toISOString(),
      },
    });

    // Twice, and both are wanted: the new bubble in the thread AND the refreshed
    // preview in the follow-ups list (spec §6 asks the list to show the latest
    // message, §14 to update it immediately).
    await waitFor(() =>
      expect(screen.getAllByText("One more thing…").length).toBe(2)
    );

    // The only new call permitted is the mark-read POST; the thread itself is
    // NOT refetched, which is the point of pushing the message body.
    const newCalls = fetchStub.mock.calls.slice(callsBefore).map((c) => String(c[0]));
    expect(newCalls.every((u) => u.includes("/read"))).toBe(true);
  });

  it("updates a message's delivery state from an SSE status push", async () => {
    await openThread(stubFetch());

    // Message 1 starts 'read'; drive a different one to 'delivered'.
    FakeEventSource.instances[0].emit({
      type: "message_status",
      conversationId: 42,
      leadId: 342,
      messageId: "1",
      status: "failed",
      errorMessage: "Recipient cannot receive messages",
      ts: Date.now(),
    });

    expect(await screen.findByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("ignores pushes for a different conversation", async () => {
    await openThread(stubFetch());

    FakeEventSource.instances[0].emit({
      type: "message_created",
      conversationId: 999,
      leadId: 1,
      unreadCount: 1,
      ts: Date.now(),
      message: {
        id: "600", direction: "inbound", message_text: "Belongs to another thread",
        message_type: "text", status: "received", created_at: new Date().toISOString(),
      },
    });

    await waitFor(() =>
      expect(screen.queryByText("Belongs to another thread")).toBeNull()
    );
  });
});
