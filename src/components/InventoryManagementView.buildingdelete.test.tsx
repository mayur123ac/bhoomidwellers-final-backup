// InventoryManagementView.buildingdelete.test.tsx — the landing header's
// Select Building + Delete Building pair.
//
// The behaviour worth pinning down is that the delete target is EXPLICIT. A
// delete control on a filtered list is one mis-read away from removing the wrong
// building, so the target comes from its own selection, survives the card filter
// changing underneath it, and is named in full before the modal opens.
//
// The modal's dependency figures come from the server preview
// (GET /api/inventory/projects/[id]) rather than from the loaded card, because
// the server is what decides the delete — a locally-computed preview would be
// free to disagree with it.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import InventoryManagementView from "./InventoryManagementView";

const t = new Proxy({}, { get: () => "" }) as any;

const summary = (key: string, name: string, projectId: number | null, total: number) => ({
  key, project_name: name, project_id: projectId,
  floors: 1, tower_count: 1, total, available: total, booked: 0, on_hold: 0, blocked: 0,
  towers: [{ key, tower: "A", tower_id: 1, floors: 1, total, available: total, booked: 0, on_hold: 0, blocked: 0 }],
  unit_types: [{ key, tower: "A", unit_type: "1BHK", units: total }],
  wings: [{ key, tower: "A", wing: "B", floors: 1, total, available: total, booked: 0, on_hold: 0, blocked: 0 }],
});

const BHOOMI = summary("bhoomi dwellers", "Bhoomi Dwellers", 7, 1);
const COLOSSAL = summary("colossal", "Colossal", 8, 231);
// A grouping that exists only as a name on units — no inventory_projects row, so
// there is no id for the endpoint to address.
const ORPHAN = summary("legacy stock", "Legacy Stock", null, 3);

const json = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;

let preview: any;
let deleteResponse: any;
let deleteCalls: string[] = [];
let buildingList: any[];

beforeEach(() => {
  deleteCalls = [];
  buildingList = [BHOOMI, COLOSSAL, ORPHAN];
  preview = {
    id: 7, name: "Bhoomi Dwellers", towers: 1, wings: 1, floors: 1, units: 1,
    archived_units: 0, active_bookings: 0, history_preserved_units: 1,
    blocking: [], deletable: 1,
  };
  deleteResponse = json({ success: true, data: { id: 7, name: "Bhoomi Dwellers", deleted_units: 0, archived_units: 1, deleted_towers: 1 } });

  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("view=buildings")) return json({ success: true, data: buildingList });
    if (/\/api\/inventory\/projects\/\d+$/.test(url)) {
      if (method === "DELETE") { deleteCalls.push(url); return deleteResponse; }
      return json({ success: true, data: preview });
    }
    if (url.includes("/api/inventory/projects")) {
      return json({ success: true, data: buildingList.filter(b => b.project_id).map(b => ({ id: b.project_id, name: b.project_name })) });
    }
    return json({ success: true, data: [] });
  }));
});

const renderAs = (role: string) =>
  render(<InventoryManagementView user={{ name: "Test Admin", role }} isDark={false} t={t} />);

const selectBuilding = async (name: string) => {
  const picker = await screen.findByLabelText("Select building to delete");
  const option = within(picker as HTMLElement).getByRole("option", { name });
  fireEvent.change(picker, { target: { value: (option as HTMLOptionElement).value } });
};

const deleteButton = () => screen.getByRole("button", { name: /delete building/i });

describe("building delete control", () => {
  it("sits in the header and starts disabled with nothing selected", async () => {
    renderAs("admin");
    await screen.findByLabelText("Select building to delete");
    expect(deleteButton()).toBeDisabled();
  });

  it("is hidden from a role that cannot manage inventory", async () => {
    renderAs("sales executive");
    await screen.findByText("Inventory");
    expect(screen.queryByLabelText("Select building to delete")).toBeNull();
    expect(screen.queryByRole("button", { name: /delete building/i })).toBeNull();
  });

  it("offers only buildings that have a project row to delete", async () => {
    renderAs("admin");
    const picker = await screen.findByLabelText("Select building to delete");
    const names = Array.from((picker as HTMLSelectElement).options).map(o => o.textContent);
    expect(names).toContain("Bhoomi Dwellers");
    expect(names).toContain("Colossal");
    expect(names).not.toContain("Legacy Stock");
  });

  it("enables the button and names the selected building", async () => {
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    expect(deleteButton()).toBeEnabled();
    expect(await screen.findByText(/Selected for deletion:/)).toBeInTheDocument();
    expect(screen.getByText("Bhoomi Dwellers", { selector: "b" })).toBeInTheDocument();
  });

  it("keeps its target when the card filter is changed to a different building", async () => {
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    // The "All projects" filter is a different control. Narrowing the cards to
    // Colossal must not re-aim the delete.
    fireEvent.change(screen.getByDisplayValue("All projects"), { target: { value: "colossal" } });

    fireEvent.click(deleteButton());
    expect(await screen.findByText("Delete Building?")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toHaveTextContent("Bhoomi Dwellers");
  });

  it("shows the server's dependency counts in the confirmation", async () => {
    preview = { ...preview, towers: 2, wings: 3, floors: 18, units: 231, active_bookings: 0, history_preserved_units: 2 };
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());

    await screen.findByText("Delete Building?");
    const row = (label: string) => screen.getByText(label).parentElement!;
    expect(within(row("Towers")).getByText("2")).toBeInTheDocument();
    expect(within(row("Wings")).getByText("3")).toBeInTheDocument();
    expect(within(row("Floors")).getByText("18")).toBeInTheDocument();
    expect(within(row("Units")).getByText("231")).toBeInTheDocument();
    expect(within(row("Active bookings")).getByText("0")).toBeInTheDocument();
    expect(within(row("Flats with past bookings")).getByText("2")).toBeInTheDocument();
  });

  it("does not delete straight from the button — the modal confirms first", async () => {
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());
    await screen.findByText("Delete Building?");
    expect(deleteCalls).toEqual([]);
  });

  it("requires the building name to be typed before it will delete", async () => {
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());
    await screen.findByText("Delete Building?");

    const confirm = screen.getByRole("button", { name: /^Delete Permanently$/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Bhoomi Dwellers"), { target: { value: "Bhoomi Dwellers" } });
    expect(confirm).toBeEnabled();
  });

  it("blocks the delete and lists the flats when a live booking holds one", async () => {
    preview = {
      ...preview, active_bookings: 1,
      blocking: [{ id: 92, flat_no: "B-1206", reason: "This inventory unit is linked to booking #21 (Confirmed) and cannot be deleted." }],
    };
    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());

    await screen.findByText("Delete Building?");
    expect(screen.getByText("B-1206")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete Permanently$/i })).toBeDisabled();
    // No confirmation field is even offered — there is nothing to confirm.
    expect(screen.queryByPlaceholderText("Bhoomi Dwellers")).toBeNull();
    expect(deleteCalls).toEqual([]);
  });

  it("drops the card, clears the selection and updates the count after a delete", async () => {
    renderAs("admin");
    expect(await screen.findByText("3 buildings")).toBeInTheDocument();

    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());
    await screen.findByText("Delete Building?");
    fireEvent.change(screen.getByPlaceholderText("Bhoomi Dwellers"), { target: { value: "Bhoomi Dwellers" } });

    // The server no longer has it, so the reconciling refetch agrees.
    buildingList = [COLOSSAL, ORPHAN];
    fireEvent.click(screen.getByRole("button", { name: /^Delete Permanently$/i }));

    await waitFor(() => expect(deleteCalls).toEqual(["/api/inventory/projects/7"]));
    await waitFor(() => expect(screen.queryByText("Delete Building?")).toBeNull());
    expect(await screen.findByText("2 buildings")).toBeInTheDocument();
    expect(screen.queryByText(/Selected for deletion:/)).toBeNull();
    expect(deleteButton()).toBeDisabled();
  });

  it("surfaces a server refusal instead of pretending the delete worked", async () => {
    deleteResponse = json({
      success: false, code: "BOOKING_LINKED_UNITS",
      message: `"Bhoomi Dwellers" has 1 flat(s) attached to a booking.`,
      blocking: [{ id: 92, flat_no: "B-1206", reason: "linked to booking #21" }],
    }, 409);

    renderAs("admin");
    await selectBuilding("Bhoomi Dwellers");
    fireEvent.click(deleteButton());
    await screen.findByText("Delete Building?");
    fireEvent.change(screen.getByPlaceholderText("Bhoomi Dwellers"), { target: { value: "Bhoomi Dwellers" } });
    fireEvent.click(screen.getByRole("button", { name: /^Delete Permanently$/i }));

    expect(await screen.findByText(/has 1 flat\(s\) attached to a booking/)).toBeInTheDocument();
    expect(screen.getByText("B-1206")).toBeInTheDocument();
    // The card is still there — nothing was removed from the list on a refusal.
    expect(screen.getAllByText("Bhoomi Dwellers").length).toBeGreaterThan(0);
  });
});
