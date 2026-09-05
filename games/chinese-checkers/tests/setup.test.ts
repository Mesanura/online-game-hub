import { describe, expect, it } from "vitest";

import {
  createSetupRng,
  type FinalizedRoundSetup,
  type SetupSlot,
} from "@online-game-hub/game-setup";

import {
  chineseCheckersSetupActionSchema,
  chineseCheckersSetupDefinition,
  chineseCheckersSetupStateSchema,
  type ChineseCheckersSetupState,
} from "../src/setup/index.js";

const threePlayers = [
  { slotId: "slot-1", occupied: true, online: true, isOwner: true },
  { slotId: "slot-2", occupied: true, online: true, isOwner: false },
  { slotId: "slot-3", occupied: true, online: true, isOwner: false },
  { slotId: "slot-4", occupied: false, online: false, isOwner: false },
] satisfies readonly SetupSlot[];

function select(
  state: Readonly<ChineseCheckersSetupState>,
  actorSlotId: string,
  action: Parameters<
    typeof chineseCheckersSetupDefinition.transition
  >[0]["action"],
  isOwner = actorSlotId === "slot-1",
) {
  return chineseCheckersSetupDefinition.transition({
    state,
    action,
    actorSlotId,
    isOwner,
    slots: threePlayers,
  });
}

function configuredThreePlayerState() {
  let state: ChineseCheckersSetupState =
    chineseCheckersSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots: threePlayers,
    });
  for (const [actorSlotId, camp] of [
    ["slot-1", "N"],
    ["slot-2", "S"],
    ["slot-3", "NE"],
  ] as const) {
    const result = select(state, actorSlotId, { type: "SELECT_CAMP", camp });
    if (result.status !== "accepted")
      throw new Error("Expected camp selection.");
    state = result.state;
  }
  const count = select(state, "slot-1", {
    type: "SELECT_PLAYER_COUNT",
    playerCount: 3,
  });
  if (count.status !== "accepted") throw new Error("Expected player count.");
  const starter = select(count.state, "slot-1", {
    type: "SELECT_STARTER",
    starter: "OWNER",
  });
  if (starter.status !== "accepted") throw new Error("Expected starter.");
  return starter.state;
}

describe("Chinese Checkers Setup V6", () => {
  it("starts from game-owned defaults and rejects unknown fields", () => {
    const state = chineseCheckersSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots: threePlayers,
    });
    expect(state).toEqual({
      targetPlayerCount: 2,
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
      assignments: [],
    });
    expect(chineseCheckersSetupStateSchema.parse(state)).toEqual(state);
    expect(
      chineseCheckersSetupActionSchema.safeParse({
        type: "SELECT_CAMP",
        camp: "N",
        actorSlotId: "slot-1",
      }).success,
    ).toBe(false);
  });

  it("keeps owner-only rules separate from each player's unique camp", () => {
    const initial = chineseCheckersSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots: threePlayers,
    });
    expect(
      select(
        initial,
        "slot-2",
        { type: "SELECT_PLAYER_COUNT", playerCount: 3 },
        false,
      ),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
    expect(
      select(initial, "slot-1", {
        type: "SELECT_PLAYER_COUNT",
        playerCount: 2,
      }),
    ).toEqual({ status: "rejected", code: "PLAYER_COUNT_TOO_SMALL" });

    const ownerCamp = select(initial, "slot-1", {
      type: "SELECT_CAMP",
      camp: "N",
    });
    if (ownerCamp.status !== "accepted") throw new Error("Expected camp.");
    expect(
      select(ownerCamp.state, "slot-2", { type: "SELECT_CAMP", camp: "N" }),
    ).toEqual({ status: "rejected", code: "CAMP_TAKEN" });
    const guestCamp = select(ownerCamp.state, "slot-2", {
      type: "SELECT_CAMP",
      camp: "S",
    });
    if (guestCamp.status !== "accepted") throw new Error("Expected camp.");
    expect(
      select(guestCamp.state, "slot-2", { type: "CLEAR_CAMP" }),
    ).toMatchObject({
      status: "accepted",
      state: { assignments: [{ slotId: "slot-1", camp: "N" }] },
    });
  });

  it("finalizes three players in counterclockwise order from the selected starter", () => {
    const state = configuredThreePlayerState();
    expect(
      chineseCheckersSetupDefinition.getReadiness(state, threePlayers),
    ).toEqual({
      canFinalize: true,
      participantSlotIds: ["slot-1", "slot-2", "slot-3"],
    });
    const finalized = chineseCheckersSetupDefinition.finalize({
      state,
      slots: threePlayers,
      rng: createSetupRng("three-player"),
    });
    expect(finalized).toEqual({
      status: "finalized",
      setup: {
        config: null,
        participantSlotIds: ["slot-1", "slot-2", "slot-3"],
        playerOrder: ["slot-1", "slot-2", "slot-3"],
        assignments: [
          { slotId: "slot-1", assignment: "N" },
          { slotId: "slot-2", assignment: "S" },
          { slotId: "slot-3", assignment: "NE" },
        ],
      },
      rng: createSetupRng("three-player"),
    });
  });

  it("uses deterministic setup RNG only for a random starter", () => {
    const configured = configuredThreePlayerState();
    const randomState = {
      ...configured,
      starter: "RANDOM" as const,
      fixedStarterSlotId: null,
    };
    const first = chineseCheckersSetupDefinition.finalize({
      state: randomState,
      slots: threePlayers,
      rng: createSetupRng("random-starter"),
    });
    const repeated = chineseCheckersSetupDefinition.finalize({
      state: randomState,
      slots: threePlayers,
      rng: createSetupRng("random-starter"),
    });
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ status: "finalized", rng: { cursor: 1 } });
  });

  it("reuses the previous player count, actual order, camps, and fixed starter", () => {
    const previous = {
      config: null,
      participantSlotIds: ["slot-1", "slot-2", "slot-3"],
      playerOrder: ["slot-2", "slot-3", "slot-1"],
      assignments: [
        { slotId: "slot-2", assignment: "S" },
        { slotId: "slot-3", assignment: "NE" },
        { slotId: "slot-1", assignment: "N" },
      ],
    } satisfies FinalizedRoundSetup<null>;
    const state = chineseCheckersSetupDefinition.initialize({
      source: { kind: "previous-round", setup: previous },
      slots: threePlayers,
    });
    expect(state).toEqual({
      targetPlayerCount: 3,
      starter: "FIXED",
      fixedStarterSlotId: "slot-2",
      assignments: [
        { slotId: "slot-1", camp: "N" },
        { slotId: "slot-2", camp: "S" },
        { slotId: "slot-3", camp: "NE" },
      ],
    });
    const finalized = chineseCheckersSetupDefinition.finalize({
      state,
      slots: threePlayers,
      rng: createSetupRng("rematch"),
    });
    expect(finalized).toMatchObject({
      status: "finalized",
      setup: previous,
      rng: { cursor: 0 },
    });
  });

  it("projects only viewer-safe controls and waits for every selected participant", () => {
    const state = configuredThreePlayerState();
    expect(
      chineseCheckersSetupDefinition.projectView({
        state,
        slots: threePlayers,
        viewer: { kind: "player", slotId: "slot-2" },
      }),
    ).toMatchObject({
      targetPlayerCount: 3,
      canEditRules: false,
      canSelectCamp: true,
      yourCamp: "S",
    });
    const missingPlayer = threePlayers.map((slot) =>
      slot.slotId === "slot-3"
        ? { ...slot, occupied: false, online: false }
        : slot,
    );
    expect(
      chineseCheckersSetupDefinition.getReadiness(state, missingPlayer),
    ).toMatchObject({ canFinalize: false });
  });
});
