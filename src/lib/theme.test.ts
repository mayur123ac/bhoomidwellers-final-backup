// lib/theme.ts — storage, normalisation, cross-component sync, and the
// login/logout lifecycle that makes the choice survive a sign-out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME,
  THEME_BOOTSTRAP_SCRIPT,
  adoptServerTheme,
  clearTheme,
  getTheme,
  isDarkTheme,
  normaliseTheme,
  setTheme,
  subscribeToTheme,
  toggleTheme,
} from "./theme";

/** Pretend someone is signed in, so the server write is attempted. */
function signIn() {
  localStorage.setItem("crm_user", JSON.stringify({ _id: "1", name: "Test" }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-crm-theme");
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
  // Default to a light OS preference; individual tests override it.
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

/* ── Normalisation ────────────────────────────────────────────────────────── */

describe("normaliseTheme", () => {
  it("passes through the two real themes", () => {
    expect(normaliseTheme("dark")).toBe("dark");
    expect(normaliseTheme("light")).toBe("light");
  });

  it("resolves the retired 'system' value against the OS preference", () => {
    // Rows written before the third option was removed still hold "system".
    // It must resolve, not fall back to the default, or a user who had chosen
    // it would land on light while their OS is dark.
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    expect(normaliseTheme("system")).toBe("dark");

    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    expect(normaliseTheme("system")).toBe("light");
  });

  it("falls back to the default for junk", () => {
    for (const value of [null, undefined, "", "blue", 42, {}]) {
      expect(normaliseTheme(value)).toBe(DEFAULT_THEME);
    }
  });
});

/* ── Reading and writing ──────────────────────────────────────────────────── */

describe("getTheme / setTheme", () => {
  it("follows the OS preference when nothing is stored", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    expect(getTheme()).toBe("dark");
  });

  it("prefers an explicit stored choice over the OS", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    setTheme("light");
    expect(getTheme()).toBe("light");
  });

  it("persists to localStorage", () => {
    setTheme("dark");
    expect(localStorage.getItem("crm_theme")).toBe("dark");
    expect(isDarkTheme()).toBe(true);
  });

  it("mirrors onto the document for CSS and native widgets", () => {
    setTheme("dark");
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe("dark");
    // color-scheme is what makes scrollbars and date pickers follow along.
    expect(document.documentElement.style.colorScheme).toBe("dark");

    setTheme("light");
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("toggles between the two", () => {
    setTheme("light");
    expect(toggleTheme()).toBe("dark");
    expect(toggleTheme()).toBe("light");
  });
});

/* ── Server persistence ───────────────────────────────────────────────────── */

describe("server persistence", () => {
  it("saves the choice so it survives the next sign-in", () => {
    signIn();
    setTheme("dark");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/settings/preferences");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ theme: "dark" });
  });

  it("does not call the API when signed out", () => {
    // The endpoint needs a session; firing it from the login screen would 401
    // on every visit for nothing.
    setTheme("dark");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not echo a value that came from the server", () => {
    signIn();
    // adoptServerTheme is used at login and on the Preferences load. Writing
    // straight back would be a pointless PATCH on every page load.
    adoptServerTheme("dark");
    expect(fetch).not.toHaveBeenCalled();
    expect(getTheme()).toBe("dark");
  });

  it("resolves a legacy 'system' value coming from the server", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    adoptServerTheme("system");
    expect(getTheme()).toBe("dark");
  });

  it("a failing save does not throw", async () => {
    signIn();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => setTheme("dark")).not.toThrow();
    // Applied locally regardless — the user can see it worked.
    expect(getTheme()).toBe("dark");
    await Promise.resolve();
  });
});

/* ── The logout lifecycle ─────────────────────────────────────────────────── */

describe("logout", () => {
  it("drops the working copy so the next user does not inherit it", () => {
    signIn();
    setTheme("dark");
    expect(localStorage.getItem("crm_theme")).toBe("dark");

    clearTheme();

    expect(localStorage.getItem("crm_theme")).toBeNull();
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe(DEFAULT_THEME);
  });

  it("restores the signing-in user's own theme", () => {
    // User A picks dark, signs out; user B's row says light.
    signIn();
    setTheme("dark");
    clearTheme();

    adoptServerTheme("light");
    expect(getTheme()).toBe("light");
  });
});

/* ── Sync ─────────────────────────────────────────────────────────────────── */

describe("subscribeToTheme", () => {
  it("notifies listeners in this tab", () => {
    // This is what makes the header toggle and the Preferences radio group move
    // together: the browser does not fire `storage` in the tab that wrote.
    const seen: string[] = [];
    const stop = subscribeToTheme((t) => seen.push(t));

    setTheme("dark");
    setTheme("light");

    expect(seen).toEqual(["dark", "light"]);
    stop();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const stop = subscribeToTheme(listener);
    stop();
    setTheme("dark");
    expect(listener).not.toHaveBeenCalled();
  });

  it("follows a change made in another tab", () => {
    const listener = vi.fn();
    const stop = subscribeToTheme(listener);

    window.dispatchEvent(
      new StorageEvent("storage", { key: "crm_theme", newValue: "dark" })
    );

    expect(listener).toHaveBeenCalledWith("dark");
    stop();
  });

  it("treats a removal in another tab as a logout", () => {
    const listener = vi.fn();
    const stop = subscribeToTheme(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "crm_theme", newValue: null }));

    expect(listener).toHaveBeenCalledWith(DEFAULT_THEME);
    stop();
  });

  it("ignores unrelated storage keys", () => {
    const listener = vi.fn();
    const stop = subscribeToTheme(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "crm_user", newValue: "{}" }));
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

/* ── Pre-paint script ─────────────────────────────────────────────────────── */

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  /** Run the inline script the way the browser would, before React exists. */
  function runBootstrap() {
    new Function(THEME_BOOTSTRAP_SCRIPT)();
  }

  it("applies a stored dark theme before paint", () => {
    localStorage.setItem("crm_theme", "dark");
    runBootstrap();
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe("dark");
  });

  it("resolves a stored legacy 'system' value", () => {
    localStorage.setItem("crm_theme", "system");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    runBootstrap();
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe("dark");
  });

  it("falls back to light with nothing stored and a light OS", () => {
    runBootstrap();
    expect(document.documentElement.getAttribute("data-crm-theme")).toBe("light");
  });

  it("never throws, whatever storage does", () => {
    // It is the first script on the page; a throw here takes the document with
    // it, so the try/catch is load-bearing rather than defensive habit.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled by policy");
    });
    expect(() => runBootstrap()).not.toThrow();
    getItem.mockRestore();
  });
});
