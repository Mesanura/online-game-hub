import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  REALTIME_RNG_ALGORITHM_V1,
  isRealtimeGameId,
  isRealtimeGameVersion,
} from "@online-game-hub/realtime-game-sdk";
import type {
  JsonValue,
  RealtimeCanonicalReplay,
  RealtimeDefinitionResolver,
  RealtimeReplayEvent,
  RealtimeReplayHeader,
} from "@online-game-hub/realtime-game-sdk";
import type { RealtimeReplayStore } from "@online-game-hub/realtime-game-server-runtime";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import { realtimeReplayEvents, realtimeReplays } from "./schema.js";

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  const prototype = Object.getPrototypeOf(value) as unknown;
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((entry) => isJsonValue(entry))
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function validReplayId(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

function validHeader(value: unknown): value is RealtimeReplayHeader {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (
    keys.join("|") !==
    [
      "gameId",
      "gameVersion",
      "initialConfig",
      "players",
      "replayFormatVersion",
      "rng",
      "runtime",
      "tickRate",
    ]
      .sort()
      .join("|")
  ) {
    return false;
  }
  if (
    value.replayFormatVersion !== 1 ||
    value.runtime !== "realtime" ||
    value.tickRate !== 60 ||
    typeof value.gameId !== "string" ||
    typeof value.gameVersion !== "string" ||
    !isRealtimeGameId(value.gameId) ||
    !isRealtimeGameVersion(value.gameVersion) ||
    !isJsonValue(value.initialConfig) ||
    !isRecord(value.rng) ||
    Object.keys(value.rng).sort().join("|") !== "algorithm|seed" ||
    value.rng.algorithm !== REALTIME_RNG_ALGORITHM_V1 ||
    typeof value.rng.seed !== "string" ||
    value.rng.seed.length === 0 ||
    value.rng.seed.length > 4096 ||
    !Array.isArray(value.players) ||
    value.players.length !== 2
  ) {
    return false;
  }
  const slots = value.players.map((player) => {
    if (
      !isRecord(player) ||
      Object.keys(player).length !== 1 ||
      typeof player.slotId !== "string" ||
      player.slotId.length === 0 ||
      player.slotId.length > 128
    ) {
      return null;
    }
    return player.slotId;
  });
  return (
    slots.every((slot): slot is string => slot !== null) &&
    new Set(slots).size === slots.length
  );
}

function validEvent(value: unknown): value is RealtimeReplayEvent {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).sort().join("|") === "actorSlotId|input|sequence|tick" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    Number.isSafeInteger(value.tick) &&
    (value.tick as number) >= 0 &&
    typeof value.actorSlotId === "string" &&
    value.actorSlotId.length > 0 &&
    isJsonValue(value.input)
  );
}

function headerEqual(
  left: RealtimeReplayHeader,
  right: RealtimeReplayHeader,
): boolean {
  return (
    left.replayFormatVersion === right.replayFormatVersion &&
    left.runtime === right.runtime &&
    left.gameId === right.gameId &&
    left.gameVersion === right.gameVersion &&
    left.tickRate === right.tickRate &&
    left.rng.algorithm === right.rng.algorithm &&
    left.rng.seed === right.rng.seed &&
    jsonEqual(left.initialConfig, right.initialConfig) &&
    left.players.length === right.players.length &&
    left.players.every(
      (player, index) => player.slotId === right.players[index]?.slotId,
    )
  );
}

function eventEqual(
  left: RealtimeReplayEvent,
  right: RealtimeReplayEvent,
): boolean {
  return (
    left.sequence === right.sequence &&
    left.tick === right.tick &&
    left.actorSlotId === right.actorSlotId &&
    jsonEqual(left.input, right.input)
  );
}

function rethrow(error: unknown): never {
  if (error instanceof DatabaseError) throw error;
  throw new DatabaseError("DATABASE_OPERATION_ERROR");
}

export interface PostgresRealtimeReplayStoreOptions {
  /** Optional exact resolver used to fail closed on unknown game versions. */
  readonly resolveDefinition?: RealtimeDefinitionResolver;
}

export class PostgresRealtimeReplayStore implements RealtimeReplayStore {
  readonly #resolveDefinition: RealtimeDefinitionResolver | undefined;

  public constructor(
    private readonly database: OnlineGameHubDatabase,
    options: PostgresRealtimeReplayStoreOptions = {},
  ) {
    this.#resolveDefinition = options.resolveDefinition;
  }

  public async create(
    replayId: string,
    header: RealtimeReplayHeader,
  ): Promise<void> {
    if (!validReplayId(replayId) || !validHeader(header)) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    if (this.#resolveDefinition !== undefined) {
      let definition: ReturnType<RealtimeDefinitionResolver>;
      try {
        definition = this.#resolveDefinition(header.gameId, header.gameVersion);
      } catch {
        definition = undefined;
      }
      if (
        definition === undefined ||
        definition.manifest.runtime !== "realtime" ||
        definition.manifest.id !== header.gameId ||
        definition.manifest.gameVersion !== header.gameVersion ||
        definition.manifest.tickRate !== 60
      ) {
        throw new DatabaseError("DATABASE_DATA_INVALID");
      }
      const parsed = definition.configSchema.safeParse(header.initialConfig);
      if (!parsed.success || !jsonEqual(parsed.data, header.initialConfig)) {
        throw new DatabaseError("DATABASE_DATA_INVALID");
      }
    }
    try {
      const inserted = await this.database
        .insert(realtimeReplays)
        .values({
          id: replayId,
          replayFormatVersion: 1,
          runtime: "realtime",
          gameId: header.gameId,
          gameVersion: header.gameVersion,
          tickRate: 60,
          rngAlgorithm: header.rng.algorithm,
          rngSeed: header.rng.seed,
          initialConfig:
            header.initialConfig === null
              ? sql`'null'::jsonb`
              : cloneJson(header.initialConfig),
          players: header.players.map((player) => ({ slotId: player.slotId })),
          finalTick: 0,
        })
        .onConflictDoNothing({ target: realtimeReplays.id })
        .returning({ id: realtimeReplays.id });
      if (inserted.length === 1) return;
      const rows = await this.database
        .select()
        .from(realtimeReplays)
        .where(eq(realtimeReplays.id, replayId))
        .limit(1);
      const row = rows[0];
      if (row === undefined)
        throw new DatabaseError("DATABASE_OPERATION_ERROR");
      const existing: RealtimeReplayHeader = {
        replayFormatVersion: row.replayFormatVersion as 1,
        runtime: row.runtime as "realtime",
        gameId: row.gameId,
        gameVersion: row.gameVersion,
        tickRate: row.tickRate as 60,
        rng: { algorithm: row.rngAlgorithm, seed: row.rngSeed },
        initialConfig: row.initialConfig as JsonValue,
        players: (row.players as Array<{ readonly slotId: string }>).map(
          (player) => ({ slotId: player.slotId }),
        ),
      };
      if (!validHeader(existing))
        throw new DatabaseError("DATABASE_DATA_INVALID");
      if (!headerEqual(existing, header)) {
        throw new DatabaseError("DATABASE_OPERATION_ERROR");
      }
    } catch (error) {
      rethrow(error);
    }
  }

  public async append(
    replayId: string,
    expectedSequence: number,
    event: RealtimeReplayEvent,
  ): Promise<void> {
    if (
      !validReplayId(replayId) ||
      !Number.isSafeInteger(expectedSequence) ||
      expectedSequence < 0 ||
      !validEvent(event)
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const replayRows = await transaction
          .select()
          .from(realtimeReplays)
          .where(eq(realtimeReplays.id, replayId))
          .for("update")
          .limit(1);
        const replay = replayRows[0];
        if (replay === undefined)
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        if (this.#resolveDefinition !== undefined) {
          let definition: ReturnType<RealtimeDefinitionResolver>;
          try {
            definition = this.#resolveDefinition(
              replay.gameId,
              replay.gameVersion,
            );
          } catch {
            definition = undefined;
          }
          if (
            definition === undefined ||
            definition.manifest.runtime !== "realtime" ||
            definition.manifest.id !== replay.gameId ||
            definition.manifest.gameVersion !== replay.gameVersion ||
            definition.manifest.tickRate !== 60
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          const parsedInput = definition.inputSchema.safeParse(event.input);
          if (
            !parsedInput.success ||
            !jsonEqual(parsedInput.data, event.input)
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
        }
        if (replay.completedAt !== null) {
          const existingRows = await transaction
            .select()
            .from(realtimeReplayEvents)
            .where(
              and(
                eq(realtimeReplayEvents.replayId, replayId),
                eq(realtimeReplayEvents.sequence, event.sequence),
              ),
            )
            .limit(1);
          const existing = existingRows[0];
          if (
            existing !== undefined &&
            eventEqual(
              {
                sequence: existing.sequence,
                tick: existing.tick,
                actorSlotId: existing.actorSlotId,
                input: existing.input as JsonValue,
              },
              event,
            )
          ) {
            return;
          }
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        const existingRows = await transaction
          .select()
          .from(realtimeReplayEvents)
          .where(
            and(
              eq(realtimeReplayEvents.replayId, replayId),
              eq(realtimeReplayEvents.sequence, event.sequence),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing !== undefined) {
          if (
            expectedSequence === event.sequence - 1 &&
            eventEqual(
              {
                sequence: existing.sequence,
                tick: existing.tick,
                actorSlotId: existing.actorSlotId,
                input: existing.input as JsonValue,
              },
              event,
            )
          ) {
            return;
          }
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        const lastRows = await transaction
          .select({
            sequence: realtimeReplayEvents.sequence,
            tick: realtimeReplayEvents.tick,
          })
          .from(realtimeReplayEvents)
          .where(eq(realtimeReplayEvents.replayId, replayId))
          .orderBy(desc(realtimeReplayEvents.sequence))
          .limit(1);
        const last = lastRows[0];
        const currentSequence = last?.sequence ?? 0;
        if (
          currentSequence !== expectedSequence ||
          event.sequence !== expectedSequence + 1 ||
          (last !== undefined && event.tick < last.tick)
        ) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        const players = replay.players as Array<{ readonly slotId?: unknown }>;
        if (
          !Array.isArray(players) ||
          !players.some((player) => player.slotId === event.actorSlotId)
        ) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }
        await transaction.insert(realtimeReplayEvents).values({
          replayId,
          sequence: event.sequence,
          tick: event.tick,
          actorSlotId: event.actorSlotId,
          input: cloneJson(event.input),
        });
      });
    } catch (error) {
      rethrow(error);
    }
  }

  public async complete(
    replayId: string,
    expectedSequence: number,
    finalTick: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void> {
    if (
      !validReplayId(replayId) ||
      !Number.isSafeInteger(expectedSequence) ||
      expectedSequence < 0 ||
      !Number.isSafeInteger(finalTick) ||
      finalTick <= 0 ||
      !Number.isSafeInteger(finalRngCursor) ||
      finalRngCursor < 0 ||
      outcome === null ||
      !isJsonValue(outcome)
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(realtimeReplays)
          .where(eq(realtimeReplays.id, replayId))
          .for("update")
          .limit(1);
        const replay = rows[0];
        if (replay === undefined)
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        const lastRows = await transaction
          .select({
            sequence: realtimeReplayEvents.sequence,
            tick: realtimeReplayEvents.tick,
          })
          .from(realtimeReplayEvents)
          .where(eq(realtimeReplayEvents.replayId, replayId))
          .orderBy(desc(realtimeReplayEvents.sequence))
          .limit(1);
        const currentSequence = lastRows[0]?.sequence ?? 0;
        if (currentSequence !== expectedSequence) {
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        if (replay.completedAt !== null) {
          if (
            replay.finalTick === finalTick &&
            replay.recordedRngCursor === finalRngCursor &&
            jsonEqual(replay.recordedOutcome, outcome)
          ) {
            return;
          }
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
        if (lastRows[0] !== undefined && lastRows[0].tick >= finalTick) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }
        await transaction
          .update(realtimeReplays)
          .set({
            finalTick,
            recordedRngCursor: finalRngCursor,
            recordedOutcome: cloneJson(outcome),
            completedAt: new Date(),
          })
          .where(eq(realtimeReplays.id, replayId));
      });
    } catch (error) {
      rethrow(error);
    }
  }

  public async get(replayId: string): Promise<RealtimeCanonicalReplay | null> {
    if (!validReplayId(replayId)) return null;
    try {
      return await this.database.transaction(
        async (transaction) => {
          const rows = await transaction
            .select()
            .from(realtimeReplays)
            .where(eq(realtimeReplays.id, replayId))
            .limit(1);
          const replay = rows[0];
          if (replay === undefined) return null;
          const players = replay.players;
          const header: RealtimeReplayHeader = {
            replayFormatVersion: replay.replayFormatVersion as 1,
            runtime: replay.runtime as "realtime",
            gameId: replay.gameId,
            gameVersion: replay.gameVersion,
            tickRate: replay.tickRate as 60,
            rng: { algorithm: replay.rngAlgorithm, seed: replay.rngSeed },
            initialConfig: replay.initialConfig as JsonValue,
            players: Array.isArray(players)
              ? players.map((player) => ({
                  slotId: (player as { readonly slotId: string }).slotId,
                }))
              : [],
          };
          if (!validHeader(header))
            throw new DatabaseError("DATABASE_DATA_INVALID");
          const eventRows = await transaction
            .select()
            .from(realtimeReplayEvents)
            .where(eq(realtimeReplayEvents.replayId, replayId))
            .orderBy(asc(realtimeReplayEvents.sequence));
          const events: RealtimeReplayEvent[] = eventRows.map((event) => ({
            sequence: event.sequence,
            tick: event.tick,
            actorSlotId: event.actorSlotId,
            input: event.input as JsonValue,
          }));
          if (
            events.some(
              (event, index) =>
                !validEvent(event) ||
                event.sequence !== index + 1 ||
                event.actorSlotId.length > 128 ||
                !(
                  header.players as readonly { readonly slotId: string }[]
                ).some((player) => player.slotId === event.actorSlotId) ||
                (replay.finalTick > 0 && event.tick >= replay.finalTick) ||
                (index > 0 &&
                  event.tick < (events[index - 1]?.tick ?? event.tick)),
            ) ||
            !Number.isSafeInteger(replay.finalTick) ||
            replay.finalTick < 0 ||
            (replay.completedAt !== null && replay.finalTick <= 0) ||
            (replay.completedAt === null &&
              (replay.recordedRngCursor !== null ||
                replay.recordedOutcome !== null)) ||
            (replay.completedAt !== null &&
              (replay.recordedRngCursor === null ||
                replay.recordedOutcome === null ||
                !isJsonValue(replay.recordedOutcome)))
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          return {
            header,
            events,
            recordedRngCursor: replay.recordedRngCursor,
            recordedOutcome:
              replay.recordedOutcome === null
                ? null
                : (replay.recordedOutcome as JsonValue),
            finalTick: replay.finalTick,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      rethrow(error);
    }
  }
}
