// InventoryManagementView.duplicates.test.tsx — duplicate flat-number highlighting.
//
// The unique index only prevents a repeated flat_no within one (project, tower,
// wing, floor), so the same number CAN exist on two floors of a building. That is
// almost always a numbering mistake, and it is invisible until something points
// at it — hence red cells rather than a report nobody runs.
//
// Pinned here: the flagging is derived by comparing flat_no across the loaded
// units, and a unique flat keeps its ordinary status colour.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

const DUPLICATE_RED = "rgb(239, 68, 68)";      // DUPLICATE_HEX

/** The grid cell for a flat number. */
const cellFor = (flat: string) => screen.getByText(flat).closest("button")!;
const isFlaggedDuplicate = (el: HTMLElement) =>
  el.style.borderColor === DUPLICATE_RED || el.style.border.includes(DUPLICATE_RED);

const unit = (id: number, floor: number, flat_no: string) => ({
  id, project_name: "VR Buildcom", tower: "A", wing: null,
  unit_type: "2BHK", floor, flat_no,
  carpet_area_sqft: "650", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status: "available", hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, created_by: null, updated_by: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
});

// 101 appears on floors 1 and 2 — the duplicate. 102 is unique.
const UNITS = [unit(1, 1, "101"), unit(2, 2, "101"), unit(3, 1, "102")];

const building = {
  key: "vr buildcom", project_name: "VR Buildcom", project_id: 5,
  floors: 2, tower_count: 1, total: 3, available: 3, booked: 0, on_hold: 0, blocked: 0,
  towers: [{ key: "vr buildcom", tower: "A", tower_id: 9, floors: 2, total: 3, available: 3, booked: 0, on_hold: 0, blocked: 0 }],
  unit_types: [{ key: "vr buildcom", tower: "A", unit_type: "2BHK", units: 3 }],
};

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

/** Serve the building list and a chosen set of units. */
const serve = (units: any[]) =>
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "VR Buildcom", status: "active" }] });
    if (url.includes("/api/inventory?")) return json({ success: true, data: units, total: units.length });
    return json({ success: true, data: [] });
  }));

beforeEach(() => serve(UNITS));

/** Land on the building detail page, in the floor-grid view. */
async function openBuilding(waitForFlat: string) {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  // The name is also a project-filter <option>, so go via the card's heading.
  const card = await waitFor(() => screen.getByRole("heading", { name: "VR Buildcom" }));
  fireEvent.click(card.closest("button")!);
  await waitFor(() => expect(screen.getAllByText(waitForFlat).length).toBeGreaterThan(0));
}

describe("duplicate flat numbers", () => {
  it("frames every conflicting flat in red and leaves unique flats alone", async () => {
    await openBuilding("101");

    for (const cell of screen.getAllByText("101")) {
      const btn = cell.closest("button")!;
      expect(isFlaggedDuplicate(btn)).toBe(true);
      expect(btn.title).toMatch(/^Duplicate flat number — 101 · 2BHK · Available/);
    }

    const unique = cellFor("102");
    expect(isFlaggedDuplicate(unique)).toBe(false);
    expect(unique.title).not.toMatch(/Duplicate/);
  });

  it("counts the conflicting units, not the conflicting numbers", async () => {
    await openBuilding("101");
    // Two units share one number — the operator has two rows to fix, not one.
    expect(screen.getByText(/units use duplicate flat number/).textContent).toMatch(/^2 units/);
  });

  it("flags the same units in the table view", async () => {
    await openBuilding("101");
    fireEvent.click(screen.getByText("Table"));

    await waitFor(() => expect(screen.getAllByTitle(/^Duplicate flat number/).length).toBeGreaterThan(0));
    // Both 101 rows are marked; 102 is not.
    const marked = screen.getAllByTitle(/^Duplicate flat number/).filter(el => el.tagName === "SPAN");
    expect(marked).toHaveLength(2);
    expect(marked.every(el => el.className.includes("text-red-500"))).toBe(true);
    expect(marked.map(el => el.textContent)).toEqual(["101", "101"]);
  });

  it("flags nothing when every flat number is unique", async () => {
    serve([unit(1, 1, "101"), unit(2, 2, "201")]);
    await openBuilding("101");

    expect(screen.queryByText(/duplicate flat number/i)).toBeNull();
    expect(isFlaggedDuplicate(cellFor("101"))).toBe(false);
  });

  it("treats case and stray whitespace as the same number", async () => {
    serve([unit(1, 1, "B-101"), unit(2, 2, "b-101 ")]);
    await openBuilding("B-101");

    expect(isFlaggedDuplicate(cellFor("B-101"))).toBe(true);
    expect(isFlaggedDuplicate(cellFor("b-101"))).toBe(true);
  });
});
