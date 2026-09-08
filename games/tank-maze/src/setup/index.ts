import { z } from "zod";
import type {
  RoundSetupDefinition,
  SetupSlot,
} from "@online-game-hub/game-setup";
import { configSchema, type Config } from "../core/schemas.js";
export const setupStateSchema = z
  .object({
    config: configSchema,
    colors: z.record(z.string(), z.number().int().min(0).max(7)),
  })
  .strict();
export const setupActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SET_PLAYER_COUNT"),
      playerCount: z.number().int().min(2).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_TARGET_SCORE"),
      targetScore: configSchema.shape.targetScore,
    })
    .strict(),
  z
    .object({
      type: z.literal("SELECT_COLOR"),
      color: z.number().int().min(0).max(7),
    })
    .strict(),
]);
export const setupViewSchema = z
  .object({
    config: configSchema,
    colors: z.record(z.string(), z.number().int().min(0).max(7)),
    players: z
      .array(
        z
          .object({ slotId: z.string(), color: z.number().int().min(0).max(7) })
          .strict(),
      )
      .max(8),
    participantSlotIds: z.array(z.string()).max(8),
    canEdit: z.boolean(),
    selfSlotId: z.string().nullable(),
  })
  .strict();
type SetupState = z.infer<typeof setupStateSchema>;
type SetupAction = z.infer<typeof setupActionSchema>;
type SetupView = z.infer<typeof setupViewSchema>;
function selected(state: SetupState, slots: readonly SetupSlot[]) {
  return slots.filter((s) => s.occupied).slice(0, state.config.playerCount);
}
function colors(
  state: SetupState,
  slots: readonly SetupSlot[],
): Record<string, number> {
  const chosen: Record<string, number> = {},
    used = new Set<number>();
  for (const slot of slots.filter((s) => s.occupied)) {
    const color = state.colors[slot.slotId];
    if (color !== undefined && !used.has(color)) {
      chosen[slot.slotId] = color;
      used.add(color);
    }
  }
  for (const slot of slots.filter((s) => s.occupied))
    if (chosen[slot.slotId] === undefined) {
      const color = Array.from({ length: 8 }, (_, i) => i).find(
        (c) => !used.has(c),
      );
      if (color !== undefined) {
        chosen[slot.slotId] = color;
        used.add(color);
      }
    }
  return chosen;
}
function readiness(state: SetupState, slots: readonly SetupSlot[]) {
  const participants = selected(state, slots);
  return {
    canFinalize:
      participants.length === state.config.playerCount &&
      slots.filter((s) => s.occupied).length === participants.length,
    participantSlotIds: participants.map((s) => s.slotId),
  };
}
export const tankMazeSetupDefinition = {
  setupStateSchema,
  setupActionSchema,
  setupViewSchema,
  initialize({ source }) {
    const config = configSchema.parse(
      source.kind === "defaults" ? source.config : source.setup.config,
    );
    return {
      config,
      colors:
        source.kind === "previous-round"
          ? Object.fromEntries(
              source.setup.playerOrder.map((slot, i) => [
                slot,
                config.colors[i] ?? i,
              ]),
            )
          : {},
    };
  },
  transition({ state, action, actorSlotId, isOwner, slots }) {
    if (!slots.some((s) => s.slotId === actorSlotId && s.occupied))
      return { status: "rejected", code: "NOT_PARTICIPANT" };
    const resolved = colors(state, slots);
    if (action.type === "SELECT_COLOR") {
      if (resolved[actorSlotId] === action.color)
        return { status: "rejected", code: "SETUP_UNCHANGED" };
      if (
        Object.entries(resolved).some(
          ([slot, c]) => slot !== actorSlotId && c === action.color,
        )
      )
        return { status: "rejected", code: "COLOR_TAKEN" };
      return {
        status: "accepted",
        state: {
          config: { ...state.config, colors: [] },
          colors: { ...resolved, [actorSlotId]: action.color },
        },
      };
    }
    if (!isOwner) return { status: "rejected", code: "NOT_OWNER" };
    const config = {
      ...state.config,
      colors: [],
      ...(action.type === "SET_PLAYER_COUNT"
        ? { playerCount: action.playerCount }
        : { targetScore: action.targetScore }),
    };
    if (
      config.playerCount === state.config.playerCount &&
      config.targetScore === state.config.targetScore
    )
      return { status: "rejected", code: "SETUP_UNCHANGED" };
    return { status: "accepted", state: { config, colors: resolved } };
  },
  projectView({ state, slots, viewer }) {
    const selfSlotId = viewer.kind === "player" ? viewer.slotId : null,
      resolved = colors(state, slots);
    return {
      config: { ...state.config, colors: [] },
      colors: resolved,
      players: slots
        .filter((s) => s.occupied)
        .map((s) => ({
          slotId: s.slotId,
          color: required(resolved[s.slotId]),
        })),
      participantSlotIds: selected(state, slots).map((s) => s.slotId),
      canEdit: slots.some((s) => s.slotId === selfSlotId && s.isOwner),
      selfSlotId,
    };
  },
  getReadiness: readiness,
  finalize({ state, slots, rng }) {
    const ready = readiness(state, slots);
    if (!ready.canFinalize)
      return { status: "rejected", code: "PLAYERS_NOT_READY" };
    const order = ready.participantSlotIds,
      resolved = colors(state, slots);
    return {
      status: "finalized",
      setup: {
        config: {
          ...state.config,
          colors: order.map((id) => required(resolved[id])),
        },
        participantSlotIds: order,
        playerOrder: order,
        assignments: order.map((slotId) => ({
          slotId,
          assignment: String(resolved[slotId]),
        })),
      },
      rng: { ...rng },
    };
  },
} satisfies RoundSetupDefinition<Config, SetupState, SetupAction, SetupView>;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
