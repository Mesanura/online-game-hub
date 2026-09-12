import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import {
  airHockeySetupDefinition as setup,
  airHockeySetupActionSchema,
} from "../src/setup/index.js";
import { airHockeyDefinition } from "../src/core/index.js";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
} from "@online-game-hub/realtime-game-sdk";

const slots = [
  { slotId: "guest", occupied: true, online: true, isOwner: false },
  { slotId: "host", occupied: true, online: true, isOwner: true },
] satisfies SetupSlot[];

describe("air hockey Setup", () => {
  it.each([5, 7, 11] as const)(
    "finalizes %i with owner P1 regardless of slot ordering",
    (targetScore) => {
      const state = setup.initialize({
        slots,
        source: { kind: "defaults", config: { targetScore } },
      });
      const rng = createSetupRng("setup");
      const finalized = setup.finalize({ state, slots, rng });
      expect(finalized.status).toBe("finalized");
      if (finalized.status !== "finalized")
        throw new Error("Expected finalized setup.");
      expect(finalized.setup.playerOrder).toEqual(["host", "guest"]);
      expect(finalized.rng).toEqual(rng);
      expect(setup.getReadiness(state, slots).canFinalize).toBe(true);
      const next = setup.initialize({
        slots,
        source: { kind: "previous-round", setup: finalized.setup },
      });
      expect(next).toEqual(state);
      expect(
        airHockeyDefinition.createInitialState({
          config: finalized.setup.config,
          players: finalized.setup.playerOrder.map(defineRealtimePlayerSlotId),
          rng: createRealtimeRng("match"),
        }).state,
      ).toMatchObject({ players: ["host", "guest"], server: 0, targetScore });
    },
  );
  it("rejects non-owner, unchanged, extra and unsupported settings", () => {
    const state = { config: { targetScore: 7 as const } };
    const context = {
      state,
      action: { type: "SET_TARGET_SCORE" as const, targetScore: 5 as const },
      slots,
      actorSlotId: "host",
      isOwner: true,
    };
    expect(
      setup.transition({ ...context, isOwner: false, actorSlotId: "guest" }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
    expect(setup.transition(context)).toEqual({
      status: "accepted",
      state: { config: { targetScore: 5 } },
    });
    expect(state.config.targetScore).toBe(7);
    expect(
      setup.transition({
        ...context,
        action: { type: "SET_TARGET_SCORE", targetScore: 7 },
      }),
    ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
    for (const value of [0, 6, 12, "7", 7.5, null])
      expect(
        airHockeySetupActionSchema.safeParse({
          type: "SET_TARGET_SCORE",
          targetScore: value,
        }).success,
      ).toBe(false);
    expect(
      airHockeySetupActionSchema.safeParse({
        ...context.action,
        actorSlotId: "host",
      }).success,
    ).toBe(false);
  });
  it("projects edit permission only to the owner and cannot start without two players", () => {
    const state = { config: { targetScore: 7 as const } };
    expect(
      setup.projectView({
        state,
        slots,
        viewer: { kind: "player", slotId: "host" },
      }).canEdit,
    ).toBe(true);
    for (const viewer of [
      { kind: "player", slotId: "guest" } as const,
      { kind: "spectator" } as const,
    ]) {
      const view = setup.projectView({ state, slots, viewer });
      expect(view.canEdit).toBe(false);
      expect(
        setup.setupViewSchema.parse(JSON.parse(JSON.stringify(view))),
      ).toEqual(view);
    }
    const one = slots.slice(1);
    expect(setup.getReadiness(state, one).canFinalize).toBe(false);
    expect(
      setup.finalize({ state, slots: one, rng: createSetupRng("one") }).status,
    ).toBe("rejected");
  });
});
