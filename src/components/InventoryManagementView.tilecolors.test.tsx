// @ts-nocheck
// InventoryManagementView.tilecolors.test.tsx — the business tile colour scheme.
//
// WHITE  → Available
// BLUE   → Registration + Disbursement complete
// GREY   → Registration in process
// ORANGE → Registration complete, disbursement pending
// RED    → Refuge area (always wins)
//
// The inputs are pinned against the values that actually exist in the live
// booking tables, not against invented ones:
//   booking_registration_details.registration_status → Pending | Scheduled | Completed
//   booking_loan_details.disbursement_status         → Pending | Partial   | Completed
// A "Partial" disbursement is NOT complete — that distinction is the whole
// difference between the blue tile and the orange one.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView, {
  resolveTileState, getTileStateColor, getTileAppearance, TILE_STATE_KEYS,
} from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

describe("resolveTileState", () => {
  it("gives available stock the white state", () => {
    expect(resolveTileState({ status: "available" })).toBe("available");
    expect(getTileStateColor("available").fill).toBe("#ffffff");
  });

  it("is blue only when BOTH registration and disbursement are complete", () => {
    expect(resolveTileState({
      status: "booked", booking_id: 1, registration_status: "Completed", disbursement_status: "Completed",
    })).toBe("reg_disb_complete");
  });

  it("is orange when registration completed but disbursement is not", () => {
    for (const disb of ["Pending", "Partial", null, ""]) {
      expect(resolveTileState({
        status: "booked", booking_id: 1, registration_status: "Completed", disbursement_status: disb,
      })).toBe("reg_complete_disb_pending");
    }
  });

  it("treats a partial disbursement as pending, not complete", () => {
    // The case most likely to be got wrong: money has moved, but not all of it.
    expect(resolveTileState({
      status: "booked", booking_id: 1, registration_status: "Completed", disbursement_status: "Partial",
    })).not.toBe("reg_disb_complete");
  });

  it("is grey while registration is still open", () => {
    for (const reg of ["Pending", "Scheduled"]) {
      expect(resolveTileState({
        status: "booked", booking_id: 1, registration_status: reg, disbursement_status: "Completed",
      })).toBe("reg_in_process");
    }
  });

  it("lets refuge area win over everything else", () => {
    // Even a fully registered and disbursed refuge area stays red — it is a
    // property of the floor, not of any sale.
    expect(resolveTileState({
      status: "refuge_area", booking_id: 1, registration_status: "Completed", disbursement_status: "Completed",
    })).toBe("refuge_area");
    expect(resolveTileState({ status: "refuge_area" })).toBe("refuge_area");
  });

  it("does not mistake cancelled for refuge area", () => {
    expect(resolveTileState({ status: "cancelled" })).not.toBe("refuge_area");
    expect(resolveTileState({ status: "cancelled" })).toBeNull();
  });

  it("falls back to the ordinary status colour for states the scheme omits", () => {
    for (const s of ["on_hold", "blocked", "cancelled", "unfinished"]) {
      expect(resolveTileState({ status: s })).toBeNull();
      // …and still gets a usable tile, rather than a blank one.
      expect(getTileAppearance({ status: s }).fill).toMatch(/^#/);
    }
  });

  it("keeps a sold flat with no registration record out of the blue state", () => {
    // The dangerous collision: `booked` is blue in the status palette, and blue
    // now means "fully registered and disbursed".
    expect(resolveTileState({ status: "booked", booking_id: 7 })).toBe("reg_in_process");
  });

  it("does not read a missing registration record as pending on unsold stock", () => {
    expect(resolveTileState({ status: "available", booking_id: null })).toBe("available");
  });

  it("gives all five states a distinct fill in both themes", () => {
    for (const dark of [false, true]) {
      const fills = TILE_STATE_KEYS.map(k => getTileStateColor(k, dark).fill);
      expect(new Set(fills).size).toBe(5);
    }
  });
});

// ── Rendered grid ───────────────────────────────────────────────────────────
const unit = (id: number, flat_no: string, over: Record<string, any> = {}) => ({
  id, project_name: "Colossal", tower: "A", wing: null,
  unit_type: "2BHK", floor: 1, flat_no,
  carpet_area_sqft: "650", built_up_area_sqft: null, rate_per_sqft: null, base_price: null,
  facing: null, status: "available", hold_expires_at: null, source: "bulk_generated",
  lead_id: null, booking_id: null, created_by: null, updated_by: null,
  registration_status: null, disbursement_status: null,
  created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", deleted_at: null,
  ...over,
});

const UNITS = [
  unit(1, "101"),
  unit(2, "102", { status: "booked", booking_id: 1, registration_status: "Completed", disbursement_status: "Completed" }),
  unit(3, "103", { status: "booked", booking_id: 2, registration_status: "Pending", disbursement_status: "Pending" }),
  unit(4, "104", { status: "booked", booking_id: 3, registration_status: "Completed", disbursement_status: "Partial" }),
  unit(5, "105", { status: "refuge_area" }),
  unit(6, "106", { status: "on_hold" }),
];

const building = {
  key: "colossal", project_name: "Colossal", project_id: 5,
  floors: 1, tower_count: 1, total: 6, available: 1, booked: 3, on_hold: 1, blocked: 0,
  towers: [{ key: "colossal", tower: "A", tower_id: 9, floors: 1, total: 6, available: 1, booked: 3, on_hold: 1, blocked: 0 }],
  unit_types: [{ key: "colossal", tower: "A", unit_type: "2BHK", units: 6 }],
  wings: [],
};

const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("view=buildings")) return json({ success: true, data: [building] });
    if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 5, name: "Colossal" }] });
    if (url.includes("/api/inventory?")) return json({ success: true, data: UNITS, total: UNITS.length });
    return json({ success: true, data: [] });
  }));
});

async function openGrid() {
  render(<InventoryManagementView user={user} isDark={false} t={t} />);
  const card = await waitFor(() => screen.getByRole("heading", { name: "Colossal" }));
  fireEvent.click(card.closest("button")!);
  await waitFor(() => expect(screen.getAllByText("101").length).toBeGreaterThan(0));
}

const tile = (flat: string) => screen.getAllByText(flat)[0].closest("button")! as HTMLElement;
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe("floor matrix tiles", () => {
  it("paints each business state with its own colour", async () => {
    await openGrid();
    for (const [flat, key] of [
      ["101", "available"], ["102", "reg_disb_complete"],
      ["103", "reg_in_process"], ["104", "reg_complete_disb_pending"],
      ["105", "refuge_area"],
    ] as const) {
      expect(tile(flat).style.backgroundColor).toBe(rgb(getTileStateColor(key).fill));
    }
  });

  it("no longer fills Available with the old green", async () => {
    await openGrid();
    expect(tile("101").style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(tile("101").style.backgroundColor).not.toBe(rgb("#10b981"));
  });

  it("keeps an uncovered status visible instead of blanking it", async () => {
    await openGrid();
    expect(tile("106").style.backgroundColor).toBeTruthy();
    expect(tile("106").style.backgroundColor).not.toBe("rgb(255, 255, 255)");
  });

  it("names the business state in the tooltip, alongside the raw status", async () => {
    await openGrid();
    expect(tile("104").title).toContain("Registration Complete / Disbursement Pending");
    expect(tile("104").title).toContain("Booked");
  });

  it("drops the status dot that competed with the tile", async () => {
    await openGrid();
    // The dot used to carry status; the tile carries it now. Two indicators for
    // one fact is what this change exists to remove.
    expect(tile("102").querySelector("span.rounded-full")).toBeNull();
  });
});

describe("legend", () => {
  it("explains all five tile colours", async () => {
    await openGrid();
    expect(screen.getByText("Tile colour")).toBeTruthy();
    for (const k of TILE_STATE_KEYS) {
      expect(screen.getAllByText(getTileStateColor(k).label).length).toBeGreaterThan(0);
    }
  });

  it("lists an ordinary status only when a tile actually falls back to one", async () => {
    await openGrid();
    // Scoped to the legend group: "Cancelled" also exists as an <option> in the
    // status filter, which is a different control and legitimately lists them all.
    const group = screen.getByText("Other status").parentElement!;
    const listed = Array.from(group.querySelectorAll("span"))
      .map(s => s.textContent).filter(Boolean);
    expect(listed).toContain("On Hold");
    expect(listed).not.toContain("Cancelled");
  });
});
