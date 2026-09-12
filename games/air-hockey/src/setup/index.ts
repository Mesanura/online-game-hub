import type {
  RoundSetupDefinition,
  SetupSlot,
} from "@online-game-hub/game-setup";
import { z } from "zod";

import {
  airHockeyConfigSchema,
  targetScoreSchema,
  type AirHockeyConfig,
} from "../core/schemas.js";

export const airHockeySetupStateSchema = z
  .object({ config: airHockeyConfigSchema })
  .strict();
export const airHockeySetupActionSchema = z
  .object({
    type: z.literal("SET_TARGET_SCORE"),
    targetScore: targetScoreSchema,
  })
  .strict();
export const airHockeySetupViewSchema = z
  .object({
    config: airHockeyConfigSchema,
    participantSlotIds: z.array(z.string().min(1)).max(2),
    ownerSlotId: z.string().min(1).nullable(),
    canEdit: z.boolean(),
  })
  .strict();

type SetupState = z.infer<typeof airHockeySetupStateSchema>;
type SetupAction = z.infer<typeof airHockeySetupActionSchema>;
type SetupView = z.infer<typeof airHockeySetupViewSchema>;

function participants(slots: readonly SetupSlot[]) {
  return slots.filter((slot) => slot.occupied);
}

export const airHockeySetupDefinition = Object.freeze({
  setupStateSchema: airHockeySetupStateSchema,
  setupActionSchema: airHockeySetupActionSchema,
  setupViewSchema: airHockeySetupViewSchema,
  initialize({ source }) {
    return {
      config: airHockeyConfigSchema.parse(
        source.kind === "defaults" ? source.config : source.setup.config,
      ),
    };
  },
  transition({ state, action, isOwner }) {
    if (!isOwner) return { status: "rejected", code: "NOT_OWNER" };
    if (state.config.targetScore === action.targetScore)
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    return {
      status: "accepted",
      state: { config: { targetScore: action.targetScore } },
    };
  },
  projectView({ state, viewer, slots }) {
    const ownerSlotId =
      participants(slots).find((slot) => slot.isOwner)?.slotId ?? null;
    return {
      config: { ...state.config },
      participantSlotIds: participants(slots).map((slot) => slot.slotId),
      ownerSlotId,
      canEdit: viewer.kind === "player" && viewer.slotId === ownerSlotId,
    };
  },
  getReadiness(_state, slots) {
    const selected = participants(slots);
    return {
      canFinalize:
        selected.length === 2 &&
        selected.filter((slot) => slot.isOwner).length === 1,
      participantSlotIds: selected.map((slot) => slot.slotId),
    };
  },
  finalize({ state, slots, rng }) {
    const selected = participants(slots);
    const owner = selected.find((slot) => slot.isOwner);
    const guest = selected.find((slot) => !slot.isOwner);
    if (selected.length !== 2 || owner === undefined || guest === undefined)
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
    const playerOrder = [owner.slotId, guest.slotId];
    return {
      status: "finalized",
      setup: {
        config: { ...state.config },
        participantSlotIds: selected.map((slot) => slot.slotId),
        playerOrder,
        assignments: playerOrder.map((slotId) => ({
          slotId,
          assignment: null,
        })),
      },
      rng: { ...rng },
    };
  },
} satisfies RoundSetupDefinition<
  AirHockeyConfig,
  SetupState,
  SetupAction,
  SetupView
>);
