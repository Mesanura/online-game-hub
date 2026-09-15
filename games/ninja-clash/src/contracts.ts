import { z } from "zod";
export const configSchema = z
  .object({
    playerCount: z.number().int().min(2).max(4),
    targetScore: z.union([
      z.literal(3),
      z.literal(5),
      z.literal(7),
      z.literal(10),
    ]),
  })
  .strict();
export const inputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("MOVE"),
      direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .strict(),
  ...(["JUMP", "ATTACK", "SLIDE", "RESIGN"] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
]);
export const outcomeSchema = z
  .object({
    type: z.enum(["WIN", "DRAW"]),
    winnerSlotId: z.string().nullable(),
    reason: z.enum(["TARGET_SCORE", "RESIGNATION"]),
    standings: z
      .array(
        z
          .object({
            slotId: z.string(),
            score: z.number().int().nonnegative(),
            resigned: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()
  .refine(
    (o) =>
      new Set(o.standings.map((p) => p.slotId)).size === o.standings.length &&
      (o.type === "DRAW"
        ? o.winnerSlotId === null
        : o.standings.some((p) => p.slotId === o.winnerSlotId && !p.resigned)),
  );
export type Config = z.infer<typeof configSchema>;
export type Input = z.infer<typeof inputSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type Rect = { x: number; y: number; w: number; h: number };
export type Fighter = {
  slotId: string;
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravityRemainder: number;
  facing: -1 | 1;
  grounded: boolean;
  wall: -1 | 0 | 1;
  alive: boolean;
  resigned: boolean;
  score: number;
  move: -1 | 0 | 1;
  leaseUntil: number;
  coyoteUntil: number;
  jumpUntil: number;
  wallLockUntil: number;
  attackStart: number;
  attackFacing: -1 | 1;
  attackReady: number;
  slideUntil: number;
  slideReady: number;
  slideFacing: -1 | 1;
};
export type Effect = {
  id: number;
  kind: "ATTACK" | "CLASH" | "DEATH" | "SLIDE";
  x: number;
  y: number;
  until: number;
};
export type State = {
  config: Config;
  tick: number;
  round: number;
  phase: "COUNTDOWN" | "ACTIVE" | "FINISHED";
  countdown: number;
  players: Fighter[];
  effects: Effect[];
  nextEffect: number;
  lastWinner: string | null;
  outcome: Outcome | null;
};
