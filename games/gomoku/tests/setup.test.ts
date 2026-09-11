import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import {
  gomokuSetupActionSchema,
  gomokuSetupDefinition,
} from "../src/setup/index.js";

const config = Object.freeze({ boardSize: 15 as const, winLength: 5 as const });
const slots = Object.freeze([
  { slotId: "slot-owner", occupied: true, online: true, isOwner: true },
  { slotId: "slot-guest", occupied: true, online: true, isOwner: false },
]) satisfies readonly SetupSlot[];

describe("gomokuSetupDefinition", () => {
  it.each([15, 19] as const)(
    "changes to %i without changing the finalized starter or win length",
    (boardSize) => {
      const state = Object.freeze({
        config: Object.freeze({
          boardSize: boardSize === 15 ? (19 as const) : (15 as const),
          winLength: 5 as const,
        }),
        starter: "FIXED" as const,
        fixedStarterSlotId: "slot-guest",
      });
      const before = JSON.stringify(state);
      const action = gomokuSetupActionSchema.parse({
        type: "SET_BOARD_SIZE",
        boardSize,
      });
      const context = {
        state,
        action,
        actorSlotId: "slot-owner",
        isOwner: true,
        slots,
      };
      expect(
        gomokuSetupDefinition.transition({
          ...context,
          actorSlotId: "slot-guest",
          isOwner: false,
        }),
      ).toEqual({ status: "rejected", code: "NOT_OWNER" });
      const changed = gomokuSetupDefinition.transition(context);
      expect(changed.status).toBe("accepted");
      if (changed.status !== "accepted")
        throw new Error("Board size was rejected.");
      expect(changed.state).toEqual({
        ...state,
        config: { boardSize, winLength: 5 },
      });
      expect(JSON.stringify(state)).toBe(before);
      expect(
        gomokuSetupDefinition.transition({ ...context, state: changed.state }),
      ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
      const finalized = gomokuSetupDefinition.finalize({
        state: changed.state,
        slots,
        rng: createSetupRng("board-size"),
      });
      expect(finalized).toMatchObject({
        status: "finalized",
        setup: {
          config: { boardSize, winLength: 5 },
          playerOrder: ["slot-guest", "slot-owner"],
        },
        rng: { cursor: 0 },
      });
      if (finalized.status !== "finalized")
        throw new Error("Setup did not finalize.");
      expect(
        gomokuSetupDefinition.initialize({
          source: { kind: "previous-round", setup: finalized.setup },
          slots,
        }),
      ).toEqual(changed.state);
      expect(
        gomokuSetupDefinition.projectView({
          state: changed.state,
          slots,
          viewer: { kind: "player", slotId: "slot-guest" },
        }),
      ).toMatchObject({ config: { boardSize, winLength: 5 }, canEdit: false });
    },
  );

  it("rejects unsupported sizes and extra fields before transition", () => {
    for (const boardSize of [0, 14, 16, 20, 15.5, "19", null]) {
      expect(
        gomokuSetupActionSchema.safeParse({ type: "SET_BOARD_SIZE", boardSize })
          .success,
      ).toBe(false);
    }
    for (const extra of [
      { actor: "slot-owner" },
      { winLength: 6 },
      { starter: "OWNER" },
      { extra: true },
    ]) {
      expect(
        gomokuSetupActionSchema.safeParse({
          type: "SET_BOARD_SIZE",
          boardSize: 19,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

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
