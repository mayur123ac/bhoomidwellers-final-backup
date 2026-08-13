// AppHeader.test.tsx — the header's contract.
//
// The parts pinned here are the ones a later "tidy-up" would plausibly undo:
// the page context must be whatever the host passes (not a hardcoded word), the
// logo must stay inside the bar, and the controls must share one height. All
// three were the actual defects in the headers this replaced.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppHeader, { APP_HEADER_HEIGHT, AppLogo, HeaderControl } from "./AppHeader";

describe("page context", () => {
  it("shows whatever the host passes, verbatim", () => {
    // The old Settings header built its own string and the Sales header showed
    // a fixed "— Sales Manager"; neither could say which page you were on.
    for (const context of [
      "Dashboard",
      "Assigned Leads",
      "Inventory",
      "Settings · Profile",
      "Settings · Notifications",
      "Settings · Account & Security",
    ]) {
      const { unmount } = render(
        <AppHeader isDark={false} context={context} role="Sales Manager">
          <span />
        </AppHeader>
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(context);
      unmount();
    }
  });

  it("does not hardcode 'Settings' anywhere", () => {
    render(
      <AppHeader isDark={false} context="Inventory" role="Sales Manager">
        <span />
      </AppHeader>
    );
    expect(screen.queryByText(/settings/i)).toBeNull();
  });

  it("renders without a context, for hosts that have none yet", () => {
    render(
      <AppHeader isDark={false}>
        <span />
      </AppHeader>
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("branding and role", () => {
  it("keeps the Bhoomi Dwellers logo, sized to fit the bar", () => {
    render(
      <AppHeader isDark={false} context="Dashboard" role="Sales Manager">
        <span />
      </AppHeader>
    );
    const logo = screen.getByAltText("Bhoomi Dwellers");
    // The previous rule was `h-20 md:h-18` inside an h-16 bar — a 5rem logo in
    // a 4rem header, which is what made the branding look oversized.
    expect(logo.className).toContain("h-12");
    expect(logo.className).not.toMatch(/h-(1[6-9]|20)/);
    expect(APP_HEADER_HEIGHT).toBe("h-16");
  });

  it("renders the same logo element the standalone dashboards use", () => {
    // The four dashboards that still build their own bar import <AppLogo />
    // rather than repeating an <img>. Rendering it here alongside the header's
    // own is what catches the two drifting apart again — which is exactly how
    // the logo ended up three different sizes in the first place.
    const { container } = render(<AppLogo />);
    const standalone = container.querySelector("img")!;

    render(
      <AppHeader isDark={false} context="Dashboard">
        <span />
      </AppHeader>
    );
    const inHeader = screen.getAllByAltText("Bhoomi Dwellers").at(-1)!;

    expect(standalone.className).toBe(inHeader.className);
  });

  it("shows the role badge", () => {
    render(
      <AppHeader isDark={false} context="Dashboard" role="Sales Manager">
        <span />
      </AppHeader>
    );
    expect(screen.getByText("Sales Manager")).toBeInTheDocument();
  });
});

describe("controls", () => {
  it("renders host controls and keeps them one height", () => {
    render(
      <AppHeader isDark={false} context="Dashboard" role="Admin">
        <HeaderControl isDark={false} label="Toggle theme">
          <span>T</span>
        </HeaderControl>
        <HeaderControl isDark={false} label="Notifications">
          <span>N</span>
        </HeaderControl>
      </AppHeader>
    );

    const theme = screen.getByLabelText("Toggle theme");
    const bell = screen.getByLabelText("Notifications");
    // One size for every control is the whole of the "consistent controls"
    // requirement — previously these were w-9/h-9, w-10/h-10 and an unstyled
    // bare glyph sitting between them.
    expect(theme.className).toContain("h-9");
    expect(theme.className).toContain("w-9");
    expect(bell.className).toContain("h-9");
    expect(bell.className).toContain("w-9");
  });

  it("puts the leading slot before the rest", () => {
    render(
      <AppHeader
        isDark={false}
        context="Settings · Profile"
        role="Sales Manager"
        leading={
          <HeaderControl isDark={false} label="Open settings sections">
            <span>M</span>
          </HeaderControl>
        }
      >
        <HeaderControl isDark={false} label="Toggle theme">
          <span>T</span>
        </HeaderControl>
      </AppHeader>
    );

    const drawer = screen.getByLabelText("Open settings sections");
    const theme = screen.getByLabelText("Toggle theme");
    expect(drawer.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ── Surface override ────────────────────────────────────────────────────────
// The Receptionist panel adopts this header for its structure — frame metrics,
// control sizes, icon system — while keeping its own locked palette. The risk
// that needs pinning is the other direction: that adding the override quietly
// changes the surface for the hosts that do NOT pass it, i.e. Settings.
describe("surface override", () => {
  const surfaceOf = () => screen.getByRole("banner");

  it("keeps the shared flat surface when the host passes nothing", () => {
    render(
      <AppHeader isDark={false} context="Settings · Profile" role="Receptionist">
        <span />
      </AppHeader>
    );
    // This is what Settings renders. If it ever stops being true, Settings has
    // been repainted by a change made for another panel.
    // toHaveStyle rather than reading .style: jsdom normalises hex to rgb(),
    // so a string compare would be asserting jsdom's formatting, not the colour.
    expect(surfaceOf()).toHaveStyle({
      background: "#FFFFFF",
      borderBottom: "1px solid #ECEDF1",
    });
  });

  it("hands the surface to the host when either prop is passed", () => {
    render(
      <AppHeader
        isDark={false}
        context="Dashboard"
        role="Receptionist"
        surfaceClassName="border-b bg-white border-[#9CA3AF]"
        surfaceStyle={{ boxShadow: "0 1px 0 #9CA3AF" }}
      >
        <span />
      </AppHeader>
    );
    const header = surfaceOf();
    expect(header.className).toContain("border-[#9CA3AF]");
    expect(header.style.boxShadow).toBe("0 1px 0 #9CA3AF");
    // The default must be gone rather than sitting underneath the host's.
    expect(header.style.borderBottom).toBe("");
  });

  it("keeps layout on the component, not on the override", () => {
    // Height and inset are exactly what hosts adopt this header for, so the
    // override must not be a route to them.
    render(
      <AppHeader
        isDark={false}
        context="Dashboard"
        role="Receptionist"
        surfaceClassName="bg-white"
      >
        <span />
      </AppHeader>
    );
    expect(surfaceOf().className).toContain(APP_HEADER_HEIGHT);
    expect(surfaceOf().className).toContain("px-4");
  });
});

// ── Control size ────────────────────────────────────────────────────────────
// The Receptionist bar runs its controls at 32px; every other host runs 36px.
// The regression worth pinning is a host that passes nothing silently changing
// size — i.e. the Receptionist's preference leaking into Settings and Sales.
describe("HeaderControl size", () => {
  it("is 36px when the host asks for nothing", () => {
    render(
      <HeaderControl isDark={false} label="Toggle theme">
        <span>T</span>
      </HeaderControl>
    );
    const btn = screen.getByLabelText("Toggle theme");
    expect(btn.className).toContain("h-9");
    expect(btn.className).toContain("w-9");
    expect(btn.className).not.toContain("h-8");
  });

  it('is 32px for size="sm"', () => {
    render(
      <HeaderControl isDark={false} size="sm" label="Notifications">
        <span>N</span>
      </HeaderControl>
    );
    const btn = screen.getByLabelText("Notifications");
    expect(btn.className).toContain("h-8");
    expect(btn.className).toContain("w-8");
    expect(btn.className).not.toContain("h-9");
  });

  it("keeps one border and one radius at either size", () => {
    // Size is the only thing that varies. If a second difference appears here,
    // the two sizes have started becoming two different controls.
    for (const size of ["sm", "md"] as const) {
      const { unmount } = render(
        <HeaderControl isDark={false} size={size} label="Control">
          <span>C</span>
        </HeaderControl>
      );
      const btn = screen.getByLabelText("Control");
      expect(btn.className).toContain("rounded-lg");
      expect(btn.className).toContain("border");
      expect(btn.className).toContain("flex-shrink-0");
      unmount();
    }
  });
});
