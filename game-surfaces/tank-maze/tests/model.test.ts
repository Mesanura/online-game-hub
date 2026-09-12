import { it, expect } from "vitest";
import { Controls, interpolate } from "../src/model";
import { setupSchema } from "../src/contracts";
import {
  setupSummary,
  participantHint,
  renderSetupView,
} from "../src/setup-presentation";
import { setupNotice } from "../src/setup-ui";
it.each([2, 3, 8])(
  "presents the confirmed colors and score for %i players",
  (count) => {
    const players = Array.from({ length: count }, (_, i) => ({
      slotId: `p${i}`,
      color: i,
    }));
    const setup = setupSchema.parse({
      config: { playerCount: count, targetScore: 15, colors: [] },
      colors: Object.fromEntries(players.map((p) => [p.slotId, p.color])),
      players,
      participantSlotIds: players.map((p) => p.slotId),
      canEdit: false,
      selfSlotId: "p1",
    });
    expect(setupSummary(setup)).toContain("15 分");
    expect(setupSummary(setup)).toContain("绿");
    expect(participantHint(setup)).toContain(`${count}/${count}`);
    expect(
      renderSetupView(setup, false, false).match(/data-participant-color=/gu),
    ).toHaveLength(count);
    if (count > 2)
      expect(
        participantHint({
          ...setup,
          config: { ...setup.config, playerCount: 2 },
        }),
      ).toContain("不会自动踢出");
  },
);
it("explains conflicts, stale settings, and failed confirmation separately", () => {
  expect(setupNotice("rejected", "COLOR_TAKEN")).toContain("颜色已被其他玩家");
  expect(setupNotice("rejected", "NOT_OWNER")).toContain("只有房主");
  expect(setupNotice("stale")).toContain("设置已被更新");
  expect(setupNotice("rejected", "HOST_REJECTED")).toContain("连接");
  expect(setupNotice("accepted")).toBeNull();
});
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
it("slides one contact between directions and through gaps without adopting other contacts", () => {
  const c = new Controls();
  expect(c.movePointer(1, "up")).toBe(false);
  c.startPointer(1, "up");
  c.startPointer(2, "left");
  c.movePointer(1, "down");
  expect(c.intent()).toEqual({ type: "MOVE", move: -1, turn: -1 });
  c.movePointer(2, "right");
  c.movePointer(1, null);
  expect(c.intent()).toEqual({ type: "MOVE", move: 0, turn: 1 });
  c.movePointer(1, "up");
  c.endPointer(2);
  expect(c.intent()).toEqual({ type: "MOVE", move: 1, turn: 0 });
  expect(c.movePointer(2, "left")).toBe(false);
});
it("keeps same-direction contacts and keyboard input independent, and resets contact ownership", () => {
  const c = new Controls();
  c.press("KeyW", "up");
  c.startPointer(1, "up");
  c.startPointer(2, "up");
  c.endPointer(1);
  c.release("KeyW");
  expect(c.intent().move).toBe(1);
  c.press("KeyS", "down");
  expect(c.intent().move).toBe(0);
  c.reset();
  expect(c.movePointer(2, "down")).toBe(false);
  c.release("KeyS");
  expect(c.intent()).toEqual({ type: "MOVE", move: 0, turn: 0 });
  c.startPointer(2, "down");
  expect(c.intent().move).toBe(-1);
});
