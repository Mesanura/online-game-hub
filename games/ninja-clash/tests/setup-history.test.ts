import { expect, it } from "vitest";
import { createSetupRng } from "@online-game-hub/game-setup";
import { ninjaClashSetupDefinition as setup } from "../src/setup.js";
import { ninjaClashHistory as history } from "../src/history.js";
import { event, freeze, initial, step } from "./helpers.js";
const slots = Array.from({ length: 4 }, (_, i) => ({
  slotId: "p" + i,
  occupied: true,
  online: true,
  isOwner: i === 0,
}));
it.each([2, 3, 4])(
  "finalizes every target and reuses complete %i player settings",
  (count) => {
    for (const targetScore of [3, 5, 7, 10] as const) {
      const players = slots.slice(0, count);
      const state = freeze(
        setup.initialize({
          slots: players,
          source: {
            kind: "defaults",
            config: { playerCount: count, targetScore },
          },
        }),
      );
      const rng = freeze(createSetupRng("setup"));
      const result = setup.finalize({ state, slots: players, rng });
      expect(result.status).toBe("finalized");
      if (result.status !== "finalized") throw new Error("setup");
      expect(result.rng).toEqual(rng);
      expect(
        setup.initialize({
          slots: players,
          source: { kind: "previous-round", setup: result.setup },
        }),
      ).toEqual(state);
      expect(result.setup.playerOrder).toEqual(players.map((p) => p.slotId));
    }
  },
);
it("validates permissions, settings, no-op, online readiness and projection", () => {
  const state = setup.initialize({
    slots,
    source: { kind: "defaults", config: { playerCount: 2, targetScore: 5 } },
  });
  const change = {
    state,
    slots,
    actorSlotId: "p0",
    isOwner: true,
    action: { type: "SET_TARGET_SCORE" as const, targetScore: 7 as const },
  };
  expect(setup.transition(change)).toMatchObject({
    status: "accepted",
    state: { config: { playerCount: 2, targetScore: 7 } },
  });
  expect(setup.transition({ ...change, isOwner: false })).toMatchObject({
    code: "NOT_OWNER",
  });
  expect(
    setup.transition({ ...change, actorSlotId: "outsider" }),
  ).toMatchObject({ code: "NOT_PARTICIPANT" });
  expect(
    setup.transition({
      ...change,
      action: { type: "SET_TARGET_SCORE", targetScore: 5 },
    }),
  ).toMatchObject({ code: "SETUP_UNCHANGED" });
  expect(setup.getReadiness(state, slots).canFinalize).toBe(false);
  expect(
    setup.getReadiness(
      state,
      slots.slice(0, 2).map((s) => ({ ...s, online: false })),
    ).canFinalize,
  ).toBe(false);
  const view = setup.projectView({
    state,
    slots,
    viewer: { kind: "player", slotId: "p1" },
  });
  expect(view.canEdit).toBe(false);
  expect(setup.setupViewSchema.safeParse(view).success).toBe(true);
  for (const targetScore of [1, 4, 11, 3.5])
    expect(
      setup.setupActionSchema.safeParse({
        type: "SET_TARGET_SCORE",
        targetScore,
      }).success,
    ).toBe(false);
});
it("projects only valid personal outcomes", () => {
  const state = step(initial(), [event("RESIGN", "p1")]);
  const context = {
    gameVersion: "1.0.0",
    recordedOutcome: state.outcome,
    players: ["p0", "p1"],
    playerSlotId: "p0",
  };
  expect(history.projectView(context)).toEqual({
    kind: "win-loss",
    value: "win",
  });
  expect(history.projectView({ ...context, playerSlotId: "p1" })).toEqual({
    kind: "win-loss",
    value: "loss",
  });
  expect(history.projectView({ ...context, gameVersion: "0.0.0" })).toBeNull();
  expect(history.projectView({ ...context, players: ["p0", "p0"] })).toBeNull();
  expect(history.projectView({ ...context, recordedOutcome: {} })).toBeNull();
});
