// InventoryManagementView.colors.test.tsx — the two-channel colour system.
//
// Unit type and status are separate visual channels, and a duplicate overrides
// the type's fill without taking either channel with it. The failure this guards
// against is the obvious "simplification": collapsing the two back into one
// colour, which is what made the old grid unable to say "2BHK" and "Booked" at
// the same time.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView, {
  getUnitTypeColor, getStatusColor, findDuplicateFlats, isDuplicateFlat, normalizeUnitType,
} from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };
const DUPLICATE_RED = "rgb(239, 68, 68)";

describe("getUnitTypeColor", () => {
  it("gives 1/2/3/4 BHK four visually distinct inks", () => {
    const inks = ["1BHK", "2BHK", "3BHK", "4BHK"].map(x => getUnitTypeColor(x).ink);
    expect(new Set(inks).size).toBe(4);
  });

  it("is stable across the spellings that exist in live data", () => {
    // inventory_units genuinely holds "2 BHK", "2BHK" and "1Bhk".
    expect(normalizeUnitType("2 BHK")).toBe("2BHK");
    expect(getUnitTypeColor("2 BHK").ink).toBe(getUnitTypeColor("2BHK").ink);
    expect(getUnitTypeColor("1Bhk").ink).toBe(getUnitTypeColor("1BHK").ink);
  });

  it("derives a deterministic colour for a type nobody has mapped", () => {
    const a = getUnitTypeColor("5BHK Duplex").ink;
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(getUnitTypeColor("5BHK Duplex").ink).toBe(a);          // deterministic
    expect(getUnitTypeColor("Studio Loft").ink).not.toBe(a);      // and distinct
  });

  it("lightens the ink for dark surfaces", () => {
    expect(getUnitTypeColor("2BHK", true).ink).not.toBe(getUnitTypeColor("2BHK", false).ink);
  });

  it("returns a tint and a border derived from the ink, not free-floating colours", () => {
    const c = getUnitTypeColor("2BHK");
    expect(c.fill.startsWith(c.ink)).toBe(true);
    expect(c.border.startsWith(c.ink)).toBe(true);
  });
});

describe("status colours are untouched", () => {
  it("keeps all eight statuses and their existing hues", () => {
    for (const [key, label] of [
      ["available", "Available"], ["booked", "Booked"], ["on_hold", "On Hold"],
      ["blocked", "Blocked"], ["registered", "Registered"], ["refuge_area", "Refuge Area"],
      ["unfinished", "Unfinished"], ["cancelled", "Cancelled"],
    ]) {
      expect(getStatusColor(key).label).toBe(label);
      expect(getStatusColor(key).hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("duplicate helpers", () => {
  it("finds every conflicting number, case- and space-insensitively", () => {
    const dups = findDuplicateFlats([{ flat_no: "101" }, { flat_no: " 101 " }, { flat_no: "102" }]);
    expect(isDuplicateFlat({ flat_no: "101" }, dups)).toBe(true);
    expect(isDuplicateFlat({ flat_no: "102" }, dups)).toBe(false);
  });

  // §9. The DB's unique index keys on (project, tower, COALESCE(wing,''), floor,
  // flat_no) — so the same number in two wings is legal, correct data, and
  // flagging it was a false positive that made the warning untrustworthy.
  it("does not flag the same number in two different wings", () => {
    const dups = findDuplicateFlats([
      { flat_no: "101", tower: "A", wing: "A" },
      { flat_no: "101", tower: "A", wing: "B" },
    ]);
    expect(isDuplicateFlat({ flat_no: "101", tower: "A", wing: "A" }, dups)).toBe(false);
    expect(isDuplicateFlat({ flat_no: "101", tower: "A", wing: "B" }, dups)).toBe(false);
  });

  it("does not flag the same number in two different towers", () => {
    const dups = findDuplicateFlats([
      { flat_no: "101", tower: "A", wing: "" },
      { flat_no: "101", tower: "B", wing: "" },
    ]);
    expect(isDuplicateFlat({ flat_no: "101", tower: "A", wing: "" }, dups)).toBe(false);
  });

  it("still flags a repeat inside one tower+wing, across floors", () => {
    // Floor is deliberately outside the scope: the index allows this, and it is
    // the numbering mistake the warning exists to catch.
    const dups = findDuplicateFlats([
      { flat_no: "101", tower: "A", wing: "A" },
      { flat_no: "101", tower: "A", wing: "A" },
    ]);
    expect(isDuplicateFlat({ flat_no: "101", tower: "A", wing: "A" }, dups)).toBe(true);
  });

  it("treats a null wing and an empty wing as the same wing", () => {
    // COALESCE(wing,'') in the index means these are one scope, not two.
    const dups = findDuplicateFlats([
      { flat_no: "101", tower: "A", wing: null },
      { flat_no: "101", tower: "A", wing: "" },
    ]);
    expect(isDuplicateFlat({ flat_no: "101", tower: "A", wing: null }, dups)).toBe(true);
  });
});

// ── Rendered grid: the §8 combination matrix ────────────────────────────────
const unit = (id: number, floor: number, flat_no: string, unit_type: string, status: string) => ({
  id, project_name: "VR Buildcom", tower: "A", wing: null,
  unit_type, floor, flat_no,
  carpet_area_sqft: "650", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status, hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, created_by: null, updated_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
});

// 101/102/103 unique; 201 & 301 share "201"; 202 & 302 share "202"; etc.
const UNITS = [
  unit(1, 1, "101", "1BHK", "available"),
  unit(2, 1, "102", "2BHK", "available"),
  unit(3, 1, "103", "3BHK", "available"),
  unit(4, 1, "104", "2BHK", "booked"),
  unit(5, 1, "105", "2BHK", "on_hold"),
  unit(6, 1, "106", "2BHK", "blocked"),
  unit(7, 1, "107", "2BHK", "cancelled"),
  // duplicates: same number on floor 2 and 3
  unit(8, 2, "201", "1BHK", "available"), unit(9, 3, "201", "1BHK", "available"),
  unit(10, 2, "202", "2BHK", "available"), unit(11, 3, "202", "2BHK", "available"),
  unit(12, 2, "203", "2BHK", "booked"), unit(13, 3, "203", "2BHK", "booked"),
  unit(14, 2, "204", "3BHK", "on_hold"), unit(15, 3, "204", "3BHK", "on_hold"),
];

const building = {
  key: "vr buildcom", project_name: "VR Buildcom", project_id: 5,
  floors: 3, tower_count: 1, total: UNITS.length, available: 8, booked: 3, on_hold: 3, blocked: 1,
  towers: [{ key: "vr buildcom", tower: "A", tower_id: 9, floors: 3, total: UNITS.length, available: 8, booked: 3, on_hold: 3, blocked: 1 }],
  unit_types: [{ key: "vr buildcom", tower: "A", unit_type: "2BHK", units: 9 }],
};

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "VR Buildcom", status: "active" }] });
    if (url.includes("/api/inventory?")) return json({ success: true, data: UNITS, total: UNITS.length });
    return json({ success: true, data: [] });
  }));
});

async function openGrid() {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  const card = await waitFor(() => screen.getByRole("heading", { name: "VR Buildcom" }));
  fireEvent.click(card.closest("button")!);
  await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
}

/** The grid cell for a flat number (first match — duplicates render twice). */
const cell = (flat: string) => screen.getAllByText(flat)[0].closest("button")! as HTMLElement;
const framedRed = (el: HTMLElement) => el.style.borderColor === DUPLICATE_RED || el.style.border.includes(DUPLICATE_RED);
const statusDot = (el: HTMLElement, label: string) => within(el).getByTitle(label);

describe("grid cell — type, status and duplicate coexist", () => {
  const cases: [string, string, string, boolean][] = [
    // flat, type, status label, duplicate?
    ["101", "1BHK", "Available", false],
    ["102", "2BHK", "Available", false],
    ["103", "3BHK", "Available", false],
    ["104", "2BHK", "Booked", false],
    ["105", "2BHK", "On Hold", false],
    ["106", "2BHK", "Blocked", false],
    ["107", "2BHK", "Cancelled", false],
    ["201", "1BHK", "Available", true],
    ["202", "2BHK", "Available", true],
    ["203", "2BHK", "Booked", true],
    ["204", "3BHK", "On Hold", true],
  ];

  // NOTE: the tile's FILL now carries the business state (white/blue/grey/
  // orange/red), not the unit type — see InventoryManagementView.tilecolors.
  // What survives from the old two-channel design is that the type stays
  // readable on the tile and the duplicate frame stays independent of both.
  for (const [flat, type, status, duplicate] of cases) {
    it(`${duplicate ? "duplicate " : ""}${type} + ${status} keeps type, state and duplicate legible`, async () => {
      await openGrid();
      const c = cell(flat);

      // 1. the type is still named on the tile
      const label = within(c).getByText(type);
      expect(label.style.color).toBeTruthy();

      // 2. the state reaches the tooltip, whatever the type or duplicate state
      expect(c.title).toContain(status);

      // 3. duplicate framing, only where it belongs
      expect(framedRed(c)).toBe(duplicate);
      expect(/^Duplicate flat number/.test(c.title)).toBe(duplicate);
      if (duplicate) expect(c.title).toContain(`${flat} · ${type}`);
    });
  }

  it("keeps the type label's ink distinct per type on available tiles", async () => {
    // Available is the white tile, so the type keeps its own ink there — which
    // is where telling 1BHK from 3BHK at a glance actually matters.
    await openGrid();
    const inks = ["101", "102", "103"].map(f => within(cell(f)).getByText(/BHK/).style.color);
    expect(new Set(inks).size).toBe(3);
  });

  it("does not let the duplicate frame overwrite the type ink", async () => {
    await openGrid();
    // 202 is a duplicate 2BHK; 102 is a clean 2BHK. Same type ink either way.
    expect(within(cell("202")).getByText("2BHK").style.color)
      .toBe(within(cell("102")).getByText("2BHK").style.color);
  });
});

describe("legend", () => {
  it("separates unit types, tile colour and the duplicate warning", async () => {
    await openGrid();
    expect(screen.getByText("Unit types")).toBeTruthy();
    expect(screen.getByText("Tile colour")).toBeTruthy();
    expect(screen.getByText("Special")).toBeTruthy();
    expect(screen.getByText("Duplicate flat number")).toBeTruthy();
  });

  it("lists only the unit types actually present in this building", async () => {
    await openGrid();
    const legend = screen.getByText("Unit types").parentElement!;
    const listed = within(legend).getAllByText(/BHK|RK/).map(el => el.textContent);
    expect(new Set(listed)).toEqual(new Set(["1BHK", "2BHK", "3BHK"]));
    expect(listed).not.toContain("4BHK");
  });
});
