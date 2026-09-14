import { z } from "zod";
const integer = z.number().int().safe();
const slot = z.string().min(1).max(128);
const config = z
  .object({
    mapId: z.literal("classic-arena"),
    modeId: z.literal("classic"),
    playerCount: integer.min(2).max(4),
  })
  .strict();
const direction = z.enum(["up", "right", "down", "left", "none"]);
const pickup = z
  .object({
    cell: integer.nonnegative(),
    kind: z.enum(["capacity", "range", "speed"]),
  })
  .strict();
const outcome = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: slot.nullable(),
    reason: z.enum(["SCORE", "RESIGNATION"]),
    scores: z
      .array(z.object({ slotId: slot, score: integer.min(0).max(3) }).strict())
      .min(2)
      .max(4),
  })
  .strict();
export const playIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MOVE"), direction }).strict(),
  z.object({ type: z.literal("PLACE_BOMB") }).strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);
export const setupIntentSchema = z
  .object({
    type: z.literal("SET_PLAYER_COUNT"),
    playerCount: integer.min(2).max(4),
  })
  .strict();
export const setupViewSchema = z
  .object({
    config,
    playerCounts: z.array(integer.min(2).max(4)).min(1).max(3),
    players: z
      .array(z.object({ slotId: slot, index: integer.nonnegative() }).strict())
      .max(4),
    participantSlotIds: z.array(slot).max(4),
    canEdit: z.boolean(),
    selfSlotId: slot.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if (
      new Set(view.players.map((player) => player.slotId)).size !==
        view.players.length ||
      new Set(view.playerCounts).size !== view.playerCounts.length ||
      view.participantSlotIds.some(
        (id) => !view.players.some((player) => player.slotId === id),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid setup participants.",
      });
  });
export const playViewSchema = z
  .object({
    selfSlotId: slot,
    config,
    arena: z
      .object({
        cols: integer.min(5).max(64),
        rows: integer.min(5).max(64),
        cellSize: integer.positive(),
        tiles: z.array(z.enum(["floor", "wall", "brick"])).max(4096),
      })
      .strict(),
    phase: z.enum(["PREPARE", "ACTIVE", "RESULT", "COMPLETE"]),
    phaseTicks: integer.min(0).max(180),
    bout: integer.positive(),
    remainingTicks: integer.min(0).max(10800),
    targetWins: z.literal(3),
    players: z
      .array(
        z
          .object({
            slotId: slot,
            index: integer.nonnegative(),
            x: integer.nonnegative(),
            y: integer.nonnegative(),
            alive: z.boolean(),
            resigned: z.boolean(),
            score: integer.min(0).max(3),
            capacity: integer.min(1).max(5),
            activeBombs: integer.min(0).max(5),
            range: integer.min(2).max(8),
            speed: z.number().min(3).max(5),
            facing: z.enum(["up", "right", "down", "left"]),
            walking: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    bombs: z
      .array(
        z
          .object({
            id: integer.positive(),
            cell: integer.nonnegative(),
            ownerSlotId: slot,
            fuseTicks: integer.min(0).max(150),
          })
          .strict(),
      )
      .max(20),
    flames: z
      .array(
        z
          .object({
            cell: integer.nonnegative(),
            remainingTicks: integer.min(0).max(30),
          })
          .strict(),
      )
      .max(4096),
    pickups: z.array(pickup).max(4096),
    events: z
      .array(
        z
          .object({
            id: integer.positive(),
            kind: z.enum(["place", "explode", "pickup", "eliminate"]),
            x: integer.nonnegative(),
            y: integer.nonnegative(),
          })
          .strict(),
      )
      .max(128),
    roundResult: z
      .object({
        winnerSlotId: slot.nullable(),
        reason: z.enum(["SURVIVOR", "ALL_ELIMINATED", "TIMEOUT"]),
      })
      .strict()
      .nullable(),
    outcome: outcome.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    const ids = view.players.map((player) => player.slotId);
    const cells = view.arena.cols * view.arena.rows;
    const invalid = () =>
      context.addIssue({
        code: "custom",
        message: "Inconsistent arena projection.",
      });
    if (
      view.arena.tiles.length !== cells ||
      ids.length !== view.config.playerCount ||
      new Set(ids).size !== ids.length ||
      !ids.includes(view.selfSlotId) ||
      new Set(view.players.map((player) => player.index)).size !== ids.length
    )
      invalid();
    if (
      view.players.some(
        (player) =>
          player.x >= view.arena.cols * view.arena.cellSize ||
          player.y >= view.arena.rows * view.arena.cellSize ||
          player.activeBombs > player.capacity ||
          (player.resigned && player.alive),
      )
    )
      invalid();
    for (const entries of [view.bombs, view.flames, view.pickups])
      if (
        entries.some((entry) => entry.cell >= cells) ||
        new Set(entries.map((entry) => entry.cell)).size !== entries.length
      )
        invalid();
    if (
      new Set(view.bombs.map((bomb) => bomb.id)).size !== view.bombs.length ||
      view.bombs.some((bomb) => !ids.includes(bomb.ownerSlotId))
    )
      invalid();
    if (
      (view.phase === "COMPLETE") !== (view.outcome !== null) ||
      view.events.some(
        (event, index) =>
          index > 0 && event.id <= (view.events[index - 1]?.id ?? 0),
      )
    )
      invalid();
    if (
      view.roundResult?.winnerSlotId &&
      !ids.includes(view.roundResult.winnerSlotId)
    )
      invalid();
    if (
      view.outcome &&
      (view.outcome.scores.length !== ids.length ||
        new Set(view.outcome.scores.map((score) => score.slotId)).size !==
          ids.length ||
        view.outcome.scores.some((score) => !ids.includes(score.slotId)) ||
        (view.outcome.type === "DRAW"
          ? view.outcome.winnerSlotId !== null
          : view.outcome.winnerSlotId === null ||
            !ids.includes(view.outcome.winnerSlotId)))
    )
      invalid();
  });
export type PlayView = z.infer<typeof playViewSchema>;
export type PlayIntent = z.infer<typeof playIntentSchema>;
export type SetupView = z.infer<typeof setupViewSchema>;
export type SetupIntent = z.infer<typeof setupIntentSchema>;
export type Direction = z.infer<typeof direction>;
export type Effect = PlayView["events"][number];
export function parsePlayView(payload: unknown, version: string): PlayView {
  if (version !== "1.0.0") throw new Error("Unsupported Bomberman version.");
  return playViewSchema.parse(payload);
}
