import {
  nextSetupInt,
  type FinalizedRoundSetup,
  type RoundSetupDefinition,
  type SetupInitializationSource,
  type SetupRngState,
  type SetupSlot,
} from "@online-game-hub/game-setup";
import { z } from "zod";

import {
  CHINESE_CHECKERS_CAMP_OPTIONS,
  CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS,
} from "../constants.js";
import type { ChineseCheckersCamp, ChineseCheckersConfig } from "../types.js";

const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);
const selectableStarterSchema = z.enum(["OWNER", "NON_OWNER", "RANDOM"]);
const campSchema = z.enum(CHINESE_CHECKERS_CAMP_OPTIONS);
const assignmentSchema = z
  .object({
    slotId: z.string().min(1),
    camp: campSchema,
  })
  .strict();

export const chineseCheckersSetupStateSchema = z
  .object({
    targetPlayerCount: z.number().int().min(2).max(6),
    starter: starterSelectionSchema,
    fixedStarterSlotId: z.string().min(1).nullable(),
    assignments: z.array(assignmentSchema).max(6),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.starter === "FIXED") !== (state.fixedStarterSlotId !== null)) {
      context.addIssue({
        code: "custom",
        message: "FIXED starter must identify exactly one stable slot.",
      });
    }
    if (
      new Set(state.assignments.map((entry) => entry.slotId)).size !==
      state.assignments.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Each stable slot may have at most one camp assignment.",
      });
    }
    if (
      new Set(state.assignments.map((entry) => entry.camp)).size !==
      state.assignments.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Each camp may be assigned to at most one stable slot.",
      });
    }
  });

export type ChineseCheckersSetupState = z.infer<
  typeof chineseCheckersSetupStateSchema
>;

export const chineseCheckersSetupActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SELECT_PLAYER_COUNT"),
      playerCount: z.number().int().min(2).max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("SELECT_CAMP"),
      camp: campSchema,
    })
    .strict(),
  z.object({ type: z.literal("CLEAR_CAMP") }).strict(),
  z
    .object({
      type: z.literal("SELECT_STARTER"),
      starter: selectableStarterSchema,
    })
    .strict(),
]);

export type ChineseCheckersSetupAction = z.infer<
  typeof chineseCheckersSetupActionSchema
>;

const setupParticipantSchema = z
  .object({
    slotId: z.string().min(1),
    isOwner: z.boolean(),
    camp: campSchema.nullable(),
  })
  .strict();

export const chineseCheckersSetupViewSchema = z
  .object({
    targetPlayerCount: z.number().int().min(2).max(6),
    starter: starterSelectionSchema,
    fixedStarterSlotId: z.string().min(1).nullable(),
    participants: z.array(setupParticipantSchema).max(6),
    canEditRules: z.boolean(),
    canSelectCamp: z.boolean(),
    yourCamp: campSchema.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if (
      new Set(view.participants.map((participant) => participant.slotId))
        .size !== view.participants.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Participant slots must be unique.",
      });
    }
    const selectedCamps = view.participants.flatMap((participant) =>
      participant.camp === null ? [] : [participant.camp],
    );
    if (new Set(selectedCamps).size !== selectedCamps.length) {
      context.addIssue({
        code: "custom",
        message: "Participant camps must be unique.",
      });
    }
  });

export type ChineseCheckersSetupView = z.infer<
  typeof chineseCheckersSetupViewSchema
>;

function occupiedSlots(slots: readonly SetupSlot[]): readonly SetupSlot[] {
  return slots.filter((slot) => slot.occupied);
}

function assignmentFor(
  state: Readonly<ChineseCheckersSetupState>,
  slotId: string,
): ChineseCheckersCamp | null {
  return (
    state.assignments.find((assignment) => assignment.slotId === slotId)
      ?.camp ?? null
  );
}

function canonicalAssignments(
  assignments: readonly {
    readonly slotId: string;
    readonly camp: ChineseCheckersCamp;
  }[],
  slots: readonly SetupSlot[],
): { slotId: string; camp: ChineseCheckersCamp }[] {
  const bySlot = new Map(
    assignments.map((entry) => [entry.slotId, entry.camp]),
  );
  return slots.flatMap((slot) => {
    const camp = bySlot.get(slot.slotId);
    return camp === undefined ? [] : [{ slotId: slot.slotId, camp }];
  });
}

function setupIsComplete(
  state: Readonly<ChineseCheckersSetupState>,
  slots: readonly SetupSlot[],
): boolean {
  const participants = occupiedSlots(slots);
  if (
    participants.length !== state.targetPlayerCount ||
    participants.length < 2 ||
    participants.length > 6 ||
    participants.filter((slot) => slot.isOwner).length !== 1 ||
    state.starter === "UNSELECTED"
  ) {
    return false;
  }
  if (
    state.starter === "FIXED" &&
    !participants.some((slot) => slot.slotId === state.fixedStarterSlotId)
  ) {
    return false;
  }
  const camps = participants.map((slot) => assignmentFor(state, slot.slotId));
  return (
    camps.every((camp) => camp !== null) &&
    new Set(camps).size === participants.length
  );
}

function counterclockwiseOrder(
  state: Readonly<ChineseCheckersSetupState>,
  participants: readonly SetupSlot[],
): readonly SetupSlot[] {
  return participants.slice().sort((left, right) => {
    const leftCamp = assignmentFor(state, left.slotId);
    const rightCamp = assignmentFor(state, right.slotId);
    return (
      CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS.indexOf(
        leftCamp ?? CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS[0],
      ) -
      CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS.indexOf(
        rightCamp ?? CHINESE_CHECKERS_COUNTERCLOCKWISE_CAMPS[0],
      )
    );
  });
}

function rotateFromStarter(
  orderedSlotIds: readonly string[],
  starterSlotId: string,
): readonly string[] | undefined {
  const starterIndex = orderedSlotIds.indexOf(starterSlotId);
  if (starterIndex === -1) return undefined;
  return Object.freeze([
    ...orderedSlotIds.slice(starterIndex),
    ...orderedSlotIds.slice(0, starterIndex),
  ]);
}

function finalizeOrder(
  state: Readonly<ChineseCheckersSetupState>,
  participants: readonly SetupSlot[],
  rng: Readonly<SetupRngState>,
):
  | { readonly order: readonly string[]; readonly rng: SetupRngState }
  | undefined {
  const owner = participants.find((slot) => slot.isOwner);
  if (owner === undefined) return undefined;
  const orderedSlotIds = counterclockwiseOrder(state, participants).map(
    (slot) => slot.slotId,
  );
  const firstNonOwner = orderedSlotIds.find(
    (slotId) => slotId !== owner.slotId,
  );
  if (firstNonOwner === undefined) return undefined;

  if (state.starter === "OWNER") {
    const order = rotateFromStarter(orderedSlotIds, owner.slotId);
    return order === undefined ? undefined : { order, rng: { ...rng } };
  }
  if (state.starter === "NON_OWNER") {
    const order = rotateFromStarter(orderedSlotIds, firstNonOwner);
    return order === undefined ? undefined : { order, rng: { ...rng } };
  }
  if (state.starter === "RANDOM") {
    const random = nextSetupInt(rng, 2);
    const starterSlotId = random.value === 0 ? owner.slotId : firstNonOwner;
    const order = rotateFromStarter(orderedSlotIds, starterSlotId);
    return order === undefined ? undefined : { order, rng: random.next };
  }
  if (state.starter === "FIXED" && state.fixedStarterSlotId !== null) {
    const order = rotateFromStarter(orderedSlotIds, state.fixedStarterSlotId);
    return order === undefined ? undefined : { order, rng: { ...rng } };
  }
  return undefined;
}

function initializeAssignments(
  source: SetupInitializationSource<ChineseCheckersConfig>,
  slots: readonly SetupSlot[],
): { slotId: string; camp: ChineseCheckersCamp }[] {
  if (source.kind !== "previous-round") return [];
  const assignments = source.setup.assignments.flatMap((entry) => {
    const camp = campSchema.safeParse(entry.assignment);
    return camp.success ? [{ slotId: entry.slotId, camp: camp.data }] : [];
  });
  return canonicalAssignments(assignments, slots);
}

export const chineseCheckersSetupDefinition = Object.freeze({
  setupStateSchema: chineseCheckersSetupStateSchema,
  setupActionSchema: chineseCheckersSetupActionSchema,
  setupViewSchema: chineseCheckersSetupViewSchema,
  initialize(context) {
    const previousStarter =
      context.source.kind === "previous-round"
        ? (context.source.setup.playerOrder[0] ?? null)
        : null;
    return Object.freeze({
      targetPlayerCount:
        context.source.kind === "previous-round"
          ? context.source.setup.participantSlotIds.length
          : 2,
      starter: previousStarter === null ? "UNSELECTED" : "FIXED",
      fixedStarterSlotId: previousStarter,
      assignments: initializeAssignments(context.source, context.slots),
    });
  },
  transition(context) {
    if (context.action.type === "SELECT_PLAYER_COUNT") {
      if (!context.isOwner) return { status: "rejected", code: "NOT_OWNER" };
      if (occupiedSlots(context.slots).length > context.action.playerCount) {
        return { status: "rejected", code: "PLAYER_COUNT_TOO_SMALL" };
      }
      if (context.state.targetPlayerCount === context.action.playerCount) {
        return { status: "rejected", code: "SETUP_UNCHANGED" };
      }
      return {
        status: "accepted",
        state: Object.freeze({
          ...context.state,
          targetPlayerCount: context.action.playerCount,
        }),
      };
    }

    if (context.action.type === "SELECT_STARTER") {
      if (!context.isOwner) return { status: "rejected", code: "NOT_OWNER" };
      if (
        context.state.starter === context.action.starter &&
        context.state.fixedStarterSlotId === null
      ) {
        return { status: "rejected", code: "SETUP_UNCHANGED" };
      }
      return {
        status: "accepted",
        state: Object.freeze({
          ...context.state,
          starter: context.action.starter,
          fixedStarterSlotId: null,
        }),
      };
    }

    const actor = context.slots.find(
      (slot) => slot.slotId === context.actorSlotId && slot.occupied,
    );
    if (actor === undefined)
      return { status: "rejected", code: "NOT_A_PLAYER" };
    const currentCamp = assignmentFor(context.state, actor.slotId);
    if (context.action.type === "CLEAR_CAMP") {
      if (currentCamp === null) {
        return { status: "rejected", code: "SETUP_UNCHANGED" };
      }
      return {
        status: "accepted",
        state: Object.freeze({
          ...context.state,
          assignments: canonicalAssignments(
            context.state.assignments.filter(
              (entry) => entry.slotId !== actor.slotId,
            ),
            context.slots,
          ),
        }),
      };
    }

    if (context.action.type !== "SELECT_CAMP") {
      return { status: "rejected", code: "INVALID_SETUP_ACTION" };
    }
    const selectedCamp = context.action.camp;
    if (currentCamp === selectedCamp) {
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    }
    const conflictingSlotId = context.state.assignments.find(
      (entry) => entry.camp === selectedCamp,
    )?.slotId;
    if (
      conflictingSlotId !== undefined &&
      context.slots.some(
        (slot) => slot.slotId === conflictingSlotId && slot.occupied,
      )
    ) {
      return { status: "rejected", code: "CAMP_TAKEN" };
    }
    return {
      status: "accepted",
      state: Object.freeze({
        ...context.state,
        assignments: canonicalAssignments(
          [
            ...context.state.assignments.filter(
              (entry) =>
                entry.slotId !== actor.slotId && entry.camp !== selectedCamp,
            ),
            { slotId: actor.slotId, camp: selectedCamp },
          ],
          context.slots,
        ),
      }),
    };
  },
  projectView(context) {
    const viewerSlotId =
      context.viewer.kind === "player" ? context.viewer.slotId : null;
    const viewerSlot = context.slots.find(
      (slot) => slot.slotId === viewerSlotId && slot.occupied,
    );
    return Object.freeze({
      targetPlayerCount: context.state.targetPlayerCount,
      starter: context.state.starter,
      fixedStarterSlotId: context.state.fixedStarterSlotId,
      participants: occupiedSlots(context.slots).map((slot) => ({
        slotId: slot.slotId,
        isOwner: slot.isOwner,
        camp: assignmentFor(context.state, slot.slotId),
      })),
      canEditRules: viewerSlot?.isOwner === true,
      canSelectCamp: viewerSlot !== undefined,
      yourCamp:
        viewerSlot === undefined
          ? null
          : assignmentFor(context.state, viewerSlot.slotId),
    });
  },
  getReadiness(state, slots) {
    return Object.freeze({
      canFinalize: setupIsComplete(state, slots),
      participantSlotIds: Object.freeze(
        occupiedSlots(slots).map((slot) => slot.slotId),
      ),
    });
  },
  finalize(context) {
    const participants = occupiedSlots(context.slots);
    if (!setupIsComplete(context.state, context.slots)) {
      return { status: "rejected", code: "SETUP_INCOMPLETE" };
    }
    const finalizedOrder = finalizeOrder(
      context.state,
      participants,
      context.rng,
    );
    if (finalizedOrder === undefined) {
      return { status: "rejected", code: "INVALID_FIXED_STARTER" };
    }
    const participantSlotIds = Object.freeze(
      participants.map((slot) => slot.slotId),
    );
    const assignments = finalizedOrder.order.map((slotId) => {
      const camp = assignmentFor(context.state, slotId);
      if (camp === null)
        throw new Error("Complete Setup must assign every camp.");
      return Object.freeze({ slotId, assignment: camp });
    });
    const setup: FinalizedRoundSetup<ChineseCheckersConfig> = Object.freeze({
      config: null,
      participantSlotIds,
      playerOrder: Object.freeze([...finalizedOrder.order]),
      assignments: Object.freeze(assignments),
    });
    return { status: "finalized", setup, rng: finalizedOrder.rng };
  },
} satisfies RoundSetupDefinition<
  ChineseCheckersConfig,
  ChineseCheckersSetupState,
  ChineseCheckersSetupAction,
  ChineseCheckersSetupView
>);
