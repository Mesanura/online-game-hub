import { z } from "zod";
import {
  playViewSchema as legacyPlayViewSchema,
  playIntentSchema as legacyPlayIntentSchema,
} from "./legacy-contracts";

const integer = z.number().int();
const slot = z.string().min(1).max(128);
const side = z.enum(["LEFT", "RIGHT"]);
const targetScore = z.union([z.literal(7), z.literal(11), z.literal(21)]);
const shot = z.enum(["NONE", "CLEAR", "DROP", "SMASH"]);
const scores = z.tuple([integer.min(0).max(30), integer.min(0).max(30)]);
const starter = z.enum(["OWNER", "NON_OWNER", "RANDOM", "FIXED"]);
const config = z.object({ targetScore }).strict();

export const setupViewSchema = z
  .object({
    config,
    starter,
    fixedStarterSlotId: slot.nullable(),
    participantSlotIds: z.array(slot).max(2),
    canEdit: z.boolean(),
  })
  .strict()
  .superRefine((view, context) => {
    if (
      (view.starter === "FIXED") !== (view.fixedStarterSlotId !== null) ||
      new Set(view.participantSlotIds).size !== view.participantSlotIds.length
    ) {
      context.addIssue({ code: "custom", message: "Invalid setup order." });
    }
  });

const athlete = z
  .object({
    x: integer.min(30_000).max(970_000),
    y: integer.min(250_000).max(500_000),
    moving: z.boolean(),
    swingTicks: integer.min(0).max(18),
    swingShot: shot,
    swingKind: z.enum(["OVERHEAD", "UNDERHAND", "SERVE"]).nullable(),
    swingStartedTick: integer.nonnegative().nullable(),
    lastContact: z
      .object({
        tick: integer.nonnegative(),
        x: integer,
        y: integer,
        shot: z.enum(["CLEAR", "DROP", "SMASH"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
const outcome = z.discriminatedUnion("reason", [
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("SCORE"),
      winnerSlotId: slot,
      scores,
    })
    .strict(),
  z
    .object({
      type: z.literal("WIN"),
      reason: z.literal("RESIGNATION"),
      winnerSlotId: slot,
      resignedSlotId: slot,
      scores,
    })
    .strict(),
]);

export const playViewSchema = z
  .object({
    court: z
      .object({
        width: z.literal(1_000_000),
        height: z.literal(600_000),
        ground: z.literal(500_000),
        leftLine: z.literal(80_000),
        rightLine: z.literal(920_000),
        netX: z.literal(500_000),
        netTop: z.union([z.literal(340_000), z.literal(370_000)]),
        netWidth: z.literal(6_000),
        shuttleRadius: z.literal(6_000),
        leftServeLine: z.literal(360_000),
        rightServeLine: z.literal(640_000),
        frontFootOffset: z.literal(20_000),
      })
      .strict(),
    players: z.tuple([
      z.object({ slotId: slot, side: z.literal("LEFT") }).strict(),
      z.object({ slotId: slot, side: z.literal("RIGHT") }).strict(),
    ]),
    athletes: z.tuple([athlete, athlete]),
    shuttle: z.object({ x: integer, y: integer }).strict(),
    scores,
    targetScore,
    scoreCap: z.union([z.literal(11), z.literal(15), z.literal(30)]),
    tick: integer.nonnegative(),
    phase: z.enum(["SERVE", "SERVING", "RALLY", "POINT", "FINISHED"]),
    phaseTicks: integer.min(0).max(90),
    servingSide: side,
    yourSide: side.nullable(),
    rally: integer.positive(),
    rallyHits: integer.nonnegative(),
    bestRally: integer.nonnegative(),
    lastPoint: z
      .object({
        winner: z.union([z.literal(0), z.literal(1)]),
        reason: z.enum(["GROUND", "OUT", "NET"]),
        x: integer,
        y: integer,
      })
      .strict()
      .nullable(),
    outcome: outcome.nullable(),
  })
  .strict()
  .superRefine((view, context) => {
    if (
      view.players[0].slotId === view.players[1].slotId ||
      view.athletes[0].x > 465_000 ||
      view.athletes[1].x < 535_000 ||
      view.scoreCap !==
        (view.targetScore === 7 ? 11 : view.targetScore === 11 ? 15 : 30)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid court or players.",
      });
    }
    if ((view.phase === "FINISHED") !== (view.outcome !== null)) {
      context.addIssue({
        code: "custom",
        message: "Outcome must match the displayed phase.",
      });
    }
    if (
      view.outcome !== null &&
      (!view.players.some(
        (player) => player.slotId === view.outcome?.winnerSlotId,
      ) ||
        view.outcome.scores.some(
          (score, index) => score !== view.scores[index],
        ))
    ) {
      context.addIssue({ code: "custom", message: "Invalid result summary." });
    }
  });

export const setupIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("SELECT_STARTER"),
      starter: z.enum(["OWNER", "NON_OWNER", "RANDOM"]),
    })
    .strict(),
  z.object({ type: z.literal("SET_TARGET_SCORE"), targetScore }).strict(),
]);
export const playIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("CONTROL"),
      move: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
      jump: z.boolean(),
      serve: z.boolean(),
      shot,
    })
    .strict(),
  z.object({ type: z.literal("RESIGN") }).strict(),
]);

export type PlayView = z.infer<typeof playViewSchema>;
export type SetupView = z.infer<typeof setupViewSchema>;
export type SetupIntent = z.infer<typeof setupIntentSchema>;
export type PlayIntent = z.infer<typeof playIntentSchema>;
export type ControlIntent = Extract<PlayIntent, { type: "CONTROL" }>;

export function parsePlayView(input: unknown, gameVersion: string): PlayView {
  if (gameVersion === "1.1.0" || gameVersion === "1.2.0") {
    const view = playViewSchema.parse(input);
    if (view.court.netTop !== (gameVersion === "1.2.0" ? 370_000 : 340_000))
      throw new Error("Badminton court does not match the exact version.");
    return view;
  }
  if (gameVersion !== "1.0.0")
    throw new Error("Unsupported badminton version.");
  const legacy = legacyPlayViewSchema.parse(input);
  return {
    ...legacy,
    court: {
      ...legacy.court,
      leftServeLine: 360_000,
      rightServeLine: 640_000,
      frontFootOffset: 20_000,
    },
    athletes: legacy.athletes.map((athlete) => ({
      ...athlete,
      swingKind: athlete.swingTicks > 0 ? "OVERHEAD" : null,
      swingStartedTick:
        athlete.swingTicks > 0 ? legacy.tick - (10 - athlete.swingTicks) : null,
      lastContact: null,
    })) as PlayView["athletes"],
  };
}

export function encodePlayIntent(
  input: PlayIntent,
  gameVersion: string,
): unknown {
  if (gameVersion === "1.1.0" || gameVersion === "1.2.0")
    return playIntentSchema.parse(input);
  if (gameVersion !== "1.0.0")
    throw new Error("Unsupported badminton version.");
  if (input.type === "RESIGN") return legacyPlayIntentSchema.parse(input);
  return legacyPlayIntentSchema.parse({
    type: input.type,
    move: input.move,
    jump: input.jump,
    shot: input.shot,
  });
}
