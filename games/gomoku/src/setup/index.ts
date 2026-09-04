import {
  nextSetupInt,
  type FinalizedRoundSetup,
  type RoundSetupDefinition,
  type SetupRngState,
  type SetupSlot,
} from "@online-game-hub/game-setup";
import { z } from "zod";

import { gomokuConfigSchema, type GomokuConfig } from "../core/index.js";

const starterSelectionSchema = z.enum([
  "UNSELECTED",
  "OWNER",
  "NON_OWNER",
  "RANDOM",
  "FIXED",
]);

export const gomokuSetupStateSchema = z
  .object({
    config: gomokuConfigSchema,
    starter: starterSelectionSchema,
    fixedStarterSlotId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.starter === "FIXED") !== (state.fixedStarterSlotId !== null)) {
      context.addIssue({
        code: "custom",
        message: "FIXED starter must identify exactly one stable slot.",
      });
    }
  });

export type GomokuSetupState = z.infer<typeof gomokuSetupStateSchema>;

export const gomokuSetupActionSchema = z
  .object({
    type: z.literal("SELECT_STARTER"),
    starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
  })
  .strict();

export type GomokuSetupAction = z.infer<typeof gomokuSetupActionSchema>;

export const gomokuSetupViewSchema = z
  .object({
    config: gomokuConfigSchema,
    starter: starterSelectionSchema,
    fixedStarterSlotId: z.string().min(1).nullable(),
    participantSlotIds: z.array(z.string().min(1)),
    canEdit: z.boolean(),
  })
  .strict();

export type GomokuSetupView = z.infer<typeof gomokuSetupViewSchema>;

function occupiedSlots(slots: readonly SetupSlot[]): readonly SetupSlot[] {
  return slots.filter((slot) => slot.occupied);
}

function canFinalize(
  state: Readonly<GomokuSetupState>,
  slots: readonly SetupSlot[],
): boolean {
  const participants = occupiedSlots(slots);
  return (
    participants.length === 2 &&
    participants.filter((slot) => slot.isOwner).length === 1 &&
    state.starter !== "UNSELECTED" &&
    (state.starter !== "FIXED" ||
      participants.some((slot) => slot.slotId === state.fixedStarterSlotId))
  );
}

function finalizeOrder(
  state: Readonly<GomokuSetupState>,
  participants: readonly SetupSlot[],
  rng: Readonly<SetupRngState>,
):
  | { readonly order: readonly [string, string]; readonly rng: SetupRngState }
  | undefined {
  const owner = participants.find((slot) => slot.isOwner);
  const other = participants.find((slot) => !slot.isOwner);
  if (owner === undefined || other === undefined) return undefined;
  if (state.starter === "OWNER") {
    return { order: [owner.slotId, other.slotId], rng: { ...rng } };
  }
  if (state.starter === "NON_OWNER") {
    return { order: [other.slotId, owner.slotId], rng: { ...rng } };
  }
  if (state.starter === "RANDOM") {
    const random = nextSetupInt(rng, 2);
    return {
      order:
        random.value === 0
          ? [owner.slotId, other.slotId]
          : [other.slotId, owner.slotId],
      rng: random.next,
    };
  }
  if (state.fixedStarterSlotId === owner.slotId) {
    return { order: [owner.slotId, other.slotId], rng: { ...rng } };
  }
  if (state.fixedStarterSlotId === other.slotId) {
    return { order: [other.slotId, owner.slotId], rng: { ...rng } };
  }
  return undefined;
}

export const gomokuSetupDefinition = Object.freeze({
  setupStateSchema: gomokuSetupStateSchema,
  setupActionSchema: gomokuSetupActionSchema,
  setupViewSchema: gomokuSetupViewSchema,
  initialize(context) {
    const previousStarter =
      context.source.kind === "previous-round"
        ? (context.source.setup.playerOrder[0] ?? null)
        : null;
    const config =
      context.source.kind === "previous-round"
        ? context.source.setup.config
        : context.source.config;
    return Object.freeze({
      config: Object.freeze({ ...config }),
      starter: previousStarter === null ? "UNSELECTED" : "FIXED",
      fixedStarterSlotId: previousStarter,
    });
  },
  transition(context) {
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
        config: Object.freeze({ ...context.state.config }),
        starter: context.action.starter,
        fixedStarterSlotId: null,
      }),
    };
  },
  projectView(context) {
    const viewerSlotId =
      context.viewer.kind === "player" ? context.viewer.slotId : null;
    return Object.freeze({
      config: Object.freeze({ ...context.state.config }),
      starter: context.state.starter,
      fixedStarterSlotId: context.state.fixedStarterSlotId,
      participantSlotIds: occupiedSlots(context.slots).map(
        (slot) => slot.slotId,
      ),
      canEdit:
        viewerSlotId !== null &&
        context.slots.some(
          (slot) => slot.slotId === viewerSlotId && slot.isOwner,
        ),
    });
  },
  getReadiness(state, slots) {
    return Object.freeze({
      canFinalize: canFinalize(state, slots),
      participantSlotIds: Object.freeze(
        occupiedSlots(slots).map((slot) => slot.slotId),
      ),
    });
  },
  finalize(context) {
    const participants = occupiedSlots(context.slots);
    if (!canFinalize(context.state, context.slots)) {
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
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
    const setup: FinalizedRoundSetup<GomokuConfig> = Object.freeze({
      config: Object.freeze({ ...context.state.config }),
      participantSlotIds,
      playerOrder: Object.freeze([...finalizedOrder.order]),
      assignments: Object.freeze(
        participantSlotIds.map((slotId) =>
          Object.freeze({ slotId, assignment: null }),
        ),
      ),
    });
    return { status: "finalized", setup, rng: finalizedOrder.rng };
  },
} satisfies RoundSetupDefinition<
  GomokuConfig,
  GomokuSetupState,
  GomokuSetupAction,
  GomokuSetupView
>);
