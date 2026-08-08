// Vitest — component tests.
//
// ── No @vitejs/plugin-react ─────────────────────────────────────────────────
// The plugin exists for Fast Refresh and HMR, neither of which a test run uses,
// and its current major requires Vite 8 while Vitest 3 pins Vite 7 — installing
// both produced two copies of Vite and a type conflict between them.
//
// Vitest transforms JSX with esbuild on its own; it just needs to be told which
// runtime, because the app's tsconfig says `"jsx": "preserve"` for Next's
// compiler and esbuild would otherwise pass the JSX through untouched.
//
// ── Scope ───────────────────────────────────────────────────────────────────
// `src/**/*.test.{ts,tsx}` only. `e2e/` holds long-lived Puppeteer scripts that
// drive a real browser against a running server; picking those up here would
// try to launch Chrome inside jsdom.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Without it every import in
    // the components under test fails to resolve.
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
