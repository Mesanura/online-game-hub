import { z } from "zod";
import { playViewSchema as legacyPlayViewSchema } from "./legacy-contracts";
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
    reason: z.enum(["SURVIVOR", "ALL_ELIMINATED", "TIMEOUT", "RESIGNATION"]),
    standings: z
      .array(
        z
          .object({
            slotId: slot,
            lives: integer.min(0).max(3),
            resigned: z.boolean(),
          })
          .strict(),
      )
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
function createLivesPlayViewSchema(version: "1.1.0" | "1.2.0") {
  return z
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
      phase: z.enum(["PREPARE", "ACTIVE", "COMPLETE"]),
      phaseTicks: integer.min(0).max(180),
      remainingTicks: integer.min(0).max(10800),
      startingLives: z.literal(3),
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
              lives: integer.min(0).max(3),
              invulnerableTicks: integer.min(0).max(120),
              capacity: integer.min(version === "1.2.0" ? 2 : 1).max(5),
              activeBombs: integer.min(0).max(5),
              range: integer.min(version === "1.2.0" ? 1 : 2).max(8),
              speed: z.number().min(4).max(5),
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
              shape: z.enum([
                "center",
                "horizontal",
                "vertical",
                "intersection",
              ]),
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
              kind: z.enum(["place", "explode", "pickup", "hit", "eliminate"]),
              x: integer.nonnegative(),
              y: integer.nonnegative(),
            })
            .strict(),
        )
        .max(128),
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
            (version === "1.1.0" && player.activeBombs > player.capacity) ||
            player.alive !== player.lives > 0 ||
            (player.resigned && player.lives !== 0) ||
            (!player.alive && player.invulnerableTicks !== 0),
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
        view.outcome &&
        (view.outcome.standings.length !== ids.length ||
          new Set(view.outcome.standings.map((entry) => entry.slotId)).size !==
            ids.length ||
          view.outcome.standings.some((entry) => {
            const player = view.players.find(
              (player) => player.slotId === entry.slotId,
            );
            return (
              !player ||
              player.lives !== entry.lives ||
              player.resigned !== entry.resigned
            );
          }) ||
          (view.outcome.type === "DRAW"
            ? view.outcome.winnerSlotId !== null
            : view.outcome.winnerSlotId === null ||
              !ids.includes(view.outcome.winnerSlotId)))
      )
        invalid();
      if (view.outcome) {
        const survivors = view.players.filter((player) => player.alive);
        if (
          view.outcome.type === "WIN"
            ? survivors.length !== 1 ||
              survivors[0]?.slotId !== view.outcome.winnerSlotId ||
              !["SURVIVOR", "RESIGNATION"].includes(view.outcome.reason)
            : view.outcome.reason === "TIMEOUT"
              ? survivors.length < 2
              : !["ALL_ELIMINATED", "RESIGNATION"].includes(
                  view.outcome.reason,
                ) || survivors.length !== 0
        )
          invalid();
      }
    });
}
export const playViewSchema = createLivesPlayViewSchema("1.2.0");
const previousLivesPlayViewSchema = createLivesPlayViewSchema("1.1.0");
export type LivesPlayView = z.infer<typeof playViewSchema>;
export type LegacyPlayView = z.infer<typeof legacyPlayViewSchema>;
export type PlayView = LivesPlayView | LegacyPlayView;
export type PlayIntent = z.infer<typeof playIntentSchema>;
export type SetupView = z.infer<typeof setupViewSchema>;
export type SetupIntent = z.infer<typeof setupIntentSchema>;
export type Direction = z.infer<typeof direction>;
export type Effect = PlayView["events"][number];
export function parsePlayView(
  payload: unknown,
  version: "1.0.0",
): LegacyPlayView;
export function parsePlayView(
  payload: unknown,
  version: "1.1.0" | "1.2.0",
): LivesPlayView;
export function parsePlayView(payload: unknown, version: string): PlayView;
export function parsePlayView(payload: unknown, version: string): PlayView {
  if (version === "1.0.0") return legacyPlayViewSchema.parse(payload);
  if (version === "1.1.0") return previousLivesPlayViewSchema.parse(payload);
  if (version !== "1.2.0") throw new Error("Unsupported Bomberman version.");
  return playViewSchema.parse(payload);
}
