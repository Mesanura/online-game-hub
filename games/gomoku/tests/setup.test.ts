import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import { gomokuSetupDefinition } from "../src/setup/index.js";

const config = Object.freeze({ boardSize: 15 as const, winLength: 5 as const });
const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("gomokuSetupDefinition", () => {
  it("preserves config and requires an owner-selected BLACK player", () => {
    const initial = gomokuSetupDefinition.initialize({
      source: { kind: "defaults", config },
      slots,
    });
    expect(initial).toEqual({
      config,
      starter: "UNSELECTED",
      fixedStarterSlotId: null,
    });
    expect(gomokuSetupDefinition.getReadiness(initial, slots)).toEqual({
      canFinalize: false,
      participantSlotIds: ["slot-owner", "slot-guest"],
    });
    expect(
      gomokuSetupDefinition.transition({
        state: initial,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
        actorSlotId: "slot-guest",
        isOwner: false,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
  });

  it("finalizes a deterministic random order with canonical config", () => {
    const state = {
      config,
      starter: "RANDOM",
      fixedStarterSlotId: null,
    } as const;
    const first = gomokuSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("gomoku-setup"),
    });
    const repeated = gomokuSetupDefinition.finalize({
      state,
      slots,
      rng: createSetupRng("gomoku-setup"),
    });
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      status: "finalized",
      setup: { config },
      rng: { cursor: 1 },
    });
  });

  it("reuses previous config and actual player order", () => {
    const state = gomokuSetupDefinition.initialize({
      source: {
        kind: "previous-round",
        setup: {
          config: { boardSize: 19, winLength: 5 },
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
      config: { boardSize: 19, winLength: 5 },
      starter: "FIXED",
      fixedStarterSlotId: "slot-guest",
    });
    expect(
      gomokuSetupDefinition.finalize({
        state,
        slots,
        rng: createSetupRng("gomoku-rematch"),
      }),
    ).toMatchObject({
      status: "finalized",
      setup: {
        config: { boardSize: 19, winLength: 5 },
        playerOrder: ["slot-guest", "slot-owner"],
      },
      rng: { cursor: 0 },
    });
  });
});
