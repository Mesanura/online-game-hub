import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { hexSetupDefinition } from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("hexSetupDefinition", () => {
  it("requires the owner to choose the BLUE starter", () => {
    const initial = hexSetupDefinition.initialize({
      source: { kind: "defaults", config: null },
      slots,
    });
    expect(initial).toEqual({
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(hexSetupDefinition.getReadiness(initial, slots)).toEqual({
      canFinalize: false,
      participantSlotIds: ["slot-owner", "slot-guest"],
    });
    expect(
      hexSetupDefinition.transition({
        state: initial,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
        actorSlotId: "slot-guest",
        isOwner: false,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
  });

  it("finalizes deterministic random order using only setup RNG", () => {
    const state = { starter: "RANDOM", fixedStarterSlotId: null } as const;
    const first = hexSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("hex-setup"),
    });
    const repeated = hexSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("hex-setup"),
    });
    expect(first).toEqual(repeated);
    expect(first.status).toBe("finalized");
    if (first.status !== "finalized") return;
    expect(first.setup).toMatchObject({
      config: null,
      participantSlotIds: ["slot-owner", "slot-guest"],
      assignments: [
        { slotId: "slot-owner", assignment: null },
        { slotId: "slot-guest", assignment: null },
      ],
    });
    expect(new Set(first.setup.playerOrder)).toEqual(
      new Set(["slot-owner", "slot-guest"]),
    );
    expect(first.rng.cursor).toBe(1);
  });

  it("reuses the previous actual BLUE player and full setup", () => {
    const state = hexSetupDefinition.initialize({
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
      hexSetupDefinition.finalize({
        state,
        slots,
        rng: createSetupRng("hex-rematch"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: {
        config: null,
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
