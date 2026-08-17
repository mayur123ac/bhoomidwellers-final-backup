// InventoryManagementView.wings.test.tsx — tower + wing as the building identity.
//
// The data model this pins down (verified against the 2026-08-04 parity
// migration, not assumed): project and tower are relational rows, but WING IS
// FREE TEXT on inventory_units. There is no inventory_wings table, so the set of
// wings a tower has is discovered by grouping its stock — which is why the
// aggregate carries a `wings` array and why nothing here creates wing records.
//
// The failure being guarded against: "Colossal / Tower A / Wing B" and
// "Colossal / Tower A / Wing C" are different flats behind the same on-screen
// label. Every assertion below is about the wing surviving to the screen and to
// the query.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView from "./InventoryManagementView";
import { buildingScopeLabel, buildingFullLabel } from "./BuildingContextTag";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

const unit = (id: number, floor: number, flat_no: string, tower: string, wing: string | null) => ({
  id, project_name: "Colossal", tower, wing,
  unit_type: "2BHK", floor, flat_no,
  carpet_area_sqft: "650", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status: "available", hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, created_by: null, updated_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
});

// Tower A has wings A and B, each numbering its flats 101/102 — legal data.
// Tower B has no wing at all, the common case that must keep working.
const ALL_UNITS = [
  unit(1, 1, "101", "A", "A"), unit(2, 1, "102", "A", "A"),
  unit(3, 1, "101", "A", "B"), unit(4, 1, "102", "A", "B"),
  unit(5, 1, "201", "B", null),
];

const wingRow = (tower: string, wing: string, total: number) => ({
  key: "colossal", tower, wing, floors: 1,
  total, available: total, booked: 0, on_hold: 0, blocked: 0,
});

const building = {
  key: "colossal", project_name: "Colossal", project_id: 5,
  floors: 1, tower_count: 2, total: 5, available: 5, booked: 0, on_hold: 0, blocked: 0,
  towers: [
    { key: "colossal", tower: "A", tower_id: 9, floors: 1, total: 4, available: 4, booked: 0, on_hold: 0, blocked: 0 },
    { key: "colossal", tower: "B", tower_id: 10, floors: 1, total: 1, available: 1, booked: 0, on_hold: 0, blocked: 0 },
  ],
  unit_types: [{ key: "colossal", tower: "A", unit_type: "2BHK", units: 4 }],
  wings: [wingRow("A", "A", 2), wingRow("A", "B", 2), wingRow("B", "", 1)],
};

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

/** Records every /api/inventory row query so the wing scoping can be asserted. */
let unitQueries: string[] = [];

beforeEach(() => {
  unitQueries = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "Colossal", status: "active" }] });
    if (url.includes("/api/inventory/towers")) return json({ success: true, data: [] });
    if (url.includes("/api/inventory?")) {
      unitQueries.push(url);
      // Serve what the query asks for, so the grid reflects the filter.
      const q = new URL(url, "http://localhost").searchParams;
      const tower = q.get("tower");
      const wing = q.get("wing");
      let rows = ALL_UNITS;
      if (tower) rows = rows.filter(u => u.tower === tower);
      if (wing !== null) rows = rows.filter(u => (u.wing ?? "") === wing);
      return json({ success: true, data: rows, total: rows.length });
    }
    return json({ success: true, data: [] });
  }));
});

async function openBuilding() {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
  fireEvent.click(card.closest("button")!);
  await waitFor(() => expect(screen.getByText("All wings")).toBeTruthy());
}

const lastQuery = () => new URL(unitQueries[unitQueries.length - 1], "http://localhost").searchParams;

// Tabs read "Wing B (2)", so they are matched by role + prefix rather than by
// exact text — the count is data, not part of the tab's identity.
const tab = (name: RegExp) => screen.getByRole("button", { name });
const clickTab = (name: RegExp) => fireEvent.click(tab(name));

// ── The label helpers, which every surface shares ────────────────────────────
describe("building scope label", () => {
  it("names the wing when there is one", () => {
    expect(buildingScopeLabel({ project_name: "Colossal", tower: "A", wing: "B" })).toBe("Tower A  •  Wing B");
    expect(buildingFullLabel({ project_name: "Colossal", tower: "A", wing: "B" })).toBe("Colossal  •  Tower A  •  Wing B");
  });

  it("drops the wing cleanly when there is none — never 'Wing undefined'", () => {
    expect(buildingScopeLabel({ project_name: "Colossal", tower: "A", wing: null })).toBe("Tower A");
    expect(buildingScopeLabel({ project_name: "Colossal", tower: "A", wing: "  " })).toBe("Tower A");
    expect(buildingFullLabel({ project_name: "Colossal", tower: "A" })).toBe("Colossal  •  Tower A");
  });

  it("survives a building with no tower at all", () => {
    expect(buildingScopeLabel({ project_name: "Colossal" })).toBe("");
    expect(buildingFullLabel({ project_name: "Colossal" })).toBe("Colossal");
  });
});

// ── Tabs and scoping ─────────────────────────────────────────────────────────
describe("wing tabs", () => {
  it("offers the wings of the selected tower, and no others", async () => {
    await openBuilding();
    clickTab(/^Tower A/);
    await waitFor(() => expect(tab(/^Wing A/)).toBeTruthy());
    expect(tab(/^Wing B/)).toBeTruthy();
    // Tower B's stock is un-winged; its entry must not leak into Tower A's row.
    expect(screen.queryByRole("button", { name: /^No wing/ })).toBeNull();
  });

  it("narrows the query to one wing", async () => {
    await openBuilding();
    clickTab(/^Tower A/);
    await waitFor(() => tab(/^Wing B/));
    clickTab(/^Wing B/);

    await waitFor(() => expect(lastQuery().get("wing")).toBe("B"));
    expect(lastQuery().get("tower")).toBe("A");
  });

  it("hides the wing row entirely for a tower whose stock has no wings", async () => {
    // A tower that never used wings should look exactly as it did before wings
    // existed — an "All wings / No wing" pair there is a choice with one outcome.
    await openBuilding();
    clickTab(/^Tower B/);
    await waitFor(() => expect(lastQuery().get("tower")).toBe("B"));
    expect(screen.queryByRole("button", { name: /^All wings/ })).toBeNull();
  });

  it("clears a wing that the newly-selected tower does not have", async () => {
    await openBuilding();
    clickTab(/^Tower A/);
    await waitFor(() => tab(/^Wing B/));
    clickTab(/^Wing B/);
    await waitFor(() => expect(lastQuery().get("wing")).toBe("B"));

    // Tower B has no Wing B — the selection must not carry over.
    clickTab(/^Tower B/);
    await waitFor(() => expect(lastQuery().get("tower")).toBe("B"));
    expect(lastQuery().get("wing")).not.toBe("B");
  });

  it("asks for un-winged stock explicitly when a tower mixes both", async () => {
    // The genuinely ambiguous case: Tower A has winged AND un-winged stock. Here
    // "No wing" is a real choice, and it must send wing="" — omitting the param
    // would show every wing when the user asked for the ones with none.
    const mixed = { ...building, wings: [wingRow("A", "", 1), wingRow("A", "A", 2)] };
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("view=buildings")) return json({ success: true, data: [mixed] });
      if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "Colossal" }] });
      if (url.includes("/api/inventory?")) { unitQueries.push(url); return json({ success: true, data: ALL_UNITS, total: 5 }); }
      return json({ success: true, data: [] });
    }));
    render(<InventoryManagementView user={user} isDark={false} t={t} />);
    const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
    fireEvent.click(card.closest("button")!);

    clickTab(/^Tower A/);
    await waitFor(() => expect(tab(/^No wing/)).toBeTruthy());
    clickTab(/^No wing/);
    await waitFor(() => expect(lastQuery().get("wing")).toBe(""));
  });

  it("shows no wing row for a building whose stock never used wings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: any) => {
      const url = String(input);
      const plain = { ...building, wings: [wingRow("A", "", 4)] };
      if (url.includes("view=buildings")) return json({ success: true, data: [plain] });
      if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "Colossal" }] });
      if (url.includes("/api/inventory?")) return json({ success: true, data: ALL_UNITS, total: 5 });
      return json({ success: true, data: [] });
    }));
    render(<InventoryManagementView user={user} isDark={false} t={t} />);
    const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
    fireEvent.click(card.closest("button")!);
    await waitFor(() => expect(screen.getAllByText("101").length).toBeGreaterThan(0));
    expect(screen.queryByText("All wings")).toBeNull();
  });
});

// ── The identity tag, on every surface that shows stock ──────────────────────
describe("building context tag", () => {
  it("states project, tower and wing above the floor matrix", async () => {
    await openBuilding();
    clickTab(/^Tower A/);
    await waitFor(() => tab(/^Wing B/));
    clickTab(/^Wing B/);

    // Regex, because getAllByTitle normalises the attribute's whitespace and the
    // label is padded with double spaces around its separators.
    await waitFor(() => {
      const tags = screen.getAllByTitle(/^Colossal\s+•\s+Tower A\s+•\s+Wing B$/);
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  it("shows the tower alone when the scope has no wing", async () => {
    await openBuilding();
    clickTab(/^Tower B/);
    await waitFor(() => {
      expect(screen.getAllByTitle(/^Colossal\s+•\s+Tower B$/).length).toBeGreaterThan(0);
    });
  });
});

// ── §6: wings are visible in the list without splitting the DB grouping ──────
describe("building card", () => {
  it("names the wings that exist under the towers", async () => {
    render(<InventoryManagementView user={user} isDark={false} t={t} />);
    const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
    const text = card.closest("button")!.textContent || "";
    expect(text).toContain("Tower A");
    expect(text).toContain("Wing A");
    expect(text).toContain("Wing B");
  });
});

// ── §9: duplicates are per tower+wing, and the grid proves it end-to-end ─────
describe("duplicates across wings", () => {
  it("does not flag 101 in Wing A against 101 in Wing B", async () => {
    await openBuilding();
    // With "All wings" showing, both 101s are on screen — and neither is a
    // duplicate, because they live in different wings.
    await waitFor(() => expect(screen.getAllByText("101").length).toBe(2));
    const banner = screen.queryByText(/duplicate flat number/i);
    expect(banner).toBeNull();

    for (const el of screen.getAllByText("101")) {
      const cell = el.closest("button")!;
      expect(cell.style.borderColor).not.toBe("rgb(239, 68, 68)");
      expect(within(cell).queryByTitle(/^Duplicate/)).toBeNull();
    }
  });
});
