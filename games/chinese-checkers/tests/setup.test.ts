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
  chineseCheckersSetupViewSchema,
  type ChineseCheckersSetupState,
} from "../src/setup/index.js";
import { CHINESE_CHECKERS_CAMP_OPTIONS } from "../src/constants.js";

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
    type: "SELECT_STARTER_CAMP",
    camp: "N",
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
      starterCamp: null,
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
      select(initial, "slot-2", {
        type: "SELECT_STARTER_CAMP",
        camp: "NE",
      }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
    expect(
      select(initial, "slot-2", {
        type: "SELECT_STARTER",
        starter: "RANDOM",
      }),
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
      starterCamp: null,
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
      starterCamp: null,
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
    expect(
      chineseCheckersSetupDefinition.projectView({
        state,
        slots: threePlayers,
        viewer: { kind: "player", slotId: "slot-1" },
      }),
    ).toMatchObject({ starter: "FIXED", starterCamp: "S" });
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
      starter: "CAMP",
      starterCamp: "N",
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

  it.each([
    ["N", [1, 6, 5, 4, 3, 2]],
    ["NE", [2, 1, 6, 5, 4, 3]],
    ["SE", [3, 2, 1, 6, 5, 4]],
    ["S", [4, 3, 2, 1, 6, 5]],
    ["SW", [5, 4, 3, 2, 1, 6]],
    ["NW", [6, 5, 4, 3, 2, 1]],
  ] as const)(
    "starts at %s and preserves counterclockwise order",
    (camp, order) => {
      const slots = CHINESE_CHECKERS_CAMP_OPTIONS.map((_camp, index) => ({
        slotId: `slot-${index + 1}`,
        occupied: true,
        online: true,
        isOwner: index === 0,
      }));
      const state = chineseCheckersSetupStateSchema.parse({
        targetPlayerCount: 6,
        starter: "UNSELECTED",
        fixedStarterSlotId: null,
        assignments: CHINESE_CHECKERS_CAMP_OPTIONS.map(
          (assignedCamp, index) => ({
            slotId: `slot-${index + 1}`,
            camp: assignedCamp,
          }),
        ),
      });
      const original = structuredClone(state);
      const selected = chineseCheckersSetupDefinition.transition({
        state,
        action: { type: "SELECT_STARTER_CAMP", camp },
        actorSlotId: "slot-1",
        isOwner: true,
        slots,
      });
      if (selected.status !== "accepted")
        throw new Error("Expected starter camp.");
      expect(state).toEqual(original);
      expect(chineseCheckersSetupStateSchema.parse(selected.state)).toEqual(
        JSON.parse(JSON.stringify(selected.state)),
      );
      expect(
        chineseCheckersSetupDefinition.getReadiness(selected.state, slots),
      ).toMatchObject({ canFinalize: true });
      const rng = createSetupRng("specified-camp");
      expect(
        chineseCheckersSetupDefinition.finalize({
          state: selected.state,
          slots,
          rng,
        }),
      ).toMatchObject({
        status: "finalized",
        setup: { playerOrder: order.map((slot) => `slot-${slot}`) },
        rng,
      });
      expect(rng.cursor).toBe(0);
    },
  );

  it("waits for the specified camp and follows it when players change camps", () => {
    const state = configuredThreePlayerState();
    const selected = select(state, "slot-1", {
      type: "SELECT_STARTER_CAMP",
      camp: "NW",
    });
    if (selected.status !== "accepted")
      throw new Error("Expected starter camp.");
    expect(
      chineseCheckersSetupDefinition.getReadiness(selected.state, threePlayers),
    ).toMatchObject({ canFinalize: false });
    expect(
      chineseCheckersSetupDefinition.finalize({
        state: selected.state,
        slots: threePlayers,
        rng: createSetupRng("empty-camp"),
      }),
    ).toEqual({ status: "rejected", code: "SETUP_INCOMPLETE" });
    expect(
      select(selected.state, "slot-1", {
        type: "SELECT_STARTER_CAMP",
        camp: "NW",
      }),
    ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });

    const assigned = select(selected.state, "slot-3", {
      type: "SELECT_CAMP",
      camp: "NW",
    });
    if (assigned.status !== "accepted")
      throw new Error("Expected camp assignment.");
    expect(
      chineseCheckersSetupDefinition.finalize({
        state: assigned.state,
        slots: threePlayers,
        rng: createSetupRng("occupied-camp"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-3", "slot-2", "slot-1"] },
    });
    const cleared = select(assigned.state, "slot-3", { type: "CLEAR_CAMP" });
    if (cleared.status !== "accepted")
      throw new Error("Expected camp clearing.");
    expect(
      chineseCheckersSetupDefinition.getReadiness(cleared.state, threePlayers),
    ).toMatchObject({ canFinalize: false });
    const reassigned = select(cleared.state, "slot-2", {
      type: "SELECT_CAMP",
      camp: "NW",
    });
    if (reassigned.status !== "accepted")
      throw new Error("Expected camp reassignment.");
    const completed = select(reassigned.state, "slot-3", {
      type: "SELECT_CAMP",
      camp: "S",
    });
    if (completed.status !== "accepted")
      throw new Error("Expected camp assignment.");
    expect(
      chineseCheckersSetupDefinition.finalize({
        state: completed.state,
        slots: threePlayers,
        rng: createSetupRng("reassigned-camp"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-2", "slot-3", "slot-1"] },
    });
    expect(selected.state.starterCamp).toBe("NW");
    expect(state.starterCamp).toBe("N");
  });

  it.each([2, 3, 4, 5, 6])(
    "randomly selects from all %i participating camps",
    (playerCount) => {
      const camps = CHINESE_CHECKERS_CAMP_OPTIONS.slice(0, playerCount);
      const slots = camps.map((_camp, index) => ({
        slotId: `slot-${index + 1}`,
        occupied: true,
        online: true,
        isOwner: index === 0,
      }));
      const state = chineseCheckersSetupStateSchema.parse({
        targetPlayerCount: playerCount,
        starter: "RANDOM",
        fixedStarterSlotId: null,
        assignments: camps.map((camp, index) => ({
          slotId: `slot-${index + 1}`,
          camp,
        })),
      });
      const starters = new Set<string>();
      for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
        const rng = createSetupRng(`all-camps-${seedIndex}`);
        const result = chineseCheckersSetupDefinition.finalize({
          state,
          slots,
          rng,
        });
        if (result.status !== "finalized")
          throw new Error("Expected random starter.");
        const starter = result.setup.playerOrder[0];
        if (starter === undefined) throw new Error("Missing first player.");
        starters.add(starter);
        expect(new Set(result.setup.playerOrder)).toEqual(
          new Set(slots.map((slot) => slot.slotId)),
        );
        expect(result.rng.cursor).toBe(1);
        expect(rng.cursor).toBe(0);
      }
      expect(starters).toEqual(new Set(slots.map((slot) => slot.slotId)));
    },
  );

  it("clears specified camps for random selection and preserves legacy selections", () => {
    const state = configuredThreePlayerState();
    const random = select(state, "slot-1", {
      type: "SELECT_STARTER",
      starter: "RANDOM",
    });
    if (random.status !== "accepted")
      throw new Error("Expected random selection.");
    expect(random.state).toMatchObject({
      starter: "RANDOM",
      starterCamp: null,
      fixedStarterSlotId: null,
    });
    expect(chineseCheckersSetupStateSchema.parse(random.state)).toEqual(
      random.state,
    );
    for (const [starter, camp, order] of [
      ["OWNER", "N", ["slot-1", "slot-2", "slot-3"]],
      ["NON_OWNER", "S", ["slot-2", "slot-3", "slot-1"]],
    ] as const) {
      const legacy = chineseCheckersSetupStateSchema.parse({
        targetPlayerCount: 3,
        starter,
        fixedStarterSlotId: null,
        assignments: state.assignments,
      });
      expect(legacy.starterCamp).toBeNull();
      const view = chineseCheckersSetupDefinition.projectView({
        state: legacy,
        slots: threePlayers,
        viewer: { kind: "spectator" },
      });
      expect(chineseCheckersSetupViewSchema.parse(view)).toMatchObject({
        starterCamp: camp,
        canEditRules: false,
        canSelectCamp: false,
        yourCamp: null,
      });
      expect(
        chineseCheckersSetupDefinition.finalize({
          state: legacy,
          slots: threePlayers,
          rng: createSetupRng("legacy"),
        }),
      ).toMatchObject({ status: "finalized", setup: { playerOrder: order } });
    }
  });

  it("rejects invalid starter camps, forged identities, and inconsistent state", () => {
    for (const action of [
      { type: "SELECT_STARTER_CAMP", camp: "E" },
      { type: "SELECT_STARTER_CAMP", camp: 1 },
      { type: "SELECT_STARTER_CAMP", camp: null },
      { type: "SELECT_STARTER_CAMP" },
      { type: "SELECT_STARTER_CAMP", camp: "N", actorSlotId: "slot-1" },
      { type: "SELECT_STARTER_CAMP", camp: "N", state: {} },
    ]) {
      expect(chineseCheckersSetupActionSchema.safeParse(action).success).toBe(
        false,
      );
    }
    const state = configuredThreePlayerState();
    for (const invalid of [
      { ...state, starterCamp: null },
      { ...state, starterCamp: "E" },
      { ...state, fixedStarterSlotId: "slot-1" },
      { ...state, starter: "RANDOM" },
    ]) {
      expect(chineseCheckersSetupStateSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
