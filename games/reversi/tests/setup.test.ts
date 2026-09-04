import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { reversiSetupDefinition } from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("reversiSetupDefinition", () => {
  it("requires the owner to choose the BLACK starter", () => {
    const initial = reversiSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots,
    });
    expect(initial).toEqual({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(reversiSetupDefinition.getReadiness(initial, slots)).toEqual({
      canFinalize: false,
      participantSlotIds: ["slot-owner", "slot-guest"],
    });
    expect(
      reversiSetupDefinition.transition({
        state: initial,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
        actorSlotId: "slot-guest",
        isOwner: false,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
  });

  it("finalizes deterministic random order without consuming gameplay RNG", () => {
    const state = { starter: "RANDOM", fixedStarterSlotId: null } as const;
    const first = reversiSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("reversi-setup"),
    });
    const repeated = reversiSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("reversi-setup"),
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

  it("reuses the previous actual BLACK player and full setup", () => {
    const state = reversiSetupDefinition.initialize({
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
      reversiSetupDefinition.finalize({
        state,
        slots,
        rng: createSetupRng("reversi-rematch"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-guest", "slot-owner"] },
      rng: { cursor: 0 },
    });
  });
});
