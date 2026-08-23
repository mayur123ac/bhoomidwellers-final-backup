// InventoryManagementView.releasedflat.test.tsx — a flat released by a
// CANCELLED booking is deletable again.
//
// The bug this pins down: `inventory_units.source` records that the BOOKING FLOW
// created the row ('booking_sync') and is never cleared, so a flat that was
// booked, cancelled and returned to Available carried that value for ever.
// Both the API guard and this component treated it as a booking link, and the
// flat showed a padlock with "linked to a booking" — naming a booking that had
// been cancelled and unlinked. There was no way to remove it, ever.
//
// The live link is what protects a flat: its status, and a booking_id whose
// booking is not cancelled. Everything below is that distinction, on screen.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

const unit = (over: Record<string, any>) => ({
  id: 1, project_name: "Bhoomi Dwellers", tower: "A", wing: "B",
  unit_type: "1BHK", floor: 12, flat_no: "B-1206",
  carpet_area_sqft: "750", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status: "available", hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, booking_status: null,
  created_by: null, updated_by: null,
  created_at: "2026-08-03T00:00:00Z", updated_at: "2026-08-17T00:00:00Z", deleted_at: null,
  ...over,
});

// The real B-1206: created by booking sync, booking #21 cancelled, link cleared.
const RELEASED = unit({ id: 92, source: "booking_sync" });
// The same flat while booking #21 was still live.
const LIVE = unit({ id: 93, flat_no: "B-1207", source: "booking_sync", status: "booked", booking_id: 21, booking_status: "Confirmed" });
// A cancelled booking whose link was never cleared off the row.
const STALE_LINK = unit({ id: 94, flat_no: "B-1208", source: "booking_sync", booking_id: 21, booking_status: "Cancelled" });

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

const building = {
  key: "bhoomi dwellers", project_name: "Bhoomi Dwellers", project_id: 7,
  floors: 1, tower_count: 1, total: 3, available: 2, booked: 1, on_hold: 0, blocked: 0,
  towers: [{ key: "bhoomi dwellers", tower: "A", tower_id: 1, floors: 1, total: 3, available: 2, booked: 1, on_hold: 0, blocked: 0 }],
  unit_types: [{ key: "bhoomi dwellers", tower: "A", unit_type: "1BHK", units: 3 }],
  wings: [{ key: "bhoomi dwellers", tower: "A", wing: "B", floors: 1, total: 3, available: 2, booked: 1, on_hold: 0, blocked: 0 }],
};

let units: any[];

beforeEach(() => {
  units = [RELEASED, LIVE, STALE_LINK];
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 7, name: "Bhoomi Dwellers" }] });
    if (url.includes("/api/inventory?")) return json({ success: true, data: units, total: units.length });
    return json({ success: true, data: [] });
  }));
});

/** Open the building and switch to the table, where the per-row action lives. */
async function openTable(waitForFlat = "B-1206") {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  const card = await waitFor(() => screen.getByRole("heading", { name: "Bhoomi Dwellers" }));
  fireEvent.click(card.closest("button")!);
  fireEvent.click(await screen.findByRole("button", { name: /^Table$/ }));
  await waitFor(() => expect(screen.getByText(waitForFlat)).toBeTruthy());
}

const rowFor = (flat: string) => screen.getByText(flat).closest("tr")!;

describe("a flat released by a cancelled booking", () => {
  it("offers Delete, not a padlock", async () => {
    await openTable();
    const row = within(rowFor("B-1206"));
    expect(row.getByRole("button", { name: "Delete unit" })).toBeInTheDocument();
    expect(row.queryByTitle(/Locked/)).toBeNull();
  });

  it("still locks a flat whose booking is live", async () => {
    await openTable();
    const row = within(rowFor("B-1207"));
    expect(row.getByTitle(/Locked/)).toBeInTheDocument();
    expect(row.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("lets a stale cancelled link through, but warns it is still attached", async () => {
    await openTable();
    const row = within(rowFor("B-1208"));
    // Deletable — but the tooltip says what the override is for, and calls the
    // booking cancelled rather than implying a live one.
    const button = row.getByRole("button", { name: /Delete — warning/ });
    expect(button.getAttribute("title")).toBe("Delete — warning: cancelled booking #21");
  });

  it("locks a registered flat regardless of what its booking row says", async () => {
    units = [unit({ id: 95, flat_no: "B-1209", status: "registered", source: "booking_sync", booking_id: 21, booking_status: "Cancelled" })];
    await openTable("B-1209");
    expect(within(rowFor("B-1209")).getByTitle(/Locked/)).toBeInTheDocument();
  });
});
