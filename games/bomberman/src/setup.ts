import { z } from "zod";
import type {
  RoundSetupDefinition,
  SetupSlot,
} from "@online-game-hub/game-setup";
import { configSchema, type Config } from "./contracts.js";
import {
  classicMap,
  classicMode,
  supportedPlayerCounts,
} from "./definitions.js";

const counts = supportedPlayerCounts(classicMap, classicMode);
const setupStateSchema = z.object({ config: configSchema }).strict();
const setupActionSchema = z
  .object({
    type: z.literal("SET_PLAYER_COUNT"),
    playerCount: z
      .number()
      .int()
      .refine((value) => counts.includes(value)),
  })
  .strict();
const setupViewSchema = z
  .object({
    config: configSchema,
    playerCounts: z.array(z.number().int()),
    players: z.array(
      z
        .object({ slotId: z.string(), index: z.number().int().nonnegative() })
        .strict(),
    ),
    participantSlotIds: z.array(z.string()),
    canEdit: z.boolean(),
    selfSlotId: z.string().nullable(),
  })
  .strict();
type SetupState = z.infer<typeof setupStateSchema>;
type SetupAction = z.infer<typeof setupActionSchema>;
type SetupView = z.infer<typeof setupViewSchema>;
function readiness(state: SetupState, slots: readonly SetupSlot[]) {
  const occupied = slots.filter((slot) => slot.occupied);
  return {
    canFinalize:
      occupied.length === state.config.playerCount &&
      occupied.every((slot) => slot.online),
    participantSlotIds: occupied
      .slice(0, state.config.playerCount)
      .map((slot) => slot.slotId),
  };
}

export const bombermanSetupDefinition = {
  setupStateSchema,
  setupActionSchema,
  setupViewSchema,
  initialize({ source }) {
    return {
      config: configSchema.parse(
        source.kind === "defaults" ? source.config : source.setup.config,
      ),
    };
  },
  transition({ state, action, actorSlotId, isOwner, slots }) {
    if (!slots.some((slot) => slot.occupied && slot.slotId === actorSlotId))
      return { status: "rejected", code: "NOT_PARTICIPANT" };
    if (
      !isOwner ||
      !slots.some((slot) => slot.slotId === actorSlotId && slot.isOwner)
    )
      return { status: "rejected", code: "NOT_OWNER" };
    if (action.playerCount === state.config.playerCount)
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    return {
      status: "accepted",
      state: {
        config: configSchema.parse({
          ...state.config,
          playerCount: action.playerCount,
        }),
      },
    };
  },
  projectView({ state, slots, viewer }) {
    const selfSlotId = viewer.kind === "player" ? viewer.slotId : null;
    return {
      config: { ...state.config },
      playerCounts: [...counts],
      players: slots
        .filter((slot) => slot.occupied)
        .map((slot, index) => ({ slotId: slot.slotId, index })),
      participantSlotIds: readiness(state, slots).participantSlotIds,
      canEdit: slots.some(
        (slot) => slot.slotId === selfSlotId && slot.occupied && slot.isOwner,
      ),
      selfSlotId,
    };
  },
  getReadiness: readiness,
  finalize({ state, slots, rng }) {
    const ready = readiness(state, slots);
    if (!ready.canFinalize)
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
    return {
      status: "finalized",
      rng: { ...rng },
      setup: {
        config: { ...state.config },
        participantSlotIds: [...ready.participantSlotIds],
        playerOrder: [...ready.participantSlotIds],
        assignments: ready.participantSlotIds.map((slotId, index) => ({
          slotId,
          assignment: String(index),
        })),
      },
    };
  },
} satisfies RoundSetupDefinition<Config, SetupState, SetupAction, SetupView>;
