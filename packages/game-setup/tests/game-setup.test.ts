import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applyRoundSetupAction,
  createSetupRng,
  finalizeRoundSetup,
  getRoundSetupReadiness,
  initializeRoundSetupCoordinator,
  nextSetupInt,
  projectRoundSetupView,
  SETUP_RNG_ALGORITHM_V1,
  setRoundSetupReady,
  validateFinalizedRoundSetup,
  type FinalizedRoundSetup,
  type RoundSetupDefinition,
  type SetupSlot,
} from "../src/index.js";

describe("setup RNG", () => {
  it("is deterministic and advances an independent cursor", () => {
    const first = nextSetupInt(createSetupRng("setup-seed"), 7);
    const repeated = nextSetupInt(createSetupRng("setup-seed"), 7);

    expect(first).toEqual(repeated);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(7);
    expect(first.next).toEqual({
      algorithm: SETUP_RNG_ALGORITHM_V1,
      seed: "setup-seed",
      cursor: 1,
    });
  });

  it("rejects invalid seeds, cursors and ranges", () => {
    expect(() => createSetupRng("")).toThrow(TypeError);
    expect(() =>
      nextSetupInt(
        { algorithm: SETUP_RNG_ALGORITHM_V1, seed: "seed", cursor: -1 },
        2,
      ),
    ).toThrow(RangeError);
    expect(() => nextSetupInt(createSetupRng("seed"), 0)).toThrow(RangeError);
  });
});

const slots = [
  { slotId: "slot-1", occupied: true, online: true, isOwner: true },
  { slotId: "slot-2", occupied: true, online: true, isOwner: false },
  { slotId: "slot-3", occupied: false, online: false, isOwner: false },
] satisfies readonly SetupSlot[];

const validSetup = {
  config: null,
  participantSlotIds: ["slot-1", "slot-2"],
  playerOrder: ["slot-2", "slot-1"],
  assignments: [
    { slotId: "slot-1", assignment: "RED" },
    { slotId: "slot-2", assignment: "BLUE" },
  ],
} satisfies FinalizedRoundSetup;

const coordinatorDefinition = {
  setupStateSchema: z.object({ value: z.number().int().min(0) }).strict(),
  setupActionSchema: z.object({ type: z.literal("INCREMENT") }).strict(),
  setupViewSchema: z
    .object({ value: z.number().int().min(0), canEdit: z.boolean() })
    .strict(),
  initialize: () => ({ value: 0 }),
  transition: ({ state, isOwner }) =>
    isOwner
      ? { status: "accepted" as const, state: { value: state.value + 1 } }
      : { status: "rejected" as const, code: "NOT_OWNER" },
  projectView: ({ state, viewer }) => ({
    value: state.value,
    canEdit: viewer.kind === "player" && viewer.slotId === "slot-1",
  }),
  getReadiness: (state) => ({
    canFinalize: state.value > 0,
    participantSlotIds: ["slot-1", "slot-2"],
  }),
  finalize: ({ state, rng }) =>
    state.value === 0
      ? { status: "rejected" as const, code: "SETUP_INCOMPLETE" }
      : {
          status: "finalized" as const,
          setup: {
            config: null,
            participantSlotIds: ["slot-1", "slot-2"],
            playerOrder: ["slot-2", "slot-1"],
            assignments: [
              { slotId: "slot-1", assignment: null },
              { slotId: "slot-2", assignment: null },
            ],
          },
          rng: { ...rng },
        },
} satisfies RoundSetupDefinition<
  null,
  { readonly value: number },
  { readonly type: "INCREMENT" },
  { readonly value: number; readonly canEdit: boolean }
>;

describe("round setup coordinator", () => {
  it("applies strict actions, detects stale revisions and clears ready", () => {
    const initial = initializeRoundSetupCoordinator(
      coordinatorDefinition,
      { source: { kind: "defaults", config: null }, slots },
      createSetupRng("coordinator"),
    );
    expect(
      applyRoundSetupAction(coordinatorDefinition, initial, {
        action: { type: "UNKNOWN" },
        actorSlotId: "slot-1",
        isOwner: true,
        expectedSetupRevision: 0,
        slots,
      }),
    ).toEqual({ status: "rejected", code: "INVALID_SETUP_ACTION" });
    expect(
      applyRoundSetupAction(coordinatorDefinition, initial, {
        action: { type: "INCREMENT" },
        actorSlotId: "slot-1",
        isOwner: true,
        expectedSetupRevision: 1,
        slots,
      }),
    ).toEqual({ status: "stale", setupRevision: 0 });

    const accepted = applyRoundSetupAction(coordinatorDefinition, initial, {
      action: { type: "INCREMENT" },
      actorSlotId: "slot-1",
      isOwner: true,
      expectedSetupRevision: 0,
      slots,
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      coordinator: {
        setupState: { value: 1 },
        setupRevision: 1,
        readySlotIds: [],
        finalizedSetup: null,
      },
    });
    if (accepted.status !== "accepted") throw new Error("expected setup");
    const ready = setRoundSetupReady(
      coordinatorDefinition,
      accepted.coordinator,
      slots,
      "slot-1",
      true,
    );
    if (ready.status === "rejected") throw new Error("expected ready");
    const changed = applyRoundSetupAction(
      coordinatorDefinition,
      ready.coordinator,
      {
        action: { type: "INCREMENT" },
        actorSlotId: "slot-1",
        isOwner: true,
        expectedSetupRevision: 1,
        slots,
      },
    );
    expect(changed).toMatchObject({
      status: "accepted",
      coordinator: { setupRevision: 2, readySlotIds: [] },
    });
  });

  it("uses stable slots for per-player readiness and finalizes only once", () => {
    const initial = initializeRoundSetupCoordinator(
      coordinatorDefinition,
      { source: { kind: "defaults", config: null }, slots },
      createSetupRng("coordinator"),
    );
    const transitioned = applyRoundSetupAction(coordinatorDefinition, initial, {
      action: { type: "INCREMENT" },
      actorSlotId: "slot-1",
      isOwner: true,
      expectedSetupRevision: 0,
      slots,
    });
    if (transitioned.status !== "accepted") throw new Error("expected setup");
    const ownerReady = setRoundSetupReady(
      coordinatorDefinition,
      transitioned.coordinator,
      slots,
      "slot-1",
      true,
    );
    if (ownerReady.status === "rejected") throw new Error("expected ready");
    expect(
      finalizeRoundSetup(
        coordinatorDefinition,
        ownerReady.coordinator,
        slots,
        2,
        2,
      ),
    ).toEqual({ status: "waiting" });
    const guestReady = setRoundSetupReady(
      coordinatorDefinition,
      ownerReady.coordinator,
      slots,
      "slot-2",
      true,
    );
    if (guestReady.status === "rejected") throw new Error("expected ready");
    const finalized = finalizeRoundSetup(
      coordinatorDefinition,
      guestReady.coordinator,
      slots,
      2,
      2,
    );
    expect(finalized).toMatchObject({
      status: "finalized",
      setup: { playerOrder: ["slot-2", "slot-1"] },
    });
    if (finalized.status !== "finalized") throw new Error("expected final");
    expect(
      finalizeRoundSetup(
        coordinatorDefinition,
        finalized.coordinator,
        slots,
        2,
        2,
      ),
    ).toEqual(finalized);
    expect(
      getRoundSetupReadiness(
        coordinatorDefinition,
        finalized.coordinator,
        slots,
        "slot-1",
      ).canReady,
    ).toBe(true);
    const cancelled = setRoundSetupReady(
      coordinatorDefinition,
      finalized.coordinator,
      slots,
      "slot-1",
      false,
    );
    if (cancelled.status === "rejected") throw new Error("expected cancel");
    const readyAgain = setRoundSetupReady(
      coordinatorDefinition,
      cancelled.coordinator,
      slots,
      "slot-1",
      true,
    );
    if (readyAgain.status === "rejected") throw new Error("expected ready");
    expect(
      finalizeRoundSetup(
        coordinatorDefinition,
        readyAgain.coordinator,
        slots,
        2,
        2,
      ),
    ).toMatchObject({
      status: "finalized",
      setup: finalized.setup,
    });
  });

  it("projects viewer-safe setup views and blocks non-participants", () => {
    const coordinator = initializeRoundSetupCoordinator(
      coordinatorDefinition,
      { source: { kind: "defaults", config: null }, slots },
      createSetupRng("coordinator"),
    );
    expect(
      projectRoundSetupView(coordinatorDefinition, coordinator, slots, {
        kind: "spectator",
      }),
    ).toEqual({ value: 0, canEdit: false });
    expect(
      setRoundSetupReady(
        coordinatorDefinition,
        coordinator,
        slots,
        "slot-3",
        true,
      ),
    ).toEqual({ status: "rejected", code: "SETUP_NOT_READY" });
  });
});

describe("validateFinalizedRoundSetup", () => {
  it("accepts a canonical participant permutation", () => {
    expect(validateFinalizedRoundSetup(validSetup, slots, 2, 3)).toEqual({
      ok: true,
    });
  });

  it.each([
    [{ ...validSetup, participantSlotIds: ["slot-1"] }, "INVALID_PLAYER_COUNT"],
    [
      { ...validSetup, participantSlotIds: ["slot-1", "slot-1"] },
      "DUPLICATE_PARTICIPANT",
    ],
    [
      { ...validSetup, participantSlotIds: ["slot-1", "slot-3"] },
      "UNKNOWN_PARTICIPANT",
    ],
    [
      { ...validSetup, playerOrder: ["slot-1", "slot-3"] },
      "INVALID_PLAYER_ORDER",
    ],
    [
      { ...validSetup, assignments: [{ slotId: "slot-1", assignment: null }] },
      "INVALID_ASSIGNMENTS",
    ],
  ] as const)("rejects invalid finalized setup %#", (candidate, code) => {
    expect(validateFinalizedRoundSetup(candidate, slots, 2, 3)).toEqual({
      ok: false,
      code,
    });
  });
});
