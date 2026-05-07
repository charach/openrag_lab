import { describe, expect, it } from "vitest";
import { computeSegments, tintFromColor } from "./ChunkingLab";

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

describe("computeSegments", () => {
  const mk = (
    sequence: number,
    char_offset: number,
    content: string,
    color = "#3a3a3a",
  ) => ({
    sequence,
    content,
    char_offset,
    char_length: content.length,
    color_hint: color,
  });

  it("returns no segments for empty input", () => {
    expect(computeSegments([])).toEqual([]);
  });

  it("renders each character once when chunks do not overlap", () => {
    const segs = computeSegments([mk(0, 0, "hello"), mk(1, 5, "world")]);
    const total = segs.map((s) => s.text).join("");
    expect(total).toBe("helloworld");
    expect(segs.every((s) => s.owners.length === 1)).toBe(true);
  });

  it("emits a shared segment for the overlap region with two owners", () => {
    // chunk 0 covers [0,7), chunk 1 covers [5,12) — overlap is [5,7) = "lo"
    const segs = computeSegments([mk(0, 0, "hello, "), mk(1, 5, ", world")]);
    const overlap = segs.filter((s) => s.owners.length > 1);
    expect(overlap).toHaveLength(1);
    expect(overlap[0]!.owners).toEqual([0, 1]);
    expect(overlap[0]!.text).toBe(", ");
    // text concatenated still represents the document once.
    expect(segs.map((s) => s.text).join("")).toBe("hello, world");
  });
});
