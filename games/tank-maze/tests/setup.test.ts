import { it, expect } from "vitest";
import { createSetupRng } from "@online-game-hub/game-setup";
import { tankMazeSetupDefinition as setup } from "../src/setup/index.js";
const slots = Array.from({ length: 8 }, (_, i) => ({
  slotId: "p" + i,
  occupied: true,
  online: true,
  isOwner: i === 0,
}));
it.each([2, 3, 8])(
  "retains the finalized %i-player configuration and all color assignments",
  (count) => {
    const participants = slots.slice(0, count);
    const state = setup.initialize({
      source: {
        kind: "defaults",
        config: { playerCount: count, targetScore: 10, colors: [] },
      },
      slots: participants,
    });
    const changed = setup.transition({
      state,
      slots: participants,
      actorSlotId: "p0",
      isOwner: true,
      action: { type: "SET_TARGET_SCORE", targetScore: 15 },
    });
    if (changed.status !== "accepted") throw new Error("Score was rejected.");
    const final = setup.finalize({
      state: changed.state,
      slots: participants,
      rng: createSetupRng("scores"),
    });
    if (final.status !== "finalized")
      throw new Error("Setup could not finalize.");
    expect(final.setup.config).toEqual({
      playerCount: count,
      targetScore: 15,
      colors: Array.from({ length: count }, (_, i) => i),
    });
    const rematch = setup.initialize({
      source: { kind: "previous-round", setup: final.setup },
      slots: participants,
    });
    expect(
      setup.finalize({
        state: rematch,
        slots: participants,
        rng: createSetupRng("scores"),
      }),
    ).toEqual(final);
    expect(final.rng.cursor).toBe(0);
  },
);
it("accepts a smaller configured capacity while readiness blocks excess players", () => {
  const participants = slots.slice(0, 3);
  const state = setup.initialize({
    source: {
      kind: "defaults",
      config: { playerCount: 3, targetScore: 10, colors: [] },
    },
    slots: participants,
  });
  const before = JSON.stringify(state);
  const changed = setup.transition({
    state,
    slots: participants,
    actorSlotId: "p0",
    isOwner: true,
    action: { type: "SET_PLAYER_COUNT", playerCount: 2 },
  });
  if (changed.status !== "accepted") throw new Error("Capacity was rejected.");
  expect(JSON.stringify(state)).toBe(before);
  expect(setup.getReadiness(changed.state, participants).canFinalize).toBe(
    false,
  );
  expect(
    setup.finalize({
      state: changed.state,
      slots: participants,
      rng: createSetupRng("capacity"),
    }),
  ).toEqual({ status: "rejected", code: "PLAYERS_NOT_READY" });
});
it("requires the configured participants and persists selected colors for rematches", () => {
  let state = setup.initialize({
    source: {
      kind: "defaults",
      config: { playerCount: 8, targetScore: 10, colors: [] },
    },
    slots,
  });
  expect(setup.getReadiness(state, slots).canFinalize).toBe(true);
  expect(setup.getReadiness(state, slots.slice(0, 7)).canFinalize).toBe(false);
  const final = setup.finalize({ state, slots, rng: createSetupRng("setup") });
  expect(final.status).toBe("finalized");
  if (final.status !== "finalized") throw new Error();
  expect(final.setup.config.colors).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  state = setup.initialize({
    source: { kind: "previous-round", setup: final.setup },
    slots,
  });
  expect(
    setup.finalize({ state, slots, rng: createSetupRng("setup") }),
  ).toEqual(final);
});
it("allows only owner settings, rejects occupied colors, and lets players choose free colors", () => {
  const pair = slots.slice(0, 2),
    state = setup.initialize({
      source: {
        kind: "defaults",
        config: { playerCount: 2, targetScore: 10, colors: [] },
      },
      slots: pair,
    });
  const transition = (
    action: Parameters<typeof setup.transition>[0]["action"],
    isOwner = false,
  ) =>
    setup.transition({
      state,
      slots: pair,
      actorSlotId: "p1",
      isOwner,
      action,
    });
  expect(
    transition({ type: "SET_PLAYER_COUNT", playerCount: 3 }),
  ).toMatchObject({ status: "rejected", code: "NOT_OWNER" });
  expect(transition({ type: "SELECT_COLOR", color: 0 })).toMatchObject({
    status: "rejected",
    code: "COLOR_TAKEN",
  });
  expect(transition({ type: "SELECT_COLOR", color: 7 })).toMatchObject({
    status: "accepted",
    state: { colors: { p1: 7 } },
  });
});
