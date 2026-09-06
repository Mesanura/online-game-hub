import {
  nextSetupInt,
  type FinalizedRoundSetup,
  type RoundSetupDefinition,
  type SetupSlot,
} from "@online-game-hub/game-setup";
import { z } from "zod";

import { badmintonConfigSchema, type BadmintonConfig } from "../core/index.js";

const starter = z.enum(["OWNER", "NON_OWNER", "RANDOM", "FIXED"]);
export const badmintonSetupStateSchema = z
  .object({
    config: badmintonConfigSchema,
    starter,
    fixedStarterSlotId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.starter === "FIXED") !== (state.fixedStarterSlotId !== null)) {
      context.addIssue({
        code: "custom",
        message: "FIXED order requires a stable slot.",
      });
    }
  });
export const badmintonSetupActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SELECT_STARTER"),
      starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_TARGET_SCORE"),
      targetScore: badmintonConfigSchema.shape.targetScore,
    })
    .strict(),
]);
export const badmintonSetupViewSchema = z
  .object({
    config: badmintonConfigSchema,
    starter,
    fixedStarterSlotId: z.string().min(1).nullable(),
    participantSlotIds: z.array(z.string().min(1)).max(2),
    canEdit: z.boolean(),
  })
  .strict();

export type BadmintonSetupState = z.infer<typeof badmintonSetupStateSchema>;
export type BadmintonSetupAction = z.infer<typeof badmintonSetupActionSchema>;
export type BadmintonSetupView = z.infer<typeof badmintonSetupViewSchema>;

function participants(slots: readonly SetupSlot[]) {
  return slots.filter((slot) => slot.occupied);
}

function ready(
  state: Readonly<BadmintonSetupState>,
  slots: readonly SetupSlot[],
): boolean {
  const players = participants(slots);
  return (
    players.length === 2 &&
    new Set(players.map((slot) => slot.slotId)).size === 2 &&
    players.filter((slot) => slot.isOwner).length === 1 &&
    (state.starter !== "FIXED" ||
      players.some((slot) => slot.slotId === state.fixedStarterSlotId))
  );
}

export const badmintonSetupDefinition = Object.freeze({
  setupStateSchema: badmintonSetupStateSchema,
  setupActionSchema: badmintonSetupActionSchema,
  setupViewSchema: badmintonSetupViewSchema,
  initialize(context) {
    const source = context.source;
    const config = badmintonConfigSchema.parse(
      source.kind === "previous-round" ? source.setup.config : source.config,
    );
    const fixedStarterSlotId =
      source.kind === "previous-round" ? source.setup.playerOrder[0] : null;
    if (fixedStarterSlotId === undefined)
      throw new Error("Previous badminton order is empty.");
    return Object.freeze({
      config: Object.freeze(config),
      starter: fixedStarterSlotId === null ? "OWNER" : "FIXED",
      fixedStarterSlotId,
    });
  },
  transition(context) {
    if (
      !context.isOwner ||
      !context.slots.some(
        (slot) =>
          slot.slotId === context.actorSlotId && slot.isOwner && slot.occupied,
      )
    )
      return { status: "rejected", code: "NOT_OWNER" };
    const action = badmintonSetupActionSchema.parse(context.action);
    const previous = context.state;
    if (action.type === "SELECT_STARTER") {
      if (previous.starter === action.starter)
        return { status: "rejected", code: "SETUP_UNCHANGED" };
      return {
        status: "accepted",
        state: Object.freeze({
          config: Object.freeze({ ...previous.config }),
          starter: action.starter,
          fixedStarterSlotId: null,
        }),
      };
    }
    if (previous.config.targetScore === action.targetScore)
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    return {
      status: "accepted",
      state: Object.freeze({
        ...previous,
        config: Object.freeze({ targetScore: action.targetScore }),
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
      participantSlotIds: participants(context.slots).map(
        (slot) => slot.slotId,
      ),
      canEdit: context.slots.some(
        (slot) => slot.slotId === viewerSlotId && slot.isOwner && slot.occupied,
      ),
    });
  },
  getReadiness(state, slots) {
    return {
      canFinalize: ready(state, slots),
      participantSlotIds: participants(slots).map((slot) => slot.slotId),
    };
  },
  finalize(context) {
    if (!ready(context.state, context.slots))
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
    const players = participants(context.slots);
    const owner = players.find((slot) => slot.isOwner);
    const guest = players.find((slot) => !slot.isOwner);
    if (owner === undefined || guest === undefined)
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
    let first =
      context.state.starter === "NON_OWNER"
        ? guest.slotId
        : context.state.starter === "FIXED"
          ? context.state.fixedStarterSlotId
          : owner.slotId;
    if (first === null)
      return { status: "rejected", code: "INVALID_FIXED_STARTER" };
    let rng = { ...context.rng };
    if (context.state.starter === "RANDOM") {
      const selection = nextSetupInt(rng, 2);
      rng = selection.next;
      first = selection.value === 0 ? owner.slotId : guest.slotId;
    }
    const second = first === owner.slotId ? guest.slotId : owner.slotId;
    const setup: FinalizedRoundSetup<BadmintonConfig> = Object.freeze({
      config: Object.freeze({ ...context.state.config }),
      participantSlotIds: Object.freeze(players.map((slot) => slot.slotId)),
      playerOrder: Object.freeze([first, second]),
      assignments: Object.freeze(
        players.map((slot) =>
          Object.freeze({ slotId: slot.slotId, assignment: null }),
        ),
      ),
    });
    return { status: "finalized", setup, rng };
  },
} satisfies RoundSetupDefinition<
  BadmintonConfig,
  BadmintonSetupState,
  BadmintonSetupAction,
  BadmintonSetupView
>);
