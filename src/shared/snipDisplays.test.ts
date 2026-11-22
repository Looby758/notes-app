import { describe, expect, it } from "vitest";
import { matchSources } from "./snipDisplays";

const src = (display_id: string, name = display_id) => ({ display_id, name });

describe("matchSources", () => {
  it("matches each monitor to its own picture by id", () => {
    const a = src("1"),
      b = src("2");
    const m = matchSources([2, 1], [a, b]);
    expect(m.get(1)).toBe(a);
    expect(m.get(2)).toBe(b);
  });
  it("falls back to order when the pictures have no id", () => {
    const a = src("", "Screen 1"),
      b = src("", "Screen 2");
    const m = matchSources([10, 20], [a, b]);
    expect(m.get(10)).toBe(a);
    expect(m.get(20)).toBe(b);
  });
  it("leaves a monitor out rather than guessing when the counts differ", () => {
    const a = src("1"),
      b = src("");
    const m = matchSources([1, 2, 3], [a, b]);
    expect(m.get(1)).toBe(a);
    expect(m.has(2)).toBe(false);
    expect(m.has(3)).toBe(false);
  });
  it("uses the only picture for a single monitor", () => {
    const a = src("");
    expect(matchSources([5], [a]).get(5)).toBe(a);
  });
});
