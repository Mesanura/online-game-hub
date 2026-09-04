import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { connectFourSetupDefinition } from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("connectFourSetupDefinition", () => {
  it("requires the owner to choose the RED starter", () => {
    const initial = connectFourSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots,
    });
    expect(initial).toEqual({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(connectFourSetupDefinition.getReadiness(initial, slots)).toEqual({
      canFinalize: false,
      participantSlotIds: ["slot-owner", "slot-guest"],
    });
    expect(
      connectFourSetupDefinition.transition({
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
    const first = connectFourSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("connect-four-setup"),
    });
    const repeated = connectFourSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("connect-four-setup"),
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

  it("reuses the previous actual RED player and full setup", () => {
    const state = connectFourSetupDefinition.initialize({
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
      connectFourSetupDefinition.finalize({
        state,
        slots,
        rng: createSetupRng("connect-four-rematch"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-guest", "slot-owner"] },
      rng: { cursor: 0 },
    });
  });
});
