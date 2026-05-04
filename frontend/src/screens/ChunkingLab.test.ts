import { describe, expect, it } from "vitest";
import { tintFromColor } from "./ChunkingLab";

describe("tintFromColor", () => {
  it("returns an rgba() with the requested alpha for a #rrggbb input", () => {
    expect(tintFromColor("#3a3a3a", 0.22)).toBe("rgba(58,58,58,0.22)");
  });

  it("accepts uppercase and missing leading hash", () => {
    expect(tintFromColor("C8A96A", 0.5)).toBe("rgba(200,169,106,0.5)");
  });

  it("falls back to a neutral gray on malformed input", () => {
    expect(tintFromColor("not a color", 0.3)).toBe("rgba(120,120,120,0.3)");
  });
});
