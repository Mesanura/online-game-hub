import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { pongSetupDefinition } from "../src/setup/index.js";

const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("pongSetupDefinition", () => {
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
