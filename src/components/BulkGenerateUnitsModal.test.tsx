// BulkGenerateUnitsModal.test.tsx — the repeating flat-position pattern.
//
// What is pinned here is the one thing a later refactor could quietly break:
// the generated matrix must be DERIVED from the position configuration, not
// from the shape of the example anyone happened to test with. So the same
// building is generated twice with different patterns, and the second run must
// change the unit types of the same flat numbers.

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import BulkGenerateUnitsModal from "./BulkGenerateUnitsModal";

// The component's theme prop is a bag of Tailwind class strings; tests only need
// the keys to exist.
const t = new Proxy({}, { get: () => "" }) as any;
const user = { name: "Test Admin", role: "admin" };

// ProjectTowerPicker fetches projects/towers on mount, and the preview step asks
// the API which flats already exist. Both are stubbed; neither is under test.
const fetchMock = vi.fn(async (input: any, _init?: any) => {
  const url = String(input);
  if (url.includes("/api/inventory/projects")) return json({ success: true, data: [{ id: 1, name: "VR Buildcom" }] });
  if (url.includes("/api/inventory/towers")) return json({ success: true, data: [{ id: 1, name: "A", project_id: 1 }] });
  if (url.includes("/api/inventory/bulk-generate")) return json({ success: true, created: 48, skipped: 0, total: 48, skipped_details: [] });
  return json({ success: true, data: [], total: 0 });   // existing-unit pre-check
});
const json = (body: any) => ({ ok: true, status: 200, json: async () => body }) as any;

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

/** Fill the config step for a 12-floor tower with the given per-position types. */
async function configure(types: string[]) {
  render(<BulkGenerateUnitsModal isOpen onClose={() => {}} user={user} isDark={false} t={t} defaults={{ project_name: "VR Buildcom", tower: "A" }} />);
  await waitFor(() => expect(screen.getByPlaceholderText("e.g. 12")).toBeTruthy());

  fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "12" } });

  // Seeded with two positions; add until there is one per requested type.
  while (screen.getAllByPlaceholderText("01").length < types.length) {
    fireEvent.click(screen.getByText("Add Position"));
  }

  const typeSelects = screen.getAllByDisplayValue("2BHK");
  const carpets = screen.getAllByPlaceholderText("650");
  types.forEach((type, i) => {
    fireEvent.change(typeSelects[i], { target: { value: type } });
    fireEvent.change(carpets[i], { target: { value: "650" } });
  });
}

describe("flat position pattern", () => {
  it("repeats each position down every floor (12 × 4 = 48)", async () => {
    await configure(["2BHK", "2BHK", "2BHK", "1BHK"]);

    // §10 — every figure in the summary is computed, not typed in.
    // Last match: "Flats / Floor" also labels the derived box in the Layout
    // section, and the summary is rendered after it.
    const stat = (label: string) => screen.getAllByText(label).at(-1)!.parentElement!.querySelector("p")!.textContent;
    expect(stat("Floors")).toBe("12");
    expect(stat("Flats / Floor")).toBe("4");
    expect(stat("Total Units")).toBe("48");

    const typeCount = (re: RegExp) =>
      screen.getByText((_, el) => el?.tagName === "P" && re.test(el.textContent || ""))
        .previousElementSibling!.textContent;
    expect(typeCount(/^2BHK\s*\(3 × 12\)$/)).toBe("36");
    expect(typeCount(/^1BHK\s*\(1 × 12\)$/)).toBe("12");

    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 48 Units/)).toBeTruthy());

    // The acceptance case: floor 1 and floor 12 carry the same pattern.
    const matrix = screen.getByRole("table");
    for (const [flat, type] of [
      ["101", "2BHK"], ["102", "2BHK"], ["103", "2BHK"], ["104", "1BHK"],
      ["201", "2BHK"], ["204", "1BHK"],
      ["1201", "2BHK"], ["1202", "2BHK"], ["1203", "2BHK"], ["1204", "1BHK"],
    ]) {
      const cell = within(matrix).getByText(flat).closest("div")!;
      expect(within(cell as HTMLElement).getByText(type)).toBeTruthy();
    }
  });

  it("derives the types from the pattern rather than the flat number", async () => {
    // Same building, different pattern — 101 must now be a 1 BHK and 104 a 3 BHK.
    await configure(["1BHK", "2BHK", "2BHK", "3BHK"]);
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 48 Units/)).toBeTruthy());

    const matrix = screen.getByRole("table");
    for (const [flat, type] of [["101", "1BHK"], ["104", "3BHK"], ["1201", "1BHK"], ["1204", "3BHK"]]) {
      const cell = within(matrix).getByText(flat).closest("div")!;
      expect(within(cell as HTMLElement).getByText(type)).toBeTruthy();
    }
  });

  it("expands the pattern into one API unit per flat, carrying the position's metadata", async () => {
    await configure(["2BHK", "2BHK", "2BHK", "1BHK"]);
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 48 Units/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Confirm & Create 48 Units/));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes("bulk-generate"))).toBe(true));
    const call = fetchMock.mock.calls.find(c => String(c[0]).includes("bulk-generate"))!;
    const body = JSON.parse((call[1] as any).body);

    expect(body.units).toHaveLength(48);
    expect(body.units.filter((u: any) => u.unit_type === "2BHK")).toHaveLength(36);
    expect(body.units.filter((u: any) => u.unit_type === "1BHK")).toHaveLength(12);
    expect(body.units.map((u: any) => u.flat_no).slice(0, 4)).toEqual(["101", "102", "103", "104"]);
    expect(body.units.every((u: any) => u.carpet_area_sqft === "650")).toBe(true);
    expect(body.units.every((u: any) => u.project_name === "VR Buildcom" && u.tower === "A")).toBe(true);
  });
});

// ── Tower / wing as building identity ───────────────────────────────────────
// The requirement these pin down: wing must reach the generated rows as its own
// column, and must NOT be smuggled into flat_no unless the numbering pattern
// explicitly asks for it. Tower must never appear in flat_no at all.
describe("tower and wing", () => {
  /** Configure a 12-floor / 7-position tower in the given wing. */
  async function configureWinged(wing: string) {
    render(<BulkGenerateUnitsModal isOpen onClose={() => {}} user={user} isDark={false} t={t}
      defaults={{ project_name: "Colossal", tower: "A", wing }} />);
    await waitFor(() => expect(screen.getByPlaceholderText("e.g. 12")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "12" } });

    const types = ["2BHK", "2BHK", "1BHK", "1BHK", "1BHK", "2BHK", "1BHK"];   // §11
    while (screen.getAllByPlaceholderText("01").length < types.length) {
      fireEvent.click(screen.getByText("Add Position"));
    }
    const typeSelects = screen.getAllByDisplayValue("2BHK");
    const carpets = screen.getAllByPlaceholderText("650");
    types.forEach((type, i) => {
      fireEvent.change(typeSelects[i], { target: { value: type } });
      fireEvent.change(carpets[i], { target: { value: "650" } });
    });
  }

  /** Pick a numbering preset by its pattern — the dropdown's option values. */
  const selectPattern = (pattern: string) => {
    const select = screen.getAllByRole("combobox").find(s =>
      Array.from((s as HTMLSelectElement).options).some(o => o.value === pattern),
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: pattern } });
  };

  const submittedUnits = () => {
    const call = fetchMock.mock.calls.find(c => String(c[0]).includes("bulk-generate"))!;
    return JSON.parse((call[1] as any).body).units;
  };

  it("keeps wing out of flat_no by default, and carries it as its own field", async () => {
    await configureWinged("B");
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 84 Units/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Confirm & Create 84 Units/));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes("bulk-generate"))).toBe(true));
    const units = submittedUnits();

    expect(units).toHaveLength(84);                              // 12 × 7
    // Identity travels in its own columns…
    expect(units.every((u: any) => u.project_name === "Colossal" && u.tower === "A" && u.wing === "B")).toBe(true);
    // …and NOT inside the number, because the default pattern has no {WING}.
    expect(units.map((u: any) => u.flat_no).slice(0, 7))
      .toEqual(["101", "102", "103", "104", "105", "106", "107"]);
    expect(units.some((u: any) => String(u.flat_no).includes("A"))).toBe(false);
    expect(units.some((u: any) => String(u.flat_no).includes("B"))).toBe(false);

    // §11: the pattern repeats down the floors, unaffected by the wing.
    const floor12 = units.filter((u: any) => u.floor === 12).map((u: any) => u.flat_no);
    expect(floor12).toEqual(["1201", "1202", "1203", "1204", "1205", "1206", "1207"]);
    const types12 = units.filter((u: any) => u.floor === 12).map((u: any) => u.unit_type);
    expect(types12).toEqual(["2BHK", "2BHK", "1BHK", "1BHK", "1BHK", "2BHK", "1BHK"]);
  });

  it("puts the wing into flat_no when the numbering pattern asks for it", async () => {
    await configureWinged("B");
    selectPattern("{WING}-{FLOOR:02}{UNIT:02}");   // the "B-1204" preset
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 84 Units/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Confirm & Create 84 Units/));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes("bulk-generate"))).toBe(true));
    const units = submittedUnits();

    expect(units.filter((u: any) => u.floor === 1).map((u: any) => u.flat_no))
      .toEqual(["B-0101", "B-0102", "B-0103", "B-0104", "B-0105", "B-0106", "B-0107"]);
    // Even then, wing stays a real column — the number is a label, not the data.
    expect(units.every((u: any) => u.wing === "B")).toBe(true);
  });

  it("drops the wing token cleanly when the tower has no wing", async () => {
    await configureWinged("");
    selectPattern("{WING}-{FLOOR:02}{UNIT:02}");
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 84 Units/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Confirm & Create 84 Units/));

    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes("bulk-generate"))).toBe(true));
    const units = submittedUnits();

    // "{WING}-{FLOOR:02}{UNIT:02}" must not leave a leading separator behind.
    expect(units.filter((u: any) => u.floor === 1).map((u: any) => u.flat_no))
      .toEqual(["0101", "0102", "0103", "0104", "0105", "0106", "0107"]);
    expect(units.every((u: any) => u.wing === null)).toBe(true);
  });

  it("shows the building context above the preview matrix", async () => {
    await configureWinged("B");
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Confirm & Create 84 Units/)).toBeTruthy());
    expect(screen.getAllByTitle(/^Colossal\s+•\s+Tower A\s+•\s+Wing B$/).length).toBeGreaterThan(0);
  });
});

describe("position validation", () => {
  it("refuses a duplicate position", async () => {
    await configure(["2BHK", "2BHK"]);
    const posInputs = screen.getAllByPlaceholderText("01");
    fireEvent.change(posInputs[1], { target: { value: "1" } });
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/Position 01 already exists/)).toBeTruthy());
  });

  it("refuses a position with no carpet area, which the API would silently skip", async () => {
    render(<BulkGenerateUnitsModal isOpen onClose={() => {}} user={user} isDark={false} t={t} defaults={{ project_name: "VR Buildcom", tower: "A" }} />);
    await waitFor(() => expect(screen.getByPlaceholderText("e.g. 12")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("e.g. 12"), { target: { value: "12" } });
    fireEvent.click(screen.getByText(/Generate Preview/));
    await waitFor(() => expect(screen.getByText(/needs a carpet area/)).toBeTruthy());
  });
});
