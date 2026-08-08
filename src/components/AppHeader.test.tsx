// AppHeader.test.tsx — the header's contract.
//
// The parts pinned here are the ones a later "tidy-up" would plausibly undo:
// the page context must be whatever the host passes (not a hardcoded word), the
// logo must stay inside the bar, and the controls must share one height. All
// three were the actual defects in the headers this replaced.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppHeader, { APP_HEADER_HEIGHT, HeaderControl } from "./AppHeader";

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
    expect(logo.className).toContain("h-8");
    expect(logo.className).not.toMatch(/h-(1[6-9]|20)/);
    expect(APP_HEADER_HEIGHT).toBe("h-16");
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
