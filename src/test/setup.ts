// Test setup, loaded before every suite.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmount between tests. Without this, a component left mounted keeps its focus
// and `document.activeElement` assertions in the next test read the previous
// test's DOM.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// jsdom does not implement requestAnimationFrame's timing, and OTPInput uses it
// to move focus after a state commit. Running the callback on a macrotask keeps
// the ordering the browser has — the React render flushes first, then focus
// moves — which is exactly the sequence the component depends on.
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
}

// jsdom implements select() but not the selection state that follows it; the
// component only ever calls it, never reads back, so a no-op-safe stub keeps
// the calls from throwing on detached nodes.
if (!HTMLInputElement.prototype.select) {
  HTMLInputElement.prototype.select = function select() {
    this.setSelectionRange?.(0, this.value.length);
  };
}
