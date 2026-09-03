import { describe, expect, it } from "vitest";

import { RealtimeSnapshotBuffer, interpolationAlpha } from "../src/index.js";

describe("realtime snapshot interpolation", () => {
  it("keeps a monotonic authoritative snapshot pair", () => {
    const buffer = new RealtimeSnapshotBuffer<{ readonly x: number }>();
    expect(buffer.push({ tick: 4, view: { x: 10 } })).toBe(true);
    expect(buffer.push({ tick: 3, view: { x: 99 } })).toBe(false);
    expect(buffer.push({ tick: 5, view: { x: 20 } })).toBe(true);
    expect(buffer.value).toEqual({
      previous: { tick: 4, view: { x: 10 } },
      current: { tick: 5, view: { x: 20 } },
    });
  });

  it("bounds visual interpolation without deriving simulation", () => {
    expect(interpolationAlpha(-1)).toBe(0);
    expect(interpolationAlpha(1000 / 120)).toBeCloseTo(0.5);
    expect(interpolationAlpha(100)).toBe(1);
  });
});
