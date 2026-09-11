import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import {
  pongSetupActionSchema,
  pongSetupDefinition,
} from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("pongSetupDefinition", () => {
  it("accepts only strict integer score choices from one to nine", () => {
    for (let targetScore = 1; targetScore <= 9; targetScore++) {
      expect(
        pongSetupActionSchema.parse({ type: "SET_TARGET_SCORE", targetScore }),
      ).toEqual({ type: "SET_TARGET_SCORE", targetScore });
    }
    for (const targetScore of [
      0,
      10,
      1.5,
      "3",
      null,
      undefined,
      NaN,
      Infinity,
    ]) {
      expect(
        pongSetupActionSchema.safeParse({
          type: "SET_TARGET_SCORE",
          targetScore,
        }).success,
      ).toBe(false);
    }
    for (const extra of [{ actorSlotId: "slot-owner" }, { starter: "OWNER" }]) {
      expect(
        pongSetupActionSchema.safeParse({
          type: "SET_TARGET_SCORE",
          targetScore: 5,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "finalizes score %i while preserving fixed sides, source config and Setup RNG",
    (targetScore) => {
      const previous = {
        config: { targetScore: targetScore === 3 ? 4 : 3 },
        participantSlotIds: ["slot-owner", "slot-guest"],
        playerOrder: ["slot-guest", "slot-owner"],
        assignments: [
          { slotId: "slot-owner", assignment: null },
          { slotId: "slot-guest", assignment: null },
        ],
      };
      const state = pongSetupDefinition.initialize({
        source: { kind: "previous-round", setup: previous },
        slots,
      });
      const original = JSON.stringify(state);
      const context = {
        state,
        action: { type: "SET_TARGET_SCORE", targetScore } as const,
        actorSlotId: "slot-owner",
        isOwner: true,
        slots,
      };
      expect(
        pongSetupDefinition.transition({
          ...context,
          actorSlotId: "slot-guest",
          isOwner: false,
        }),
      ).toEqual({ status: "rejected", code: "NOT_OWNER" });
      const result = pongSetupDefinition.transition(context);
      expect(result.status).toBe("accepted");
      if (result.status !== "accepted")
        throw new Error("Expected accepted score change.");
      expect(result.state).toEqual({
        config: { targetScore },
        starter: "FIXED",
        fixedStarterSlotId: "slot-guest",
      });
      expect(JSON.stringify(state)).toBe(original);
      expect(previous.config.targetScore).toBe(targetScore === 3 ? 4 : 3);
      expect(
        pongSetupDefinition.transition({ ...context, state: result.state }),
      ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
      const rng = createSetupRng("score-choice");
      const finalized = pongSetupDefinition.finalize({
        state: result.state,
        slots,
        rng,
      });
      expect(finalized).toEqual({
        status: "finalized",
        setup: { ...previous, config: { targetScore } },
        rng,
      });
      if (finalized.status !== "finalized")
        throw new Error("Expected finalized settings.");
      expect(
        pongSetupDefinition.initialize({
          source: { kind: "previous-round", setup: finalized.setup },
          slots,
        }),
      ).toEqual(result.state);
      expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
    },
  );

  it("does not reroll random sides when the target score changes or a new round begins", () => {
    const state = {
      config: { targetScore: 3 },
      starter: "RANDOM",
      fixedStarterSlotId: null,
    } as const;
    const changed = pongSetupDefinition.transition({
      state,
      action: { type: "SET_TARGET_SCORE", targetScore: 9 },
      actorSlotId: "slot-owner",
      isOwner: true,
      slots,
    });
    if (changed.status !== "accepted")
      throw new Error("Expected score change.");
    const rng = createSetupRng("random-sides");
    const before = pongSetupDefinition.finalize({ state, slots, rng });
    const after = pongSetupDefinition.finalize({
      state: changed.state,
      slots,
      rng,
    });
    if (before.status !== "finalized" || after.status !== "finalized")
      throw new Error("Expected both setups to finalize.");
    expect(after.rng).toEqual(before.rng);
    expect(after.setup.playerOrder).toEqual(before.setup.playerOrder);
    const next = pongSetupDefinition.initialize({
      source: { kind: "previous-round", setup: after.setup },
      slots,
    });
    const nextRng = createSetupRng("different-round-seed");
    expect(
      pongSetupDefinition.finalize({ state: next, slots, rng: nextRng }),
    ).toEqual({ status: "finalized", setup: after.setup, rng: nextRng });
  });

  it("keeps targetScore game-owned while starter is unset", () => {
    const state = pongSetupDefinition.initialize({
      source: { kind: "defaults", config: { targetScore: 3 } },
      slots,
    });

    expect(state).toEqual({
      config: { targetScore: 3 },
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(pongSetupDefinition.getReadiness(state, slots).canFinalize).toBe(
      false,
    );
  });

  it("accepts owner starter changes and treats identical selection as unchanged", () => {
    const initial = pongSetupDefinition.initialize({
      source: { kind: "defaults", config: { targetScore: 3 } },
      slots,
    });
    const accepted = pongSetupDefinition.transition({
      state: initial,
      action: { type: "SELECT_STARTER", starter: "NON_OWNER" },
      actorSlotId: "slot-owner",
      isOwner: true,
      slots,
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      state: { config: { targetScore: 3 }, starter: "NON_OWNER" },
    });
    if (accepted.status !== "accepted") return;
    expect(
      pongSetupDefinition.transition({
        state: accepted.state,
        action: { type: "SELECT_STARTER", starter: "NON_OWNER" },
        actorSlotId: "slot-owner",
        isOwner: true,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
  });

  it("reuses the complete previous setup without rerandomizing order", () => {
    const state = pongSetupDefinition.initialize({
      source: {
        kind: "previous-round",
        setup: {
          config: { targetScore: 5 },
          participantSlotIds: ["slot-owner", "slot-guest"],
          playerOrder: ["slot-guest", "slot-owner"],
          assignments: [
            { slotId: "slot-owner", assignment: null },
            { slotId: "slot-guest", assignment: null },
          ],
        },
      },
      slots,
    });
    const finalized = pongSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("new-setup-seed"),
    });

    expect(finalized).toMatchObject({
      status: "finalized",
      setup: {
        config: { targetScore: 5 },
        participantSlotIds: ["slot-owner", "slot-guest"],
        playerOrder: ["slot-guest", "slot-owner"],
        assignments: [
          { slotId: "slot-owner", assignment: null },
          { slotId: "slot-guest", assignment: null },
        ],
      },
      rng: { cursor: 0 },
    });
  });
});
