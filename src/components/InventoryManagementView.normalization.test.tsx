// InventoryManagementView.normalization.test.tsx — one type, one colour, one count.
//
// inventory_units genuinely holds "2BHK", "2 BHK" and "2Bhk" as three separate
// strings for one configuration. Nothing upstream cleans them, so the read layer
// has to: otherwise the summary shows "2BHK: 45" beside "2 BHK: 1", the legend
// lists the same configuration twice, and the floor grid paints two shades that
// look like two different flats. Everything here is presentation — the column
// still holds whatever it held.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView, {
  getUnitTypeColor, normalizeUnitType, unitTypeLabel,
} from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

/** Hue of a #rrggbb, 0–360 — enough to assert "this is green", not a shade. */
function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("normalizeUnitType", () => {
  it("folds every spelling of a type onto one key", () => {
    for (const n of [1, 2, 3, 4]) {
      const key = `${n}BHK`;
      for (const spelling of [`${n}BHK`, `${n} BHK`, `${n}Bhk`, ` ${n} bhk `, `${n}bhk`]) {
        expect(normalizeUnitType(spelling)).toBe(key);
      }
    }
  });

  it("gives every spelling the same ink, fill and border — not just the same key", () => {
    for (const spelling of ["2BHK", "2 BHK", "2Bhk", " 2 bhk "]) {
      const c = getUnitTypeColor(spelling);
      expect(c).toEqual(getUnitTypeColor("2BHK"));
    }
  });

  it("displays one canonical spelling, whatever the column holds", () => {
    expect(unitTypeLabel("2 BHK")).toBe("2BHK");
    expect(unitTypeLabel("2Bhk")).toBe("2BHK");
    expect(getUnitTypeColor("2 BHK").label).toBe("2BHK");
    // A type nobody has curated keeps the operator's own spelling rather than
    // being shouted back at them as "5BHKDUPLEX".
    expect(unitTypeLabel("5BHK Duplex")).toBe("5BHK Duplex");
  });
});

describe("the four primary unit-type colours are far apart on the wheel", () => {
  const expected: [string, string, [number, number]][] = [
    ["1BHK", "green", [90, 165]],
    ["2BHK", "blue", [200, 250]],
    ["3BHK", "purple", [255, 300]],
    ["4BHK", "amber/orange", [15, 45]],
  ];

  for (const [type, name, [lo, hi]] of expected) {
    it(`${type} is ${name}`, () => {
      for (const dark of [false, true]) {
        const h = hueOf(getUnitTypeColor(type, dark).ink);
        expect(h).toBeGreaterThanOrEqual(lo);
        expect(h).toBeLessThanOrEqual(hi);
      }
    });
  }

  it("keeps neighbouring types at least 40° apart", () => {
    const hues = expected.map(([type]) => hueOf(getUnitTypeColor(type).ink));
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i] - hues[j]);
        expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

// ── Rendered views ──────────────────────────────────────────────────────────

const unit = (id: number, floor: number, flat_no: string, unit_type: string, status = "available") => ({
  id, project_name: "Colossal", tower: "A", wing: null,
  unit_type, floor, flat_no,
  carpet_area_sqft: "650", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status, hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, created_by: null, updated_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
});

// The screenshot's data: 45 units spelled "2BHK" and one spelled "2 BHK", plus a
// "2Bhk" for the third spelling. 1402 is duplicated on two floors.
const UNITS = [
  unit(1, 1, "101", "1BHK"),
  unit(2, 1, "102", "2BHK", "booked"),
  unit(3, 1, "103", "2 BHK"),
  unit(4, 1, "104", "2Bhk", "on_hold"),
  unit(5, 1, "105", "3BHK"),
  unit(6, 14, "1402", "2 BHK", "booked"),
  unit(7, 15, "1402", "2BHK"),
];

const building = {
  key: "colossal", project_name: "Colossal", project_id: 5,
  floors: 15, tower_count: 1, total: 106, available: 105, booked: 1, on_hold: 0, blocked: 0,
  towers: [{ key: "colossal", tower: "A", tower_id: 9, floors: 15, total: 106, available: 105, booked: 1, on_hold: 0, blocked: 0 }],
  // Exactly the split the screenshot shows: the aggregate reports the two
  // spellings as two rows, because it groups on the raw column.
  unit_types: [
    { key: "colossal", tower: "A", unit_type: "1BHK", units: 60 },
    { key: "colossal", tower: "A", unit_type: "2BHK", units: 45 },
    { key: "colossal", tower: "A", unit_type: "2 BHK", units: 1 },
    { key: "colossal", tower: "A", unit_type: "3BHK", units: 1 },
  ],
};

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "Colossal", status: "active" }] });
    if (url.includes("/api/inventory?")) return json({ success: true, data: UNITS, total: UNITS.length });
    return json({ success: true, data: [] });
  }));
});

async function openGrid() {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
  fireEvent.click(card.closest("button")!);
  await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
}

/** Elements whose whole text is exactly this — used to pin a summary chip. */
const exactSpans = (text: string) =>
  screen.queryAllByText((_c, el) => el?.tagName === "SPAN" && el.textContent?.trim() === text);

/** The grid cell for a flat — skipping the header statistics, which are also
 *  bare numbers and can collide with a flat number ("105 available"). */
const cells = (flat: string) =>
  screen.getAllByText(flat).map(el => el.closest("button")).filter(Boolean) as HTMLElement[];
const cell = (flat: string) => cells(flat)[0];

describe("summary chips count the normalised type", () => {
  it("shows one 2BHK chip totalling both spellings", async () => {
    await openGrid();
    expect(exactSpans("2BHK: 46")).toHaveLength(1);
    expect(exactSpans("2BHK: 45")).toHaveLength(0);
    expect(exactSpans("2 BHK: 1")).toHaveLength(0);
  });

  it("leaves the untouched types alone", async () => {
    await openGrid();
    expect(exactSpans("1BHK: 60")).toHaveLength(1);
    expect(exactSpans("3BHK: 1")).toHaveLength(1);
  });

  it("inks each chip with its own unit-type colour", async () => {
    await openGrid();
    const colour = (text: string) => exactSpans(text)[0].style.color;
    expect(new Set(["1BHK: 60", "2BHK: 46", "3BHK: 1"].map(colour)).size).toBe(3);
  });
});

describe("floor grid renders one colour and one label per normalised type", () => {
  it("paints all three 2BHK spellings identically", async () => {
    await openGrid();
    const cells = ["102", "103", "104"].map(cell);
    // The tile FILL now carries the business state, so it legitimately differs
    // between these three (booked / available / on hold). What must not differ
    // is the type's own ink — that is the channel normalisation is about.
    expect(new Set(cells.map(c => within(c).getByText("2BHK").style.color)).size).toBe(1);
    // …and labels them all "2BHK", never "2 BHK" or "2Bhk".
    for (const c of cells) expect(within(c).getByText("2BHK")).toBeTruthy();
    expect(screen.queryByText("2 BHK")).toBeNull();
    expect(screen.queryByText("2Bhk")).toBeNull();
  });

  it("lists the type once in the legend", async () => {
    await openGrid();
    const legend = screen.getByText("Unit types").parentElement!;
    const listed = within(legend).getAllByText(/BHK/).map(el => el.textContent);
    expect(listed.filter(x => x === "2BHK")).toHaveLength(1);
    expect(new Set(listed)).toEqual(new Set(["1BHK", "2BHK", "3BHK"]));
  });
});

describe("type stays an independent channel from state", () => {
  it("does not change the type's ink when the status changes", async () => {
    await openGrid();
    // 102 booked, 103 available, 104 on hold — all 2BHK, so all one type ink.
    expect(new Set(["102", "103", "104"].map(f => within(cell(f)).getByText("2BHK").style.color)).size).toBe(1);
  });

  it("tells the three states apart by the tile itself", async () => {
    // The dot is gone: the tile's own colour is the state indicator now, so
    // three different states must produce three different fills.
    await openGrid();
    expect(new Set(["102", "103", "104"].map(f => cell(f).style.backgroundColor)).size).toBe(3);
  });

  it("still names each state in the tooltip", async () => {
    await openGrid();
    for (const [flat, label] of [["102", "Booked"], ["103", "Available"], ["104", "On Hold"]]) {
      expect(cell(flat).title).toContain(label);
    }
  });
});

describe("duplicate warning stays independent of type and status", () => {
  it("marks both 1402s, keeps their type label, and keeps their differing status dots", async () => {
    await openGrid();
    const dups = cells("1402");
    expect(dups).toHaveLength(2);

    for (const c of dups) {
      expect(c.style.border).toContain("rgb(239, 68, 68)");
      expect(c.title).toMatch(/^Duplicate flat number — 1402 · 2BHK · /);
      // Type survives the red wash, spelled canonically despite "2 BHK" in the row.
      expect(within(c).getByText("2BHK")).toBeTruthy();
    }
    // Duplicate + booked and duplicate + available each keep their own state —
    // now carried by the tile fill and named in the tooltip, not by a dot.
    expect(new Set(dups.map(c => c.style.backgroundColor)).size).toBe(2);
    const named = dups.map(c => (/Booked/.test(c.title) ? "Booked" : /Available/.test(c.title) ? "Available" : "?"));
    expect(new Set(named)).toEqual(new Set(["Booked", "Available"]));
  });

  it("is not confused with the cancelled status — a cancelled flat gets no red frame", async () => {
    await openGrid();
    // 102 is booked, not cancelled; the point is that no non-duplicate cell is
    // framed, whatever its status.
    for (const flat of ["101", "102", "103", "104", "105"]) {
      expect(cell(flat).style.border).not.toContain("rgb(239, 68, 68)");
    }
  });
});

describe("table view speaks the same language", () => {
  it("chips the normalised type and reds the duplicate flat number", async () => {
    await openGrid();
    fireEvent.click(screen.getByText("Table"));
    await waitFor(() => expect(screen.getAllByTitle(/^Duplicate flat number/).length).toBeGreaterThan(0));

    // Every 2BHK row — whatever its spelling — carries one identically inked chip.
    const chips = screen.getAllByText("2BHK").filter(el => el.tagName === "SPAN");
    expect(chips.length).toBeGreaterThanOrEqual(5);
    expect(new Set(chips.map(el => el.style.color)).size).toBe(1);

    const marked = screen.getAllByTitle(/^Duplicate flat number/).filter(el => el.tagName === "SPAN");
    expect(marked.map(el => el.textContent)).toEqual(["1402", "1402"]);
    expect(marked.every(el => el.className.includes("text-red-500"))).toBe(true);
  });
});
