import { expect, it } from "vitest";
import { FeedbackTimeline } from "../src/feedback";
import type { Effect } from "../src/contracts";
const clash: Effect = {
  id: 1,
  kind: "CLASH",
  x: 32250,
  y: 32400,
  startedAt: 180,
  until: 210,
  sourceSlotId: "p0",
  targetSlotId: "p1",
  facing: 1,
};
it("emits sparks at the actual contact and expires independently of server ticks", () => {
  const timeline = new FeedbackTimeline();
  timeline.add([clash], 1000, () => 0xff7899);
  const first = timeline.frames(1000, false)[0];
  expect(first).toMatchObject({ x: 322.5, y: 324, flash: 1 });
  expect(first?.particles).toHaveLength(24);
  expect(first?.particles.every((p) => p.x === 322.5 && p.y === 324)).toBe(
    true,
  );
  expect(
    timeline.frames(1200, false)[0]?.particles.some((p) => p.x !== 322.5),
  ).toBe(true);
  expect(timeline.frames(1450, false)).toEqual([]);
});
it("bursts victim-colored pixel fragments and clears on reconnect/dispose", () => {
  const timeline = new FeedbackTimeline();
  timeline.add([{ ...clash, kind: "DEATH" }], 0, () => 0x79ebd7);
  const frames = timeline.frames(200, false);
  expect(frames[0]?.particles).toHaveLength(36);
  expect(frames[0]?.particles.some((p) => p.color === 0x79ebd7)).toBe(true);
  timeline.clear();
  expect(timeline.frames(201, false)).toEqual([]);
});
it("reduces motion without removing the contact indicator", () => {
  const timeline = new FeedbackTimeline();
  timeline.add([clash], 0, () => 0xffffff);
  const first = timeline.frames(50, true)[0],
    later = timeline.frames(200, true)[0];
  expect(first?.flash).toBe(0);
  expect(first?.particles).toHaveLength(6);
  expect(first?.particles.map((p) => [p.x, p.y])).toEqual(
    later?.particles.map((p) => [p.x, p.y]),
  );
  expect(first?.alpha).toBeGreaterThan(later?.alpha ?? 1);
});
