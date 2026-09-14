import { expect, it } from "vitest";
import { createSetupRng } from "@online-game-hub/game-setup";
import { bombermanSetupDefinition as setup } from "../src/setup.js";
import { bombermanHistory } from "../src/history.js";
import { freeze } from "./helpers.js";

const slots = Array.from({ length: 4 }, (_, index) => ({
  slotId: "p" + index,
  occupied: true,
  online: true,
  isOwner: index === 0,
}));
it.each([2, 3, 4])(
  "finalizes and reuses the complete %i-player setup without consuming setup RNG",
  (count) => {
    const participants = slots.slice(0, count);
    const state = setup.initialize({
      slots: participants,
      source: {
        kind: "defaults",
        config: {
          mapId: "classic-arena",
          modeId: "classic",
          playerCount: count,
        },
      },
    });
    const rng = freeze(createSetupRng("setup"));
    const result = setup.finalize({
      state: freeze(state),
      slots: participants,
      rng,
    });
    expect(result.status).toBe("finalized");
    if (result.status !== "finalized") throw new Error("Setup rejected");
    expect(result.rng).toEqual(rng);
    expect(result.setup.playerOrder).toEqual(
      participants.map((slot) => slot.slotId),
    );
    expect(result.setup.assignments).toHaveLength(count);
    const repeated = setup.initialize({
      slots: participants,
      source: { kind: "previous-round", setup: result.setup },
    });
    expect(
      setup.finalize({ state: repeated, slots: participants, rng }),
    ).toEqual(result);
    expect(
      setup.setupStateSchema.parse(JSON.parse(JSON.stringify(state))),
    ).toEqual(state);
  },
);
it("enforces membership and owner permissions, no-op rejection, occupancy and online readiness", () => {
  const state = setup.initialize({
    slots,
    source: {
      kind: "defaults",
      config: { mapId: "classic-arena", modeId: "classic", playerCount: 2 },
    },
  });
  const transition = (
    actorSlotId: string,
    isOwner: boolean,
    playerCount: number,
  ) =>
    setup.transition({
      state,
      slots,
      actorSlotId,
      isOwner,
      action: { type: "SET_PLAYER_COUNT", playerCount },
    });
  expect(transition("outsider", true, 3)).toMatchObject({
    status: "rejected",
    code: "NOT_PARTICIPANT",
  });
  expect(transition("p1", false, 3)).toMatchObject({
    status: "rejected",
    code: "NOT_OWNER",
  });
  expect(transition("p0", true, 2)).toMatchObject({
    status: "rejected",
    code: "SETUP_UNCHANGED",
  });
  expect(transition("p0", true, 3)).toMatchObject({
    status: "accepted",
    state: {
      config: { playerCount: 3, mapId: "classic-arena", modeId: "classic" },
    },
  });
  expect(setup.getReadiness(state, slots).canFinalize).toBe(false);
  expect(setup.getReadiness(state, slots.slice(0, 1)).canFinalize).toBe(false);
  expect(
    setup.getReadiness(
      state,
      slots.slice(0, 2).map((slot) => ({ ...slot, online: false })),
    ).canFinalize,
  ).toBe(false);
  for (const playerCount of [1, 5, 2.5])
    expect(
      setup.setupActionSchema.safeParse({
        type: "SET_PLAYER_COUNT",
        playerCount,
      }).success,
    ).toBe(false);
  const view = setup.projectView({
    state,
    slots,
    viewer: { kind: "player", slotId: "p1" },
  });
  expect(view).toMatchObject({
    canEdit: false,
    selfSlotId: "p1",
    playerCounts: [2, 3, 4],
  });
  expect(setup.setupViewSchema.parse(view)).toEqual(view);
});
it("projects personal win/loss/draw and rejects malformed or inconsistent archived outcomes", () => {
  const outcome = {
    type: "WIN",
    winnerSlotId: "p1",
    reason: "SCORE",
    scores: [
      { slotId: "p0", score: 1 },
      { slotId: "p1", score: 3 },
    ],
  };
  const project = (
    recordedOutcome: unknown,
    playerSlotId = "p0",
    gameVersion = "1.0.0",
  ) =>
    bombermanHistory.projectView({
      gameVersion,
      recordedOutcome,
      players: ["p0", "p1"],
      playerSlotId,
    });
  expect(project(freeze(outcome))).toEqual({ kind: "win-loss", value: "loss" });
  expect(project(outcome, "p1")).toEqual({ kind: "win-loss", value: "win" });
  expect(
    project({
      ...outcome,
      type: "DRAW",
      winnerSlotId: null,
      reason: "RESIGNATION",
      scores: [
        { slotId: "p0", score: 1 },
        { slotId: "p1", score: 2 },
      ],
    }),
  ).toEqual({ kind: "win-loss", value: "draw" });
  for (const invalid of [
    null,
    {},
    { ...outcome, winnerSlotId: "outsider" },
    { ...outcome, winnerSlotId: "p0" },
    { ...outcome, type: "DRAW" },
    { ...outcome, scores: [outcome.scores[0], outcome.scores[0]] },
  ])
    expect(project(invalid)).toBeNull();
  expect(project(outcome, "outsider")).toBeNull();
  expect(project(outcome, "p0", "2.0.0")).toBeNull();
});
it.each(["1.1.0", "1.2.0"])(
  "validates %s three-life final standings separately from legacy scores",
  (version) => {
    const result = {
      type: "WIN",
      winnerSlotId: "p1",
      reason: "SURVIVOR",
      standings: [
        { slotId: "p0", lives: 0, resigned: false },
        { slotId: "p1", lives: 2, resigned: false },
      ],
    };
    const project = (
      recordedOutcome: unknown,
      playerSlotId = "p0",
      gameVersion = version,
    ) =>
      bombermanHistory.projectView({
        gameVersion,
        recordedOutcome,
        players: ["p0", "p1"],
        playerSlotId,
      });
    expect(project(freeze(result))).toEqual({
      kind: "win-loss",
      value: "loss",
    });
    expect(project(result, "p1")).toEqual({ kind: "win-loss", value: "win" });
    expect(
      project({
        ...result,
        type: "DRAW",
        winnerSlotId: null,
        reason: "TIMEOUT",
        standings: [
          { slotId: "p0", lives: 1, resigned: false },
          { slotId: "p1", lives: 3, resigned: false },
        ],
      }),
    ).toEqual({ kind: "win-loss", value: "draw" });
    for (const invalid of [
      { ...result, winnerSlotId: "p0" },
      { ...result, type: "DRAW", winnerSlotId: null, reason: "TIMEOUT" },
      { ...result, reason: "SCORE" },
      { ...result, standings: [result.standings[1], result.standings[1]] },
      {
        ...result,
        standings: [
          { slotId: "p0", lives: 0, resigned: false },
          { slotId: "p1", lives: 2, resigned: true },
        ],
      },
    ])
      expect(project(invalid)).toBeNull();
    expect(project(result, "p1", "1.0.0")).toBeNull();
    expect(project(result, "outsider")).toBeNull();
  },
);
