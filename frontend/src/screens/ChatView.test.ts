import { describe, expect, it } from "vitest";
import { normalizeScore } from "./ChatView";

describe("normalizeScore", () => {
  it("clamps negative cosine scores to 0", () => {
    expect(normalizeScore(-0.564)).toBe(0);
    expect(normalizeScore(-1)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(normalizeScore(1.2)).toBe(1);
  });

  it("passes through values inside [0, 1]", () => {
    expect(normalizeScore(0)).toBe(0);
    expect(normalizeScore(0.42)).toBe(0.42);
    expect(normalizeScore(1)).toBe(1);
  });

  it("treats NaN/Infinity as 0", () => {
    expect(normalizeScore(Number.NaN)).toBe(0);
    expect(normalizeScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
