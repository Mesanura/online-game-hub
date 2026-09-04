import { describe, expect, it } from "vitest";

import {
  createSetupRng,
  nextSetupInt,
  SETUP_RNG_ALGORITHM_V1,
  validateFinalizedRoundSetup,
  type FinalizedRoundSetup,
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
