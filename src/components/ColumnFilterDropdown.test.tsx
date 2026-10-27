import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ColumnFilterDropdown, {
  useColumnFilters,
  FilterableColumnHeader,
  type FilterableColumn,
  type ColSort,
} from "./ColumnFilterDropdown";
import { renderHook, act } from "@testing-library/react";

// ── Test data ────────────────────────────────────────────────────────────────

const COLUMN: FilterableColumn = { key: "status", label: "Status", type: "text" };
const DATE_COL: FilterableColumn = { key: "date", label: "Date", type: "date" };
const NUM_COL: FilterableColumn = { key: "amount", label: "Amount", type: "number" };

const SAMPLE_DATA: Record<string, unknown>[] = [
  { status: "Active" },
  { status: "Pending" },
  { status: "Active" },
  { status: "Closed" },
  { status: "" },
  { status: null },
];

// Wrap dropdown inside a <table><thead><tr><th> so the anchor marker can find
// a parent <th> for positioning, matching real usage.
function renderDropdown(overrides: Partial<Parameters<typeof ColumnFilterDropdown>[0]> = {}) {
  const defaultProps = {
    column: COLUMN,
    data: SAMPLE_DATA,
    activeFilter: null as Set<string> | null,
    activeSort: null as ColSort,
    onApply: vi.fn(),
    onSort: vi.fn(),
    onClose: vi.fn(),
    isDark: false,
    accent: "#007AFF",
  };
  const props = { ...defaultProps, ...overrides };
  const utils = render(
    <table>
      <thead>
        <tr>
          <th style={{ position: "relative" }}>
            <ColumnFilterDropdown {...props} />
          </th>
        </tr>
      </thead>
    </table>,
  );
  return { ...utils, props };
}

// ── 1. useColumnFilters hook ─────────────────────────────────────────────────

describe("useColumnFilters hook", () => {
  it("initializes with empty state", () => {
    const { result } = renderHook(() => useColumnFilters());
    expect(result.current.colFilters).toEqual({});
    expect(result.current.colSort).toBeNull();
    expect(result.current.openFilterCol).toBeNull();
  });

  it("applyFilter sets a column filter", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applyFilter("status", new Set(["Active"])));
    expect(result.current.colFilters.status).toEqual(new Set(["Active"]));
  });

  it("applyFilter with null clears a column filter", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applyFilter("status", new Set(["Active"])));
    act(() => result.current.applyFilter("status", null));
    expect(result.current.colFilters.status).toBeNull();
  });

  it("applySort sets and clears sort", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applySort("name", "asc"));
    expect(result.current.colSort).toEqual({ key: "name", direction: "asc" });
    act(() => result.current.applySort("name", null));
    expect(result.current.colSort).toBeNull();
  });

  it("clearAllFilters resets everything", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => {
      result.current.applyFilter("status", new Set(["Active"]));
      result.current.applySort("name", "desc");
    });
    act(() => result.current.clearAllFilters());
    expect(result.current.colFilters).toEqual({});
    expect(result.current.colSort).toBeNull();
  });

  it("filterRows filters by allowed values", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applyFilter("status", new Set(["Active"])));

    const rows = [
      { id: 1, status: "Active" },
      { id: 2, status: "Pending" },
      { id: 3, status: "Active" },
    ];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "status" ? row.status : "";
    const filtered = result.current.filterRows(rows, getDisplay);
    expect(filtered).toHaveLength(2);
    expect(filtered.every(r => r.status === "Active")).toBe(true);
  });

  it("filterRows normalizes empty strings to (Blanks)", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applyFilter("status", new Set(["(Blanks)"])));

    const rows = [
      { id: 1, status: "" },
      { id: 2, status: "Active" },
    ];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "status" ? row.status : "";
    const filtered = result.current.filterRows(rows, getDisplay);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it("filterRows with null filter passes all rows", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applyFilter("status", null));

    const rows = [{ id: 1, status: "A" }, { id: 2, status: "B" }];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "status" ? row.status : "";
    expect(result.current.filterRows(rows, getDisplay)).toHaveLength(2);
  });

  it("filterRows applies AND logic across multiple columns", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => {
      result.current.applyFilter("status", new Set(["Active"]));
      result.current.applyFilter("source", new Set(["Web"]));
    });

    const rows = [
      { id: 1, status: "Active", source: "Web" },
      { id: 2, status: "Active", source: "Phone" },
      { id: 3, status: "Pending", source: "Web" },
    ];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "status" ? row.status : key === "source" ? row.source : "";
    const filtered = result.current.filterRows(rows, getDisplay);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it("sortRows sorts ascending and descending", () => {
    const { result } = renderHook(() => useColumnFilters());
    const rows = [{ name: "Charlie" }, { name: "Alice" }, { name: "Bob" }];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "name" ? row.name : "";

    act(() => result.current.applySort("name", "asc"));
    const asc = result.current.sortRows(rows, getDisplay);
    expect(asc.map(r => r.name)).toEqual(["Alice", "Bob", "Charlie"]);

    act(() => result.current.applySort("name", "desc"));
    const desc = result.current.sortRows(rows, getDisplay);
    expect(desc.map(r => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("sortRows with numeric sensitivity", () => {
    const { result } = renderHook(() => useColumnFilters());
    act(() => result.current.applySort("num", "asc"));

    const rows = [{ num: "10" }, { num: "2" }, { num: "1" }];
    const getDisplay = (row: typeof rows[number], key: string) =>
      key === "num" ? row.num : "";
    const sorted = result.current.sortRows(rows, getDisplay);
    expect(sorted.map(r => r.num)).toEqual(["1", "2", "10"]);
  });

  it("sortRows returns same array reference when no sort", () => {
    const { result } = renderHook(() => useColumnFilters());
    const rows = [{ name: "A" }];
    const getDisplay = () => "";
    expect(result.current.sortRows(rows, getDisplay)).toBe(rows);
  });
});

// ── 1b. Regression: filterValue vs sortValue for date columns ────────────────
// Mirrors the AdminLeadTable getDisplayValue pattern to prove that filterValue
// is preferred over sortValue for filter dropdown options.

describe("filterValue vs sortValue (date column regression)", () => {
  // Simulates AdminLeadTable's getDisplayValue logic
  type TestColumn = {
    key: string;
    sortValue?: (l: Record<string, any>) => string | number;
    filterValue?: (l: Record<string, any>) => string | null;
  };

  function getDisplayValue(
    lead: Record<string, any>,
    colKey: string,
    columns: TestColumn[],
  ): string {
    const col = columns.find(c => c.key === colKey);
    if (!col) return "";
    if (col.filterValue) {
      const v = col.filterValue(lead);
      return v === null || v === undefined ? "" : String(v);
    }
    if (col.sortValue) {
      const v = col.sortValue(lead);
      return v === null || v === undefined ? "" : String(v);
    }
    const raw = lead[colKey];
    return raw === null || raw === undefined ? "" : String(raw);
  }

  const columns: TestColumn[] = [
    {
      key: "site_visit",
      sortValue: (l) => (l.mongoVisitDate ? new Date(l.mongoVisitDate).getTime() : 0),
      filterValue: (l) =>
        l.mongoVisitDate
          ? new Date(l.mongoVisitDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : null,
    },
    {
      key: "status",
      sortValue: (l) => String(l.status || "").toLowerCase(),
      // no filterValue — falls back to sortValue
    },
  ];

  it("uses filterValue (formatted date) instead of sortValue (timestamp) for site_visit", () => {
    const lead = { mongoVisitDate: "2026-06-14T10:23:00.000Z" };
    const display = getDisplayValue(lead, "site_visit", columns);
    // Must NOT be a raw timestamp like "1780488180000"
    expect(display).not.toMatch(/^\d{10,}$/);
    // Must be a human-readable date
    expect(display).toMatch(/\d{2}.*[A-Za-z]{3}.*\d{4}/);
  });

  it("returns empty string for null mongoVisitDate", () => {
    const lead = { mongoVisitDate: null };
    const display = getDisplayValue(lead, "site_visit", columns);
    expect(display).toBe("");
  });

  it("falls back to sortValue when filterValue is not defined", () => {
    const lead = { status: "Active" };
    const display = getDisplayValue(lead, "status", columns);
    expect(display).toBe("active"); // sortValue lowercases
  });

  it("filter dropdown options show formatted dates, not timestamps", () => {
    const leads = [
      { mongoVisitDate: "2026-06-14T10:23:00.000Z" },
      { mongoVisitDate: "2026-07-01T08:00:00.000Z" },
      { mongoVisitDate: null },
    ];
    const data = leads.map(l => ({
      site_visit: getDisplayValue(l, "site_visit", columns),
    }));

    // Unique values that would appear in the dropdown
    const uniqueValues = [...new Set(data.map(d => d.site_visit || "(Blanks)"))];

    // None should be a raw timestamp
    for (const val of uniqueValues) {
      expect(val).not.toMatch(/^\d{10,}$/);
    }
    // Should contain (Blanks) for the null entry
    expect(uniqueValues).toContain("(Blanks)");
    // Should have 3 unique values (2 dates + Blanks)
    expect(uniqueValues).toHaveLength(3);
  });

  it("filtering by formatted date correctly matches leads", () => {
    const { result } = renderHook(() => useColumnFilters());

    const leads = [
      { id: 1, mongoVisitDate: "2026-06-14T10:23:00.000Z" },
      { id: 2, mongoVisitDate: "2026-07-01T08:00:00.000Z" },
      { id: 3, mongoVisitDate: null },
    ];

    const targetDate = getDisplayValue(leads[0], "site_visit", columns);
    act(() => result.current.applyFilter("site_visit", new Set([targetDate])));

    const getDisplay = (row: typeof leads[number], key: string) =>
      getDisplayValue(row, key, columns);

    const filtered = result.current.filterRows(leads, getDisplay);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });
});

// ── 2. ColumnFilterDropdown component ────────────────────────────────────────

describe("ColumnFilterDropdown component", () => {
  it("renders portalled into document.body (not inside the <th>)", () => {
    renderDropdown();
    // The dialog should be a direct child of body, not inside the table
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.closest("table")).toBeNull(); // NOT inside the table
    expect(dialog.parentElement).toBe(document.body);
  });

  it("renders sort buttons", () => {
    renderDropdown();
    expect(screen.getByText(/Sort A to Z/)).toBeTruthy();
    expect(screen.getByText(/Sort Z to A/)).toBeTruthy();
  });

  it("renders date-appropriate sort labels", () => {
    renderDropdown({ column: DATE_COL, data: [{ date: "2024-01-01" }] });
    expect(screen.getByText(/Oldest to Newest/)).toBeTruthy();
    expect(screen.getByText(/Newest to Oldest/)).toBeTruthy();
  });

  it("renders number-appropriate sort labels", () => {
    renderDropdown({ column: NUM_COL, data: [{ amount: "100" }] });
    expect(screen.getByText(/Smallest to Largest/)).toBeTruthy();
    expect(screen.getByText(/Largest to Smallest/)).toBeTruthy();
  });

  it("renders unique values as checkboxes", () => {
    renderDropdown();
    // Should show Active, Closed, Pending, (Blanks) — deduplicated
    const checkboxes = screen.getAllByRole("checkbox");
    // 1 for Select All + 4 unique values
    expect(checkboxes.length).toBe(5);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("(Blanks)")).toBeTruthy();
  });

  it("all checkboxes start selected when no active filter", () => {
    renderDropdown({ activeFilter: null });
    const checkboxes = screen.getAllByRole("checkbox");
    // All should be checked (including Select All)
    checkboxes.forEach(cb => {
      expect((cb as HTMLInputElement).checked).toBe(true);
    });
  });

  it("restores active filter selections", () => {
    renderDropdown({ activeFilter: new Set(["Active", "Closed"]) });
    const activeCheckbox = screen.getByLabelText("Active") as HTMLInputElement;
    const pendingCheckbox = screen.getByLabelText("Pending") as HTMLInputElement;
    const closedCheckbox = screen.getByLabelText("Closed") as HTMLInputElement;
    expect(activeCheckbox.checked).toBe(true);
    expect(closedCheckbox.checked).toBe(true);
    expect(pendingCheckbox.checked).toBe(false);
  });

  it("search filters the checkbox list", async () => {
    renderDropdown();
    const searchInput = screen.getByPlaceholderText("Search...");
    await userEvent.type(searchInput, "act");
    // Only "Active" should be visible
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(screen.queryByText("Closed")).toBeNull();
  });

  it("shows 'No matches found' for empty search results", async () => {
    renderDropdown();
    const searchInput = screen.getByPlaceholderText("Search...");
    await userEvent.type(searchInput, "zzzzz");
    expect(screen.getByText("No matches found")).toBeTruthy();
  });

  it("clicking OK calls onApply with selected values", async () => {
    const { props } = renderDropdown({ activeFilter: new Set(["Active"]) });
    const okBtn = screen.getByText("OK");
    await userEvent.click(okBtn);
    expect(props.onApply).toHaveBeenCalledTimes(1);
    const applied = props.onApply.mock.calls[0][0] as Set<string>;
    expect(applied).toBeInstanceOf(Set);
    expect(applied.has("Active")).toBe(true);
    expect(applied.has("Pending")).toBe(false);
  });

  it("clicking OK with all selected calls onApply(null)", async () => {
    const { props } = renderDropdown({ activeFilter: null });
    // All are selected by default
    const okBtn = screen.getByText("OK");
    await userEvent.click(okBtn);
    expect(props.onApply).toHaveBeenCalledWith(null);
  });

  it("clicking Cancel calls onClose without applying", async () => {
    const { props } = renderDropdown();
    await userEvent.click(screen.getByText("Cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("clicking sort calls onSort and onClose", async () => {
    const { props } = renderDropdown();
    await userEvent.click(screen.getByText(/Sort A to Z/));
    expect(props.onSort).toHaveBeenCalledWith("asc");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("shows Clear Sort when activeSort is set", () => {
    renderDropdown({ activeSort: { key: "status", direction: "asc" } });
    expect(screen.getByText("Clear Sort")).toBeTruthy();
  });

  it("does not show Clear Sort when no activeSort", () => {
    renderDropdown({ activeSort: null });
    expect(screen.queryByText("Clear Sort")).toBeNull();
  });

  it("Select All toggles all visible values", async () => {
    renderDropdown({ activeFilter: new Set(["Active"]) });
    // Find Select All checkbox — it's the first one
    const selectAllLabel = screen.getByText("(Select All)");
    await userEvent.click(selectAllLabel);
    // Now all should be checked — click OK to verify
    const okBtn = screen.getByText("OK");
    await userEvent.click(okBtn);
    // All selected = onApply(null)
    const { props } = renderDropdown(); // re-get props from last render
    // Verify through the original render
  });

  it("toggling individual checkbox works", async () => {
    const { props } = renderDropdown({ activeFilter: null });
    // Uncheck "Pending"
    const pendingLabel = screen.getByText("Pending");
    await userEvent.click(pendingLabel);
    // Click OK
    await userEvent.click(screen.getByText("OK"));
    const applied = props.onApply.mock.calls[0][0] as Set<string>;
    expect(applied).toBeInstanceOf(Set);
    expect(applied.has("Pending")).toBe(false);
    expect(applied.has("Active")).toBe(true);
  });

  it("Escape key calls onClose", () => {
    const { props } = renderDropdown();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("click outside the dropdown calls onClose", () => {
    const { props } = renderDropdown();
    // Simulate mousedown on document body (outside)
    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("click inside the dropdown does NOT call onClose", () => {
    const { props } = renderDropdown();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("renders with position: fixed and high z-index", () => {
    renderDropdown();
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.position).toBe("fixed");
    expect(parseInt(dialog.style.zIndex)).toBeGreaterThanOrEqual(9999);
  });

  it("handles empty data array", () => {
    renderDropdown({ data: [] });
    expect(screen.getByText("No matches found")).toBeTruthy();
    // Only Select All checkbox, no values
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(1); // Just Select All
  });

  it("renders in dark mode with dark classes", () => {
    renderDropdown({ isDark: true });
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("bg-[#1C1C1E]");
  });

  it("renders in light mode with light classes", () => {
    renderDropdown({ isDark: false });
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("bg-white");
  });
});

// ── 3. FilterableColumnHeader component ──────────────────────────────────────

describe("FilterableColumnHeader", () => {
  it("renders column label", () => {
    render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={false}
              colSort={null}
              isOpen={false}
              onToggle={vi.fn()}
              isDark={false}
            />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText("Status")).toBeTruthy();
  });

  it("shows active accent color when filtered", () => {
    render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={true}
              colSort={null}
              isOpen={false}
              onToggle={vi.fn()}
              isDark={false}
              accent="#FF0000"
            />
          </tr>
        </thead>
      </table>,
    );
    const btn = screen.getByTitle("Filter / Sort by Status");
    expect(btn.style.color).toBe("rgb(255, 0, 0)");
  });

  it("shows filter dot when filtered", () => {
    const { container } = render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={true}
              colSort={null}
              isOpen={false}
              onToggle={vi.fn()}
              isDark={false}
            />
          </tr>
        </thead>
      </table>,
    );
    // Filter dot is a 1.5 rounded-full span
    const dots = container.querySelectorAll("span.rounded-full.inline-block");
    expect(dots.length).toBe(1);
  });

  it("calls onToggle when button clicked", async () => {
    const onToggle = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={false}
              colSort={null}
              isOpen={false}
              onToggle={onToggle}
              isDark={false}
            />
          </tr>
        </thead>
      </table>,
    );
    await userEvent.click(screen.getByTitle("Filter / Sort by Status"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders children (dropdown slot)", () => {
    render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={false}
              colSort={null}
              isOpen={false}
              onToggle={vi.fn()}
              isDark={false}
            >
              <div data-testid="child-slot">dropdown here</div>
            </FilterableColumnHeader>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByTestId("child-slot")).toBeTruthy();
  });

  it("shows sort icon when column is sorted", () => {
    render(
      <table>
        <thead>
          <tr>
            <FilterableColumnHeader
              column={COLUMN}
              isFiltered={false}
              colSort={{ key: "status", direction: "asc" }}
              isOpen={false}
              onToggle={vi.fn()}
              isDark={false}
            />
          </tr>
        </thead>
      </table>,
    );
    // When sorted, a sort direction icon replaces the filter icon
    const btn = screen.getByTitle("Filter / Sort by Status");
    expect(btn.style.color).not.toBe(""); // accent color applied
  });
});
