// @vitest-environment node
//
// Tests for describeDevice() — the User-Agent parser that populates
// the LOGIN DEVICE section of login security emails.
//
// Covers:
//   1. Android / OPPO  (CPH prefix)
//   2. Android / realme (RMX prefix)
//   3. iPhone / iOS
//   4. Windows + Chrome
//   5. macOS + Safari
//   6. Unknown / empty UA fallback
//   7. Android tablet (no "Mobile" token)
//   8. Samsung (SM- prefix)
//   9. Google Pixel (readable model kept)

import { describe, expect, it } from "vitest";
import { describeDevice } from "./emailRouting";

// ── Representative User-Agent strings ────────────────────────────────────

const UA = {
  oppo: "Mozilla/5.0 (Linux; Android 15; CPH2505 Build/AP3A.241105.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36",
  realme: "Mozilla/5.0 (Linux; Android 14; RMX3393 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.102 Mobile Safari/537.36",
  pixel: "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A.241105.008) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.200 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X810 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  unknown: "",
};

// ── Device name ──────────────────────────────────────────────────────────

describe("describeDevice — deviceName", () => {
  it("identifies OPPO from CPH prefix", () => {
    expect(describeDevice(UA.oppo).deviceName).toBe("OPPO");
  });

  it("identifies realme from RMX prefix", () => {
    expect(describeDevice(UA.realme).deviceName).toBe("realme");
  });

  it("identifies iPhone", () => {
    expect(describeDevice(UA.iphone).deviceName).toBe("iPhone");
  });

  it("identifies Windows PC", () => {
    expect(describeDevice(UA.windowsChrome).deviceName).toBe("Windows PC");
  });

  it("identifies Mac", () => {
    expect(describeDevice(UA.macSafari).deviceName).toBe("Mac");
  });

  it("identifies Samsung from SM- prefix", () => {
    expect(describeDevice(UA.samsung).deviceName).toBe("Samsung");
  });

  it("identifies Google Pixel with model name", () => {
    expect(describeDevice(UA.pixel).deviceName).toBe("Google Pixel 8");
  });

  it("falls back to Unknown Device for empty UA", () => {
    expect(describeDevice(UA.unknown).deviceName).toBe("Unknown Device");
  });

  it("identifies iPad", () => {
    expect(describeDevice(UA.ipad).deviceName).toBe("iPad");
  });
});

// ── Device type ──────────────────────────────────────────────────────────

describe("describeDevice — deviceType", () => {
  it("OPPO Android phone → Mobile", () => {
    expect(describeDevice(UA.oppo).deviceType).toBe("Mobile");
  });

  it("realme Android phone → Mobile", () => {
    expect(describeDevice(UA.realme).deviceType).toBe("Mobile");
  });

  it("iPhone → Mobile", () => {
    expect(describeDevice(UA.iphone).deviceType).toBe("Mobile");
  });

  it("Windows desktop → Desktop", () => {
    expect(describeDevice(UA.windowsChrome).deviceType).toBe("Desktop");
  });

  it("macOS desktop → Desktop", () => {
    expect(describeDevice(UA.macSafari).deviceType).toBe("Desktop");
  });

  it("Android tablet (no Mobile token) → Tablet", () => {
    expect(describeDevice(UA.androidTablet).deviceType).toBe("Tablet");
  });

  it("iPad → Tablet", () => {
    expect(describeDevice(UA.ipad).deviceType).toBe("Tablet");
  });

  it("empty UA → Desktop fallback", () => {
    expect(describeDevice(UA.unknown).deviceType).toBe("Desktop");
  });
});

// ── OS with version ──────────────────────────────────────────────────────

describe("describeDevice — osWithVersion", () => {
  it("extracts Android version", () => {
    expect(describeDevice(UA.oppo).osWithVersion).toBe("Android 15");
  });

  it("extracts iOS version (major.minor only)", () => {
    expect(describeDevice(UA.iphone).osWithVersion).toBe("iOS 18.1");
  });

  it("extracts Windows version", () => {
    expect(describeDevice(UA.windowsChrome).osWithVersion).toBe("Windows 10/11");
  });

  it("extracts macOS version", () => {
    expect(describeDevice(UA.macSafari).osWithVersion).toBe("macOS 14.0");
  });

  it("extracts Android 14 for realme", () => {
    expect(describeDevice(UA.realme).osWithVersion).toBe("Android 14");
  });

  it("falls back to base OS for empty UA", () => {
    expect(describeDevice(UA.unknown).osWithVersion).toBe("Unknown OS");
  });
});

// ── Browser ──────────────────────────────────────────────────────────────

describe("describeDevice — browser", () => {
  it("detects Chrome on Android", () => {
    expect(describeDevice(UA.oppo).browser).toBe("Chrome");
  });

  it("detects Safari on iPhone", () => {
    expect(describeDevice(UA.iphone).browser).toBe("Safari");
  });

  it("detects Chrome on Windows", () => {
    expect(describeDevice(UA.windowsChrome).browser).toBe("Chrome");
  });

  it("detects Safari on macOS", () => {
    expect(describeDevice(UA.macSafari).browser).toBe("Safari");
  });

  it("falls back to Unknown browser for empty UA", () => {
    expect(describeDevice(UA.unknown).browser).toBe("Unknown browser");
  });
});

// ── Backward compatibility ───────────────────────────────────────────────

describe("describeDevice — existing fields (label, os, browser)", () => {
  it("label is still os / browser", () => {
    const d = describeDevice(UA.windowsChrome);
    expect(d.label).toBe("Windows 10/11 / Chrome");
  });

  it("os field is the short form (no version beyond marketing name)", () => {
    expect(describeDevice(UA.oppo).os).toBe("Android");
    expect(describeDevice(UA.iphone).os).toBe("iOS");
    expect(describeDevice(UA.macSafari).os).toBe("macOS");
  });
});

// ── Same info in both user and admin emails ──────────────────────────────

describe("describeDevice — deterministic output", () => {
  it("returns identical results for the same UA string", () => {
    const first = describeDevice(UA.samsung);
    const second = describeDevice(UA.samsung);
    expect(first).toEqual(second);
  });
});
