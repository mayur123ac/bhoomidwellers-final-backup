import { describe, it, expect } from "vitest";
import { computeDealProgress, getScoreColors } from "./dealProgressScore";

describe("computeDealProgress", () => {
  it("Fresh (ordinal 1) → score 17, cold", () => {
    const r = computeDealProgress(1, true);
    expect(r.score).toBe(17);
    expect(r.temperature).toBe("cold");
    expect(r.tracked).toBe(true);
  });

  it("Contacted (ordinal 2) → score 33, cold", () => {
    const r = computeDealProgress(2, true);
    expect(r.score).toBe(33);
    expect(r.temperature).toBe("cold");
  });

  it("Site Visit (ordinal 3) → score 50, warm", () => {
    const r = computeDealProgress(3, true);
    expect(r.score).toBe(50);
    expect(r.temperature).toBe("warm");
  });

  it("Negotiation (ordinal 4) → score 67, hot", () => {
    const r = computeDealProgress(4, true);
    expect(r.score).toBe(67);
    expect(r.temperature).toBe("hot");
  });

  it("Sales (ordinal 5) → score 83, hot", () => {
    const r = computeDealProgress(5, true);
    expect(r.score).toBe(83);
    expect(r.temperature).toBe("hot");
  });

  it("Booked (ordinal 6) → score 100, booked", () => {
    const r = computeDealProgress(6, true);
    expect(r.score).toBe(100);
    expect(r.temperature).toBe("booked");
    expect(r.temperatureLabel).toBe("Booked");
  });

  it("untracked lead → tracked=false, score 0", () => {
    const r = computeDealProgress(0, false);
    expect(r.tracked).toBe(false);
    expect(r.score).toBe(0);
  });

  it("tracked=true but ordinal 0 → treated as untracked", () => {
    const r = computeDealProgress(0, true);
    expect(r.tracked).toBe(false);
    expect(r.score).toBe(0);
  });

  it("negative ordinal → safe fallback untracked", () => {
    const r = computeDealProgress(-1, true);
    expect(r.tracked).toBe(false);
    expect(r.score).toBe(0);
  });

  it("NaN ordinal → safe fallback untracked", () => {
    const r = computeDealProgress(NaN, true);
    expect(r.tracked).toBe(false);
    expect(r.score).toBe(0);
  });

  it("ordinal > 6 → clamped to 100", () => {
    const r = computeDealProgress(10, true);
    expect(r.score).toBe(100);
    expect(r.temperature).toBe("booked");
  });

  it("score is clamped to max 100", () => {
    const r = computeDealProgress(7, true);
    expect(r.score).toBe(100);
  });
});

describe("getScoreColors", () => {
  it("returns different colors for each temperature in light mode", () => {
    const cold = getScoreColors("cold", false);
    const warm = getScoreColors("warm", false);
    const hot = getScoreColors("hot", false);
    const booked = getScoreColors("booked", false);
    expect(cold.ring).not.toBe(warm.ring);
    expect(warm.ring).not.toBe(hot.ring);
    expect(hot.ring).not.toBe(booked.ring);
  });

  it("returns different colors for each temperature in dark mode", () => {
    const cold = getScoreColors("cold", true);
    const warm = getScoreColors("warm", true);
    const hot = getScoreColors("hot", true);
    const booked = getScoreColors("booked", true);
    expect(cold.ring).not.toBe(warm.ring);
    expect(warm.ring).not.toBe(hot.ring);
    expect(hot.ring).not.toBe(booked.ring);
  });

  it("all temperatures have ring, ringTrack, badge, scoreText", () => {
    for (const temp of ["cold", "warm", "hot", "booked"] as const) {
      const c = getScoreColors(temp, false);
      expect(c.ring).toBeTruthy();
      expect(c.ringTrack).toBeTruthy();
      expect(c.badge).toBeTruthy();
      expect(c.scoreText).toBeTruthy();
    }
  });
});
