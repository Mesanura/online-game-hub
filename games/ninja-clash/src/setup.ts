import { z } from "zod";
import type {
  RoundSetupDefinition,
  SetupSlot,
} from "@online-game-hub/game-setup";
import { configSchema, type Config } from "./contracts.js";
const setupStateSchema = z.object({ config: configSchema }).strict();
const setupActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SET_PLAYER_COUNT"),
      playerCount: configSchema.shape.playerCount,
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_TARGET_SCORE"),
      targetScore: configSchema.shape.targetScore,
    })
    .strict(),
]);
const setupViewSchema = z
  .object({
    config: configSchema,
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
function readiness(state: SetupState, slots: readonly SetupSlot[]) {
  const occupied = slots.filter((s) => s.occupied);
  return {
    canFinalize:
      occupied.length === state.config.playerCount &&
      occupied.every((s) => s.online),
    participantSlotIds: occupied
      .slice(0, state.config.playerCount)
      .map((s) => s.slotId),
  };
}
export const ninjaClashSetupDefinition = {
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
    if (!slots.some((s) => s.occupied && s.slotId === actorSlotId))
      return { status: "rejected", code: "NOT_PARTICIPANT" };
    if (!isOwner || !slots.some((s) => s.slotId === actorSlotId && s.isOwner))
      return { status: "rejected", code: "NOT_OWNER" };
    const config = {
      ...state.config,
      ...(action.type === "SET_PLAYER_COUNT"
        ? { playerCount: action.playerCount }
        : { targetScore: action.targetScore }),
    };
    if (
      config.playerCount === state.config.playerCount &&
      config.targetScore === state.config.targetScore
    )
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    return { status: "accepted", state: { config } };
  },
  projectView({ state, slots, viewer }) {
    const selfSlotId = viewer.kind === "player" ? viewer.slotId : null;
    return {
      config: { ...state.config },
      players: slots
        .filter((s) => s.occupied)
        .map((s, index) => ({ slotId: s.slotId, index })),
      participantSlotIds: readiness(state, slots).participantSlotIds,
      canEdit: slots.some(
        (s) => s.slotId === selfSlotId && s.occupied && s.isOwner,
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
} satisfies RoundSetupDefinition<
  Config,
  SetupState,
  z.infer<typeof setupActionSchema>,
  z.infer<typeof setupViewSchema>
>;
