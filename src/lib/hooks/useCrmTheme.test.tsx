// useCrmTheme — the requirement that a header toggle and the Preferences radio
// group drive the same value.
//
// Before this existed, six components each held their own `isDark` and none of
// them agreed: toggling in the header did nothing to the setting in Preferences,
// and choosing a theme in Preferences did not repaint the header.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCrmTheme } from "./useCrmTheme";
import { clearTheme, setTheme } from "@/lib/theme";

/** Stands in for the toggle button in every dashboard header. */
function HeaderToggle() {
  const { isDark, toggleTheme } = useCrmTheme();
  return (
    <button onClick={toggleTheme} data-testid="header-toggle" aria-pressed={isDark}>
      {isDark ? "sun" : "moon"}
    </button>
  );
}

/** Stands in for the Preferences → Theme radio group. */
function PreferencesRadios() {
  const { theme, setTheme: apply } = useCrmTheme();
  return (
    <div>
      <output data-testid="pref-value">{theme}</output>
      <button onClick={() => apply("light")} data-testid="pref-light">
        Light mode
      </button>
      <button onClick={() => apply("dark")} data-testid="pref-dark">
        Dark mode
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-crm-theme");
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCrmTheme", () => {
  it("adopts the stored theme after hydration", async () => {
    setTheme("dark");
    render(<HeaderToggle />);
    // The first render matches the server (light); the effect adopts the real
    // value immediately after, which is what avoids a hydration mismatch.
    expect(await screen.findByText("sun")).toBeInTheDocument();
  });

  it("the header toggle and the Preferences radios move together", async () => {
    const user = userEvent.setup();
    // Both mounted at once, exactly as they are on the Preferences page — the
    // Settings header sits above the radio group.
    render(
      <>
        <HeaderToggle />
        <PreferencesRadios />
      </>
    );

    await act(async () => {});

    // Choosing in Preferences repaints the header.
    await user.click(screen.getByTestId("pref-dark"));
    expect(screen.getByTestId("pref-value")).toHaveTextContent("dark");
    expect(screen.getByTestId("header-toggle")).toHaveTextContent("sun");
    expect(screen.getByTestId("header-toggle")).toHaveAttribute("aria-pressed", "true");

    // And the header toggle updates the setting.
    await user.click(screen.getByTestId("header-toggle"));
    expect(screen.getByTestId("pref-value")).toHaveTextContent("light");
    expect(screen.getByTestId("header-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  it("a change from one component reaches a separately mounted tree", async () => {
    const user = userEvent.setup();
    // Two independent render roots, standing in for components in different
    // route trees that share no React provider.
    render(<HeaderToggle />);
    render(<PreferencesRadios />);

    await act(async () => {});

    await user.click(screen.getByTestId("pref-dark"));
    expect(screen.getByTestId("header-toggle")).toHaveTextContent("sun");
  });

  it("persists the choice for the next sign-in", async () => {
    const user = userEvent.setup();
    localStorage.setItem("crm_user", JSON.stringify({ _id: "1" }));
    render(<PreferencesRadios />);
    await act(async () => {});

    await user.click(screen.getByTestId("pref-dark"));

    expect(localStorage.getItem("crm_theme")).toBe("dark");
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(JSON.parse(calls[calls.length - 1][1].body)).toEqual({ theme: "dark" });
  });

  it("follows a logout", async () => {
    setTheme("dark");
    render(<HeaderToggle />);
    await act(async () => {});
    expect(screen.getByTestId("header-toggle")).toHaveTextContent("sun");

    // clearCrmSession() calls clearTheme(), so the next user does not inherit
    // the previous one's theme.
    await act(async () => {
      clearTheme();
    });

    expect(screen.getByTestId("header-toggle")).toHaveTextContent("moon");
  });

  it("follows a change made in another tab", async () => {
    render(<HeaderToggle />);
    await act(async () => {});
    expect(screen.getByTestId("header-toggle")).toHaveTextContent("moon");

    await act(async () => {
      // localStorage is written BEFORE the event, because that is the order a
      // real browser produces: the other tab's write lands in shared storage
      // and `storage` is the notification that it happened. The hook reads the
      // store rather than trusting the event payload, so a synthetic event with
      // no matching write would be correctly ignored.
      localStorage.setItem("crm_theme", "dark");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "crm_theme", newValue: "dark" })
      );
    });

    expect(screen.getByTestId("header-toggle")).toHaveTextContent("sun");
  });
});
