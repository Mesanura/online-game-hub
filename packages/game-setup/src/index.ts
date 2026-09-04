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

export interface SetupRngState {
  readonly algorithm: "fnv1a32-counter-v1";
  readonly seed: string;
  readonly cursor: number;
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
