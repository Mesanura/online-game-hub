import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { ticTacToeSetupDefinition } from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("ticTacToeSetupDefinition", () => {
  it("requires the owner to choose a starter before finalization", () => {
    const initial = ticTacToeSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots,
    });

    expect(initial).toEqual({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(ticTacToeSetupDefinition.getReadiness(initial, slots)).toEqual({
      canFinalize: false,
      participantSlotIds: ["slot-owner", "slot-guest"],
    });
    expect(
      ticTacToeSetupDefinition.transition({
        state: initial,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
        actorSlotId: "slot-guest",
        isOwner: false,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
  });

  it("finalizes a deterministic random order without changing gameplay config", () => {
    const state = {
      starter: "RANDOM",
      fixedStarterSlotId: null,
    } as const;
    const first = ticTacToeSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("round-setup"),
    });
    const repeated = ticTacToeSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("round-setup"),
    });

    expect(first).toEqual(repeated);
    expect(first.status).toBe("finalized");
    if (first.status !== "finalized") return;
    expect(first.setup.config).toBeNull();
    expect(new Set(first.setup.playerOrder)).toEqual(
      new Set(["slot-owner", "slot-guest"]),
    );
    expect(first.rng.cursor).toBe(1);
  });

  it("reuses the previous round's actual order and exposes viewer permissions", () => {
    const state = ticTacToeSetupDefinition.initialize({
      source: {
        kind: "previous-round",
        setup: {
          config: null,
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

    expect(state).toEqual({
      starter: "FIXED",
      fixedStarterSlotId: "slot-guest",
    });
    expect(
      ticTacToeSetupDefinition.projectView({
        state,
        slots,
        viewer: { kind: "player", slotId: "slot-guest" },
      }).canEdit,
    ).toBe(false);
    const finalized = ticTacToeSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("next-round"),
    });
    expect(finalized).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-guest", "slot-owner"] },
      rng: { cursor: 0 },
    });
  });
});
