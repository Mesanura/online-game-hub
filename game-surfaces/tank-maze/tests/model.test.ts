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
