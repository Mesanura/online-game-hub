import type { ZodType } from "zod";

export type SetupJsonPrimitive = null | boolean | number | string;
export type SetupJsonValue =
  | SetupJsonPrimitive
  | readonly SetupJsonValue[]
  | { readonly [key: string]: SetupJsonValue };

export type SetupRuleErrorCode = string;

export interface SetupSlot {
  readonly slotId: string;
  readonly occupied: boolean;
  readonly online: boolean;
  readonly isOwner: boolean;
}

export type SetupViewer =
  | { readonly kind: "player"; readonly slotId: string }
  | { readonly kind: "spectator" };

export const SETUP_RNG_ALGORITHM_V1 = "fnv1a32-counter-v1" as const;

export interface SetupRngState {
  readonly algorithm: typeof SETUP_RNG_ALGORITHM_V1;
  readonly seed: string;
  readonly cursor: number;
}

export interface SetupRandomStep<T extends SetupJsonValue> {
  readonly value: T;
  readonly next: SetupRngState;
}

export function createSetupRng(seed: string): SetupRngState {
  if (seed.length === 0) {
    throw new TypeError("Setup RNG seed must not be empty.");
  }
  return { algorithm: SETUP_RNG_ALGORITHM_V1, seed, cursor: 0 };
}

function validateSetupRng(rng: Readonly<SetupRngState>): void {
  if (rng.algorithm !== SETUP_RNG_ALGORITHM_V1) {
    throw new TypeError(
      "Unsupported Setup RNG algorithm: " + String(rng.algorithm) + ".",
    );
  }
  if (rng.seed.length === 0) {
    throw new TypeError("Setup RNG seed must not be empty.");
  }
  if (!Number.isSafeInteger(rng.cursor) || rng.cursor < 0) {
    throw new RangeError(
      "Setup RNG cursor must be a non-negative safe integer.",
    );
  }
}

function setupCounterHash(seed: string, cursor: number): number {
  let hash = 0x81_1c_9d_c5;
  const input = seed + "\u0000" + cursor.toString(10);
  for (let index = 0; index < input.length; index += 1) {
    const codeUnit = input.charCodeAt(index);
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01_00_01_93);
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01_00_01_93);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7f_eb_35_2d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x84_6c_a6_8b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function nextSetupInt(
  rng: Readonly<SetupRngState>,
  maxExclusive: number,
): SetupRandomStep<number> {
  validateSetupRng(rng);
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive > 0x1_00_00_00_00
  ) {
    throw new RangeError("maxExclusive must be an integer between 1 and 2^32.");
  }

  const uint32Range = 0x1_00_00_00_00;
  const unbiasedLimit = uint32Range - (uint32Range % maxExclusive);
  let cursor = rng.cursor;
  for (;;) {
    if (cursor >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Setup RNG cursor is exhausted.");
    }
    const candidate = setupCounterHash(rng.seed, cursor);
    cursor += 1;
    if (candidate < unbiasedLimit) {
      return {
        value: candidate % maxExclusive,
        next: {
          algorithm: SETUP_RNG_ALGORITHM_V1,
          seed: rng.seed,
          cursor,
        },
      };
    }
  }
}

export interface FinalizedRoundSetup<
  Config extends SetupJsonValue = SetupJsonValue,
> {
  readonly config: Config;
  readonly participantSlotIds: readonly string[];
  readonly playerOrder: readonly string[];
  readonly assignments: readonly {
    readonly slotId: string;
    readonly assignment: string | null;
  }[];
}

export type SetupInitializationSource<Config extends SetupJsonValue> =
  | { readonly kind: "defaults"; readonly config: Config }
  | {
      readonly kind: "previous-round";
      readonly setup: FinalizedRoundSetup<Config>;
    };

export interface SetupInitializationContext<Config extends SetupJsonValue> {
  readonly source: SetupInitializationSource<Config>;
  readonly slots: readonly SetupSlot[];
}

export interface SetupTransitionContext<
  State extends SetupJsonValue,
  Action extends SetupJsonValue,
> {
  readonly state: Readonly<State>;
  readonly action: Readonly<Action>;
  readonly actorSlotId: string;
  readonly isOwner: boolean;
  readonly slots: readonly SetupSlot[];
}

export type SetupTransition<State extends SetupJsonValue> =
  | { readonly status: "accepted"; readonly state: State }
  | { readonly status: "rejected"; readonly code: SetupRuleErrorCode };

export interface SetupProjectionContext<State extends SetupJsonValue> {
  readonly state: Readonly<State>;
  readonly viewer: SetupViewer;
  readonly slots: readonly SetupSlot[];
}

export interface SetupReadiness {
  readonly canFinalize: boolean;
  readonly participantSlotIds: readonly string[];
}

export interface SetupFinalizeContext<State extends SetupJsonValue> {
  readonly state: Readonly<State>;
  readonly slots: readonly SetupSlot[];
  readonly rng: Readonly<SetupRngState>;
}

export type SetupFinalization<Config extends SetupJsonValue> =
  | {
      readonly status: "finalized";
      readonly setup: FinalizedRoundSetup<Config>;
      readonly rng: SetupRngState;
    }
  | { readonly status: "rejected"; readonly code: SetupRuleErrorCode };

export interface RoundSetupDefinition<
  Config extends SetupJsonValue,
  State extends SetupJsonValue,
  Action extends SetupJsonValue,
  View extends SetupJsonValue,
> {
  readonly setupStateSchema: ZodType<State>;
  readonly setupActionSchema: ZodType<Action>;
  readonly setupViewSchema: ZodType<View>;
  initialize(context: SetupInitializationContext<Config>): State;
  transition(
    context: SetupTransitionContext<State, Action>,
  ): SetupTransition<State>;
  projectView(context: SetupProjectionContext<State>): View;
  getReadiness(
    state: Readonly<State>,
    slots: readonly SetupSlot[],
  ): SetupReadiness;
  finalize(context: SetupFinalizeContext<State>): SetupFinalization<Config>;
}

export type UnknownRoundSetupDefinition = RoundSetupDefinition<
  SetupJsonValue,
  SetupJsonValue,
  SetupJsonValue,
  SetupJsonValue
>;

export function eraseRoundSetupDefinition<
  Config extends SetupJsonValue,
  State extends SetupJsonValue,
  Action extends SetupJsonValue,
  View extends SetupJsonValue,
>(
  definition: RoundSetupDefinition<Config, State, Action, View>,
): UnknownRoundSetupDefinition {
  return definition as unknown as UnknownRoundSetupDefinition;
}

export type FinalizedSetupValidationCode =
  | "INVALID_PLAYER_COUNT"
  | "UNKNOWN_PARTICIPANT"
  | "DUPLICATE_PARTICIPANT"
  | "INVALID_PLAYER_ORDER"
  | "INVALID_ASSIGNMENTS";

export type FinalizedSetupValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: FinalizedSetupValidationCode };

export function validateFinalizedRoundSetup(
  setup: FinalizedRoundSetup,
  slots: readonly SetupSlot[],
  minimumPlayers: number,
  maximumPlayers: number,
): FinalizedSetupValidation {
  const participants = setup.participantSlotIds;
  if (
    !Number.isSafeInteger(minimumPlayers) ||
    !Number.isSafeInteger(maximumPlayers) ||
    minimumPlayers < 1 ||
    maximumPlayers < minimumPlayers ||
    participants.length < minimumPlayers ||
    participants.length > maximumPlayers
  ) {
    return { ok: false, code: "INVALID_PLAYER_COUNT" };
  }

  if (new Set(participants).size !== participants.length) {
    return { ok: false, code: "DUPLICATE_PARTICIPANT" };
  }

  const occupiedSlots = new Set(
    slots.filter((slot) => slot.occupied).map((slot) => slot.slotId),
  );
  if (participants.some((slotId) => !occupiedSlots.has(slotId))) {
    return { ok: false, code: "UNKNOWN_PARTICIPANT" };
  }

  if (
    setup.playerOrder.length !== participants.length ||
    new Set(setup.playerOrder).size !== setup.playerOrder.length ||
    setup.playerOrder.some((slotId) => !participants.includes(slotId))
  ) {
    return { ok: false, code: "INVALID_PLAYER_ORDER" };
  }

  const assignmentSlots = setup.assignments.map((entry) => entry.slotId);
  if (
    assignmentSlots.length !== participants.length ||
    new Set(assignmentSlots).size !== assignmentSlots.length ||
    assignmentSlots.some((slotId) => !participants.includes(slotId))
  ) {
    return { ok: false, code: "INVALID_ASSIGNMENTS" };
  }

  return { ok: true };
}
