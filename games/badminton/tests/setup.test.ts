import { createSetupRng, type SetupSlot } from "@online-game-hub/game-setup";
import { describe, expect, it } from "vitest";

import {
  badmintonSetupActionSchema,
  badmintonSetupDefinition as setup,
  badmintonSetupStateSchema,
} from "../src/setup/index.js";

const slots = [
  { slotId: "owner", occupied: true, online: true, isOwner: true },
  { slotId: "guest", occupied: true, online: true, isOwner: false },
] satisfies SetupSlot[];
const initial = () =>
  setup.initialize({
    source: { kind: "defaults", config: { targetScore: 7 } },
    slots,
  });

describe("badminton game-owned setup", () => {
  it("defaults to a ready-to-confirm short match with the owner serving on the left", () => {
    const state = initial();
    expect(state).toEqual({
      config: { targetScore: 7 },
      starter: "OWNER",
      fixedStarterSlotId: null,
    });
    expect(setup.getReadiness(state, slots)).toEqual({
      canFinalize: true,
      participantSlotIds: ["owner", "guest"],
    });
    expect(setup.getReadiness(state, slots.slice(0, 1)).canFinalize).toBe(
      false,
    );
  });

  it("allows only the occupied owner to change score or first server and rejects no-ops", () => {
    const state = initial();
    const action = { type: "SET_TARGET_SCORE", targetScore: 11 } as const;
    const context = {
      state,
      action,
      actorSlotId: "owner",
      isOwner: true,
      slots,
    };
    const result = setup.transition(context);
    expect(result).toMatchObject({
      status: "accepted",
      state: { config: { targetScore: 11 } },
    });
    expect(state.config.targetScore).toBe(7);
    expect(
      setup.transition({ ...context, actorSlotId: "guest", isOwner: false }),
    ).toEqual({ status: "rejected", code: "NOT_OWNER" });
    expect(setup.transition({ ...context, actorSlotId: "outsider" })).toEqual({
      status: "rejected",
      code: "NOT_OWNER",
    });
    expect(
      setup.transition({
        ...context,
        action: { type: "SET_TARGET_SCORE", targetScore: 7 },
      }),
    ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
    expect(
      setup.transition({
        ...context,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
      }),
    ).toEqual({ status: "rejected", code: "SETUP_UNCHANGED" });
    expect(
      setup.transition({
        ...context,
        action: { type: "SELECT_STARTER", starter: "NON_OWNER" },
      }),
    ).toMatchObject({ status: "accepted", state: { starter: "NON_OWNER" } });
  });

  it.each([
    { type: "SET_TARGET_SCORE", targetScore: 1 },
    { type: "SELECT_STARTER", starter: "FIXED" },
    { type: "SELECT_STARTER", starter: "OWNER", actorSlotId: "guest" },
  ])("rejects invalid setup action %j", (action) => {
    expect(badmintonSetupActionSchema.safeParse(action).success).toBe(false);
  });

  it("projects permissions for owner, guest and spectator without setup RNG", () => {
    for (const slotId of ["owner", "guest"]) {
      const view = setup.projectView({
        state: initial(),
        slots,
        viewer: { kind: "player", slotId },
      });
      expect(view.canEdit).toBe(slotId === "owner");
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
      expect(view).not.toHaveProperty("rng");
    }
    expect(
      setup.projectView({
        state: initial(),
        slots,
        viewer: { kind: "spectator" },
      }).canEdit,
    ).toBe(false);
  });

  it("deterministically randomizes only setup and carries full final settings into a rematch", () => {
    const state = badmintonSetupStateSchema.parse({
      ...initial(),
      starter: "RANDOM",
      config: { targetScore: 21 },
    });
    const rng = Object.freeze(createSetupRng("badminton-setup-seed"));
    const first = setup.finalize({ state, slots, rng });
    expect(first).toEqual(setup.finalize({ state, slots, rng }));
    expect(first.status).toBe("finalized");
    if (first.status !== "finalized")
      throw new Error("Expected finalized setup");
    expect(first.rng.cursor).toBe(1);
    const next = setup.initialize({
      source: { kind: "previous-round", setup: first.setup },
      slots,
    });
    const repeated = setup.finalize({
      state: next,
      slots,
      rng: createSetupRng("another-seed"),
    });
    expect(repeated).toMatchObject({
      status: "finalized",
      setup: first.setup,
      rng: { cursor: 0 },
    });
    expect(rng.cursor).toBe(0);
    expect(Object.isFrozen(first.setup.config)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(setup.finalize({ state, slots: slots.slice(0, 1), rng })).toEqual({
      status: "rejected",
      code: "PLAYERS_NOT_READY",
    });
  });
});
