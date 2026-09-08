import { it, expect } from "vitest";
import { Controls, interpolate } from "../src/model";
it("tracks multiple sources and cancels opposing controls", () => {
  const c = new Controls();
  c.press("KeyW", "up");
  c.press("touch-1", "up");
  c.release("KeyW");
  expect(c.intent().move).toBe(1);
  c.press("KeyS", "down");
  expect(c.intent().move).toBe(0);
  c.press("KeyA", "left");
  expect(c.intent().turn).toBe(-1);
  c.reset();
  expect(c.intent()).toEqual({ type: "MOVE", move: 0, turn: 0 });
});
it("clamps interpolation to server snapshots", () => {
  expect(interpolate(0, 10, 2)).toBe(10);
  expect(interpolate(0, 10, -1)).toBe(0);
});
