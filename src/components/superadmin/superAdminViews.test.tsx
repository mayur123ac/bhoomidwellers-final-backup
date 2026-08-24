// Render coverage for the three new Super Admin screens and the CRM-side panel.
//
// TypeScript proves the props line up; it does not prove a component mounts. A
// client component can typecheck and still throw on first paint — a hook used
// after an early return, a `.map` over something the API sends as null, a
// palette key that does not exist. These tests mount each screen against a
// mocked API and assert the things a reviewer would look for on screen.
//
// The security assertions are the point of the last two: the user table must
// render dots and never a credential, and the panel must not offer a reveal.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { superAdminTheme } from "./theme";
import SystemUpdatesView from "./SystemUpdatesView";
import OrganizationDetailView from "./OrganizationDetailView";
import CrmUpdatesNotification from "@/components/CrmUpdatesNotification";

const t = superAdminTheme(true);

const ORG_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const UPDATE_ROWS = [
  {
    id: 1, version: "v2.1.4", title: "UI/UX Upgrade Released",
    description: "Rebuilt **navigation** and a new dark mode.", type: "Feature",
    features: ["Faster search", "New dark mode"], isImportant: false,
    status: "published", audienceType: "all_users",
    createdBy: "Platform Operator", publishedBy: "Platform Operator",
    createdAt: "2026-08-20T10:00:00Z", publishedAt: "2026-08-21T10:00:00Z",
    updatedAt: "2026-08-21T10:00:00Z", readCount: 4,
  },
  {
    id: 2, version: "v2.2.0", title: "Scheduled Maintenance",
    description: "Planned downtime.", type: "Maintenance",
    features: [], isImportant: true,
    status: "draft", audienceType: "all_users",
    createdBy: "Platform Operator", publishedBy: null,
    createdAt: "2026-08-22T10:00:00Z", publishedAt: null,
    updatedAt: "2026-08-22T10:00:00Z", readCount: 0,
  },
];

const ORG_USERS = {
  organization: { id: ORG_ID, name: "Bhoomi Dwellers", status: "active" },
  counts: { total: 2, active: 2, loggedIn: 1 },
  users: [
    {
      id: 11, name: "Asha Menon", email: "asha@example.test", role: "Admin",
      status: "active", passwordStatus: "set", loginStatus: "online",
      activeSessions: 1, currentLoginAt: "2026-08-24T09:00:00Z",
      device: "Windows PC / Chrome", lastLoginAt: "2026-08-24T09:00:00Z",
      lastActivityAt: "2026-08-24T09:20:00Z", createdAt: "2026-05-02T09:15:00Z",
    },
    {
      id: 12, name: "Rakesh Patil", email: "rakesh@example.test", role: "Sales Manager",
      status: "inactive", passwordStatus: "not_set", loginStatus: "offline",
      activeSessions: 0, currentLoginAt: null, device: null,
      lastLoginAt: "2026-08-01T09:00:00Z", lastActivityAt: null,
      createdAt: "2026-06-02T09:15:00Z",
    },
  ],
};

const ORG_META = {
  id: ORG_ID, name: "Bhoomi Dwellers", status: "active",
  created_at: "2026-05-02T09:15:00Z", leads: 314, bookings: 10, projects: 6,
  last_activity: "2026-08-24T09:20:00Z",
};

/** Routes a mocked fetch by URL so each screen sees the shape it expects. */
function mockApi(overrides: Record<string, unknown> = {}) {
  // The init parameter is declared even though the mock ignores it: the tests
  // assert on the method and body the components send, and a one-argument mock
  // makes call[1] a tuple index that does not exist.
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body =
      url.includes("/api/platform/updates") ? { success: true, data: UPDATE_ROWS }
      : url.includes(`/organizations/${ORG_ID}/users`) ? { success: true, data: ORG_USERS }
      : url.includes(`/organizations/${ORG_ID}`) ? { success: true, data: ORG_META }
      : url.includes("/api/updates") ? {
          success: true,
          data: [{
            id: 1, version: "2.1.4", title: "UI/UX Upgrade Released",
            description: "Rebuilt **navigation**.", category: "Feature",
            features: ["Faster search"], is_important: true,
            published_at: "2026-08-21T10:00:00Z", created_at: "2026-08-20T10:00:00Z",
            has_read: false,
          }],
          unreadCount: 1,
        }
      : { success: true, data: [] };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...(body as object), ...overrides }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => { mockApi(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("SystemUpdatesView", () => {
  it("renders the management table with every column the brief names", async () => {
    render(<SystemUpdatesView t={t} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    for (const header of ["Version", "Title", "Type", "Status", "Audience", "Published", "Created By"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    // The primary action, worded as specified.
    expect(screen.getByText("Create Update")).toBeInTheDocument();
  });

  it("distinguishes a draft from a published update, and offers the right verb", async () => {
    render(<SystemUpdatesView t={t} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    // Both states are on screen, each with its opposite action.
    expect(screen.getAllByText("published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("draft").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unpublish").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Publish").length).toBeGreaterThan(0);
  });

  it("confirms before publishing, naming what will happen", async () => {
    const user = userEvent.setup();
    render(<SystemUpdatesView t={t} />);
    await screen.findAllByText("Scheduled Maintenance");

    await user.click(screen.getAllByText("Publish")[0]);
    const dialog = (await screen.findAllByRole("dialog"))[0];
    expect(within(dialog).getByText(/every CRM user/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Publish Update")).toBeInTheDocument();
  });

  it("previews an update as the formatted body users will see", async () => {
    const user = userEvent.setup();
    render(<SystemUpdatesView t={t} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    await user.click(screen.getAllByText("View")[0]);
    const dialog = (await screen.findAllByRole("dialog"))[0];
    // The markdown is RENDERED, not printed: the asterisks are gone and the
    // word is emphasised instead.
    expect(within(dialog).queryByText(/\*\*navigation\*\*/)).toBeNull();
    expect(within(dialog).getByText("navigation").tagName).toBe("STRONG");
    expect(within(dialog).getByText("Faster search")).toBeInTheDocument();
  });

  it("opens a create form with the six types and no status field", async () => {
    const user = userEvent.setup();
    render(<SystemUpdatesView t={t} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    await user.click(screen.getByText("Create Update"));
    const dialog = (await screen.findAllByRole("dialog"))[0];

    const typeSelect = within(dialog).getByLabelText("Type") as HTMLSelectElement;
    expect(Array.from(typeSelect.options).map(o => o.value)).toEqual([
      "Update", "Important", "Feature", "Improvement", "Fix", "Maintenance",
    ]);
    // Draft vs publish is decided by which button is pressed, so there is no
    // status control that could broadcast a draft by accident.
    expect(within(dialog).queryByLabelText("Status")).toBeNull();
    expect(within(dialog).getByText("Save Draft")).toBeInTheDocument();
    expect(within(dialog).getByText("Publish Update")).toBeInTheDocument();
    // The hint sits inside the <label>, as it does in AddOrganizationModal, so
    // the accessible name carries it too — matched by prefix rather than exactly.
    expect(within(dialog).getByLabelText(/^Audience/)).toHaveValue("All Users");
  });
});

describe("OrganizationDetailView", () => {
  const renderView = () =>
    render(
      <OrganizationDetailView
        t={t}
        organizationId={ORG_ID}
        fallbackName="Bhoomi Dwellers"
        onBack={() => {}}
        onOrgChanged={() => {}}
      />,
    );

  it("shows the organization header and the four security tiles", async () => {
    renderView();
    await screen.findByText("Organization Users");

    expect(screen.getAllByText("Bhoomi Dwellers").length).toBeGreaterThan(0);
    expect(screen.getByText(ORG_ID)).toBeInTheDocument();
    for (const tile of ["Total Users", "Active Users", "Currently Logged In", "Organization Status"]) {
      expect(screen.getByText(tile)).toBeInTheDocument();
    }
  });

  it("renders the user table with the columns the brief lists", async () => {
    renderView();
    await screen.findByText("Organization Users");

    for (const header of ["ID", "Name", "Role", "Email", "Password", "Login", "Last Login", "Last Activity"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Asha Menon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("asha@example.test").length).toBeGreaterThan(0);
  });

  it("shows the password only as dots, with no way to reveal one", async () => {
    const { container } = renderView();
    await screen.findByText("Organization Users");

    expect(screen.getAllByText("••••••••").length).toBe(ORG_USERS.users.length * 2); // table + cards
    expect(screen.getAllByText("Password Set").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No password").length).toBeGreaterThan(0);

    // No reveal affordance of any kind, and no password input on the page until
    // the operator opens Change Password.
    expect(screen.queryByText(/show password/i)).toBeNull();
    expect(screen.queryByText(/reveal/i)).toBeNull();
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0);
  });

  it("marks a live session Active and an idle one Offline", async () => {
    renderView();
    await screen.findByText("Organization Users");
    expect(screen.getAllByText("online").length).toBeGreaterThan(0);
    expect(screen.getAllByText("offline").length).toBeGreaterThan(0);
  });

  it("always offers Log Out, including for a user who is not online", async () => {
    renderView();
    await screen.findByText("Organization Users");
    // Two users × two breakpoint renderings — every row has the control, not
    // just the online one.
    expect(screen.getAllByText("Log Out").length).toBe(ORG_USERS.users.length * 2);
  });

  it("confirms a force logout with the specified copy", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Organization Users");

    await user.click(screen.getAllByText("Log Out")[0]);
    const dialog = (await screen.findAllByRole("dialog"))[0];
    expect(within(dialog).getByText(/Log out this user from the CRM\?/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/terminate/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Cancel")).toBeInTheDocument();
    expect(within(dialog).getByText("Log Out User")).toBeInTheDocument();
  });

  it("sends the force logout to the backend and refreshes the list", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    renderView();
    await screen.findByText("Organization Users");

    await user.click(screen.getAllByText("Log Out")[0]);
    await user.click((await screen.findAllByText("Log Out User"))[0]);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map(c => String(c[0]));
      expect(calls).toContain("/api/platform/users/11");
    });
    const call = fetchMock.mock.calls.find(c => String(c[0]) === "/api/platform/users/11")!;
    const init = call[1]!;
    expect(init.method).toBe("PATCH");
    // The body carries an action and a user id — and NOT an organization id,
    // which the server derives from the target's own row.
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ action: "forceLogout" });
  });

  it("offers the change-password form without ever showing the current one", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Organization Users");

    await user.click(screen.getAllByText("Actions")[0]);
    await user.click((await screen.findAllByText("Change Password"))[0]);

    const dialog = (await screen.findAllByRole("dialog"))[0];
    expect(within(dialog).getByLabelText("New Password")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Confirm Password")).toBeInTheDocument();
    // The requirements are shown, as specified.
    expect(within(dialog).getByText("8+ characters")).toBeInTheDocument();
    expect(within(dialog).getByText("symbol")).toBeInTheDocument();
    // And it says plainly that the old one is not retrievable.
    expect(within(dialog).getByText(/never displayed or retrieved/i)).toBeInTheDocument();
    // No field is pre-filled with anything.
    expect(within(dialog).getByLabelText("New Password")).toHaveValue("");
  });

  it("offers the full actions menu", async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText("Organization Users");

    await user.click(screen.getAllByText("Actions")[0]);
    const menu = (await screen.findAllByRole("menu"))[0];
    for (const item of ["View Details", "Change Email", "Change Password", "Deactivate Account"]) {
      expect(within(menu).getByText(item)).toBeInTheDocument();
    }
  });
});

describe("CrmUpdatesNotification", () => {
  /** The dashboard passes Tailwind class names, not colours. */
  const theme = {
    text: "text-white", textMuted: "text-gray-400", dropdown: "bg-black",
    dropdownGlass: {}, tableBorder: "border-gray-800", scroll: "",
  };

  it("badges the unread count and renders the update when opened", async () => {
    render(
      <CrmUpdatesNotification user={{ id: 5 }} theme={theme} isDark isOpen onToggle={() => {}} />,
    );
    await screen.findAllByText("UI/UX Upgrade Released");

    expect(screen.getByText("System Updates")).toBeInTheDocument();
    expect(screen.getByText("v2.1.4")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Important")).toBeInTheDocument();
    expect(screen.getByText("Mark all as read")).toBeInTheDocument();
    expect(screen.getByText("Mark as read")).toBeInTheDocument();
    // Formatted, not literal.
    expect(screen.getByText("navigation").tagName).toBe("STRONG");
  });

  it("never sends a user id — the server takes it from the session", async () => {
    const fetchMock = mockApi();
    render(<CrmUpdatesNotification user={{ id: 5 }} theme={theme} isDark isOpen onToggle={() => {}} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    const feedCalls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(feedCalls.some(u => u.includes("userId"))).toBe(false);
  });

  it("marks all as read for this user only", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi();
    render(<CrmUpdatesNotification user={{ id: 5 }} theme={theme} isDark isOpen onToggle={() => {}} />);
    await screen.findAllByText("UI/UX Upgrade Released");

    await user.click(screen.getByText("Mark all as read"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        c => c[1]?.method === "POST",
      );
      expect(post).toBeTruthy();
      // No userId in the body: whose read state changes is decided server-side.
      expect(JSON.parse(String(post![1]!.body))).toEqual({ action: "mark_all_read" });
    });
  });
});
