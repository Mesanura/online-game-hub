import {
  and,
  asc,
  desc,
  eq,
  sql,
} from "drizzle-orm";

import { isJsonValue } from "@online-game-hub/game-sdk";
import {
  ReplayStoreError,
} from "@online-game-hub/game-server-runtime";
import type {
  CanonicalReplay,
  ReplayAction,
  ReplayHeader,
  ReplayStore,
} from "@online-game-hub/game-server-runtime";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import {
  matches,
  replayActions,
  replays,
} from "./schema.js";
import {
  cloneJson,
  jsonEqual,
  parseReplayPlayers,
  replayActionsEqual,
  replayHeadersEqual,
  validReplayAction,
  validReplayHeader,
} from "./validation.js";

function safeReplayId(replayId: string): boolean {
  return replayId.length > 0 && replayId.length <= 128;
}

function storedHeader(
  row: typeof replays.$inferSelect,
): ReplayHeader | null {
  const players = parseReplayPlayers(row.players);
  if (!isJsonValue(row.initialConfig) || players === null) return null;
  const header: ReplayHeader = {
    replayFormatVersion: row.replayFormatVersion as 1,
    gameId: row.gameId,
    gameVersion: row.gameVersion,
    rng: { algorithm: row.rngAlgorithm, seed: row.rngSeed },
    initialConfig: cloneJson(row.initialConfig),
    players,
  };
  return validReplayHeader(header) ? header : null;
}

function storedAction(
  row: Pick<
    typeof replayActions.$inferSelect,
    "sequence" | "actorSlotId" | "action"
  >,
): ReplayAction | null {
  if (!isJsonValue(row.action)) return null;
  const action: ReplayAction = {
    sequence: row.sequence,
    actorSlotId: row.actorSlotId,
    action: cloneJson(row.action),
  };
  return validReplayAction(action) ? action : null;
}

function rethrowSafe(error: unknown): never {
  if (error instanceof ReplayStoreError || error instanceof DatabaseError) {
    throw error;
  }
  throw new DatabaseError("DATABASE_OPERATION_ERROR");
}

export class PostgresReplayStore implements ReplayStore {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async create(
    replayId: string,
    header: ReplayHeader,
  ): Promise<void> {
    if (!safeReplayId(replayId)) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ID",
        "Replay id must contain between 1 and 128 characters.",
      );
    }
    if (!validReplayHeader(header)) {
      throw new ReplayStoreError("INVALID_HEADER", "Replay header is invalid.");
    }
    try {
      const inserted = await this.database
        .insert(replays)
        .values({
          id: replayId,
          replayFormatVersion: header.replayFormatVersion,
          gameId: header.gameId,
          gameVersion: header.gameVersion,
          rngAlgorithm: header.rng.algorithm,
          rngSeed: header.rng.seed,
          initialConfig:
            header.initialConfig === null
              ? sql`'null'::jsonb`
              : cloneJson(header.initialConfig),
          players: header.players.map((player) => ({ ...player })),
        })
        .onConflictDoNothing({ target: replays.id })
        .returning({ id: replays.id });
      if (inserted.length === 1) return;

      const existingRows = await this.database
        .select()
        .from(replays)
        .where(eq(replays.id, replayId))
        .limit(1);
      const existing = existingRows[0];
      const existingHeader =
        existing === undefined ? null : storedHeader(existing);
      if (
        existingHeader !== null &&
        replayHeadersEqual(existingHeader, header)
      ) {
        return;
      }
      if (existing !== undefined && existingHeader === null) {
        throw new DatabaseError("DATABASE_DATA_INVALID");
      }
      throw new ReplayStoreError(
        "REPLAY_ALREADY_EXISTS",
        "Replay id is already bound to a different header.",
      );
    } catch (error) {
      rethrowSafe(error);
    }
  }

  public async append(
    replayId: string,
    expectedSequence: number,
    event: ReplayAction,
  ): Promise<void> {
    if (!safeReplayId(replayId)) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ID",
        "Replay id must contain between 1 and 128 characters.",
      );
    }
    if (!validReplayAction(event)) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ACTION",
        "Replay action is invalid.",
      );
    }
    try {
      await this.database.transaction(async (transaction) => {
        const replayRows = await transaction
          .select()
          .from(replays)
          .where(eq(replays.id, replayId))
          .for("update")
          .limit(1);
        const replay = replayRows[0];
        if (replay === undefined) {
          throw new ReplayStoreError(
            "REPLAY_NOT_FOUND",
            "Replay was not found.",
          );
        }
        if (storedHeader(replay) === null) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }

        const existingRows = await transaction
          .select({
            sequence: replayActions.sequence,
            actorSlotId: replayActions.actorSlotId,
            action: replayActions.action,
          })
          .from(replayActions)
          .where(
            and(
              eq(replayActions.replayId, replayId),
              eq(replayActions.sequence, event.sequence),
            ),
          )
          .limit(1);
        const existingRow = existingRows[0];
        const existing =
          existingRow === undefined ? null : storedAction(existingRow);
        if (
          expectedSequence === event.sequence - 1 &&
          existing !== null &&
          replayActionsEqual(existing, event)
        ) {
          return;
        }
        if (existingRow !== undefined && existing === null) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }
        if (replay.completedAt !== null) {
          throw new ReplayStoreError(
            "REPLAY_ALREADY_COMPLETED",
            "Completed replay cannot accept actions.",
          );
        }

        const lastRows = await transaction
          .select({ sequence: replayActions.sequence })
          .from(replayActions)
          .where(eq(replayActions.replayId, replayId))
          .orderBy(desc(replayActions.sequence))
          .limit(1);
        const currentSequence = lastRows[0]?.sequence ?? 0;
        if (
          !Number.isSafeInteger(expectedSequence) ||
          expectedSequence !== currentSequence ||
          event.sequence !== currentSequence + 1
        ) {
          throw new ReplayStoreError(
            "INVALID_SEQUENCE",
            "Replay append sequence is stale, duplicate, or out of order.",
          );
        }

        await transaction.insert(replayActions).values({
          replayId,
          sequence: event.sequence,
          actorSlotId: event.actorSlotId,
          action: cloneJson(event.action),
        });
        await transaction
          .update(matches)
          .set({ finalRevision: event.sequence })
          .where(eq(matches.replayId, replayId));
      });
    } catch (error) {
      rethrowSafe(error);
    }
  }

  public async complete(
    replayId: string,
    expectedSequence: number,
    finalRngCursor: number,
    outcome: Parameters<ReplayStore["complete"]>[3],
  ): Promise<void> {
    if (!safeReplayId(replayId)) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ID",
        "Replay id must contain between 1 and 128 characters.",
      );
    }
    if (
      !Number.isSafeInteger(expectedSequence) ||
      !Number.isSafeInteger(finalRngCursor) ||
      finalRngCursor < 0 ||
      outcome === null ||
      !isJsonValue(outcome)
    ) {
      throw new ReplayStoreError(
        "COMPLETION_CONFLICT",
        "Replay completion data is invalid.",
      );
    }
    try {
      await this.database.transaction(async (transaction) => {
        const replayRows = await transaction
          .select()
          .from(replays)
          .where(eq(replays.id, replayId))
          .for("update")
          .limit(1);
        const replay = replayRows[0];
        if (replay === undefined) {
          throw new ReplayStoreError(
            "REPLAY_NOT_FOUND",
            "Replay was not found.",
          );
        }
        if (storedHeader(replay) === null) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }

        const lastRows = await transaction
          .select({ sequence: replayActions.sequence })
          .from(replayActions)
          .where(eq(replayActions.replayId, replayId))
          .orderBy(desc(replayActions.sequence))
          .limit(1);
        const currentSequence = lastRows[0]?.sequence ?? 0;
        if (expectedSequence !== currentSequence) {
          throw new ReplayStoreError(
            "INVALID_SEQUENCE",
            "Replay completion sequence does not match canonical actions.",
          );
        }

        if (replay.completedAt !== null) {
          if (
            replay.recordedRngCursor === finalRngCursor &&
            isJsonValue(replay.recordedOutcome) &&
            replay.recordedOutcome !== null &&
            jsonEqual(replay.recordedOutcome, outcome)
          ) {
            return;
          }
          throw new ReplayStoreError(
            "COMPLETION_CONFLICT",
            "Completed replay cannot be overwritten with another result.",
          );
        }
        if (
          replay.recordedRngCursor !== null ||
          replay.recordedOutcome !== null
        ) {
          throw new DatabaseError("DATABASE_DATA_INVALID");
        }

        const matchRows = await transaction
          .select()
          .from(matches)
          .where(eq(matches.replayId, replayId))
          .for("update")
          .limit(1);
        const match = matchRows[0];
        if (
          match !== undefined &&
          match.status !== "active"
        ) {
          throw new ReplayStoreError(
            "COMPLETION_CONFLICT",
            "Only an active match can complete its replay.",
          );
        }

        const completedAt = new Date();
        await transaction
          .update(replays)
          .set({
            recordedRngCursor: finalRngCursor,
            recordedOutcome: cloneJson(outcome),
            completedAt,
          })
          .where(eq(replays.id, replayId));
        if (match !== undefined) {
          await transaction
            .update(matches)
            .set({
              status: "completed",
              finalRevision: expectedSequence,
              completedAt,
            })
            .where(eq(matches.id, match.id));
        }
      });
    } catch (error) {
      rethrowSafe(error);
    }
  }

  public async get(replayId: string): Promise<CanonicalReplay | null> {
    if (!safeReplayId(replayId)) return null;
    try {
      return await this.database.transaction(
        async (transaction) => {
          const replayRows = await transaction
            .select()
            .from(replays)
            .where(eq(replays.id, replayId))
            .limit(1);
          const replay = replayRows[0];
          if (replay === undefined) return null;
          const header = storedHeader(replay);
          if (header === null) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          const actionRows = await transaction
            .select({
              sequence: replayActions.sequence,
              actorSlotId: replayActions.actorSlotId,
              action: replayActions.action,
            })
            .from(replayActions)
            .where(eq(replayActions.replayId, replayId))
            .orderBy(asc(replayActions.sequence));
          const actions = actionRows.map((row) => storedAction(row));
          if (actions.some((action) => action === null)) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          if (
            replay.recordedRngCursor !== null &&
            (!Number.isSafeInteger(replay.recordedRngCursor) ||
              replay.recordedRngCursor < 0)
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          if (
            replay.completedAt === null
              ? replay.recordedRngCursor !== null ||
                replay.recordedOutcome !== null
              : replay.recordedRngCursor === null ||
                replay.recordedOutcome === null ||
                !isJsonValue(replay.recordedOutcome)
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          const recordedOutcome = replay.recordedOutcome;
          if (
            recordedOutcome !== null &&
            !isJsonValue(recordedOutcome)
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          return {
            header,
            actions: actions as ReplayAction[],
            recordedRngCursor: replay.recordedRngCursor,
            recordedOutcome:
              recordedOutcome === null
                ? null
                : cloneJson(recordedOutcome),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    } catch (error) {
      rethrowSafe(error);
    }
  }
}
