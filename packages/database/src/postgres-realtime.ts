import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import {
  isRealtimeGameId,
  isRealtimeGameVersion,
} from "@online-game-hub/realtime-game-sdk";
import type {
  JsonValue,
  RealtimeCanonicalReplay,
  RealtimeDefinitionResolver,
} from "@online-game-hub/realtime-game-sdk";
import { SETUP_RNG_ALGORITHM_V1 } from "@online-game-hub/game-setup";
import type {
  FinalizedRoundSetup,
  RoundSetupCoordinatorState,
} from "@online-game-hub/game-setup";
import type {
  RealtimeMatchArchive,
  RealtimeRoomStore,
  RealtimeStoredPlayerSlot,
  RealtimeStoredRoom,
} from "@online-game-hub/realtime-game-server-runtime";
import {
  matchStatusSchema,
  setupProtocolGenerationSchema,
} from "@online-game-hub/protocol";
import type { MatchStatus, RoomCloseReason } from "@online-game-hub/protocol";

import type { OnlineGameHubDatabase } from "./client.js";
import { DatabaseError } from "./errors.js";
import {
  realtimeMatchPlayers,
  realtimeMatches,
  realtimeReplays,
  realtimeRoomPlayers,
  realtimeRooms,
} from "./schema.js";
import { PostgresRealtimeReplayStore } from "./postgres-realtime-replay-store.js";

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  )
    return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function dateFromMilliseconds(value: number | null): Date | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DatabaseError("DATABASE_OPERATION_ERROR");
  const date = new Date(value);
  if (!validDate(date)) throw new DatabaseError("DATABASE_OPERATION_ERROR");
  return date;
}

function millisecondsFromDate(value: Date | null): number | null {
  if (value === null) return null;
  if (!validDate(value)) throw new DatabaseError("DATABASE_DATA_INVALID");
  return value.getTime();
}

function validFinalizedSetup(
  setup: unknown,
  players: readonly RealtimeStoredPlayerSlot[],
): setup is FinalizedRoundSetup {
  if (
    !isRecord(setup) ||
    !isJsonValue(setup.config) ||
    !Array.isArray(setup.participantSlotIds) ||
    !setup.participantSlotIds.every((slotId) => typeof slotId === "string") ||
    !Array.isArray(setup.playerOrder) ||
    !setup.playerOrder.every((slotId) => typeof slotId === "string") ||
    !Array.isArray(setup.assignments) ||
    !setup.assignments.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.slotId === "string" &&
        (entry.assignment === null || typeof entry.assignment === "string"),
    )
  ) {
    return false;
  }
  const typedSetup = setup as unknown as FinalizedRoundSetup;
  const participants = typedSetup.participantSlotIds;
  const occupied = new Set(
    players
      .filter((player) => player.playerSessionId !== null)
      .map((player) => player.slotId),
  );
  const assignmentSlots = typedSetup.assignments.map((entry) => entry.slotId);
  return (
    participants.length > 0 &&
    new Set(participants).size === participants.length &&
    participants.every((slotId) => occupied.has(slotId)) &&
    typedSetup.playerOrder.length === participants.length &&
    new Set(typedSetup.playerOrder).size === typedSetup.playerOrder.length &&
    typedSetup.playerOrder.every((slotId) => participants.includes(slotId)) &&
    assignmentSlots.length === participants.length &&
    new Set(assignmentSlots).size === assignmentSlots.length &&
    assignmentSlots.every((slotId) => participants.includes(slotId)) &&
    typedSetup.assignments.every(
      (entry) =>
        entry.assignment === null ||
        (typeof entry.assignment === "string" && entry.assignment.length > 0),
    )
  );
}

function validRoundSetup(
  setup: unknown,
  players: readonly RealtimeStoredPlayerSlot[],
): setup is RoundSetupCoordinatorState {
  if (
    !isRecord(setup) ||
    !isJsonValue(setup.setupState) ||
    !isRecord(setup.setupRng) ||
    !Array.isArray(setup.readySlotIds) ||
    !setup.readySlotIds.every((slotId) => typeof slotId === "string")
  ) {
    return false;
  }
  const typedSetup = setup as unknown as RoundSetupCoordinatorState;
  const slotIds = new Set(players.map((player) => player.slotId));
  return (
    typedSetup.schemaVersion === 1 &&
    Number.isSafeInteger(typedSetup.setupRevision) &&
    typedSetup.setupRevision >= 0 &&
    typedSetup.setupRng.algorithm === SETUP_RNG_ALGORITHM_V1 &&
    typedSetup.setupRng.seed.length > 0 &&
    Number.isSafeInteger(typedSetup.setupRng.cursor) &&
    typedSetup.setupRng.cursor >= 0 &&
    new Set(typedSetup.readySlotIds).size === typedSetup.readySlotIds.length &&
    typedSetup.readySlotIds.every((slotId) => slotIds.has(slotId)) &&
    (typedSetup.finalizedSetup === null ||
      validFinalizedSetup(typedSetup.finalizedSetup, players))
  );
}

function validSetupPersistence(room: RealtimeStoredRoom): boolean {
  if (room.setupProtocol === 5) {
    return (
      room.nextRoundSetup === undefined &&
      room.previousFinalizedSetup === undefined
    );
  }
  if (
    room.nextRoundSetup !== undefined &&
    !validRoundSetup(room.nextRoundSetup, room.players)
  ) {
    return false;
  }
  if (
    room.previousFinalizedSetup !== undefined &&
    !validFinalizedSetup(room.previousFinalizedSetup, room.players)
  ) {
    return false;
  }
  if (room.currentRound === null) {
    return (
      room.nextRoundSetup !== undefined &&
      room.previousFinalizedSetup === undefined
    );
  }
  if (room.previousFinalizedSetup === undefined) return false;
  return room.currentRound.status === "completed"
    ? room.nextRoundSetup !== undefined
    : room.nextRoundSetup === undefined;
}

function validRoom(room: RealtimeStoredRoom): boolean {
  if (
    room.roomId.length === 0 ||
    room.roomCode.length !== 8 ||
    !/^[A-HJ-NP-Z2-9]{8}$/u.test(room.roomCode) ||
    !isRealtimeGameId(room.gameId) ||
    !isRealtimeGameVersion(room.gameVersion) ||
    !setupProtocolGenerationSchema.safeParse(room.setupProtocol).success ||
    !isJsonValue(room.initialConfig) ||
    room.players.length !== 2 ||
    new Set(room.players.map((player) => player.slotId)).size !== 2 ||
    !validSetupPersistence(room)
  )
    return false;
  for (const player of room.players) {
    if (
      player.slotId.length === 0 ||
      (player.playerSessionId !== null &&
        player.playerSessionId.length === 0) ||
      (player.userId !== null && !validUuid(player.userId)) ||
      (player.reservedUntilMilliseconds !== null &&
        (!Number.isSafeInteger(player.reservedUntilMilliseconds) ||
          player.reservedUntilMilliseconds < 0))
    )
      return false;
  }
  const round = room.currentRound;
  if (round === null) return true;
  return (
    Number.isSafeInteger(round.roundNumber) &&
    round.roundNumber > 0 &&
    round.replayId.length > 0 &&
    round.playerOrder.length === 2 &&
    new Set(round.playerOrder).size === 2 &&
    round.playerOrder.every((slot) =>
      room.players.some((player) => player.slotId === slot),
    ) &&
    Number.isSafeInteger(round.tick) &&
    round.tick >= 0 &&
    ["active", "completed", "abandoned"].includes(round.status) &&
    isJsonValue(round.outcome) &&
    (round.status !== "completed" || round.tick > 0) &&
    (round.status === "active"
      ? round.outcome === null
      : round.status === "completed"
        ? round.outcome !== null
        : true)
  );
}

function rethrow(error: unknown): never {
  if (error instanceof DatabaseError) throw error;
  throw new DatabaseError("DATABASE_OPERATION_ERROR");
}

function roomRoundColumns(room: RealtimeStoredRoom) {
  const round = room.currentRound;
  return {
    nextRoundSetup:
      room.nextRoundSetup === undefined
        ? null
        : cloneJson(room.nextRoundSetup as unknown as JsonValue),
    previousFinalizedSetup:
      room.previousFinalizedSetup === undefined
        ? null
        : cloneJson(room.previousFinalizedSetup as unknown as JsonValue),
    currentRoundNumber: round?.roundNumber ?? null,
    currentReplayId: round?.replayId ?? null,
    currentPlayerOrder: round === null ? null : [...round.playerOrder],
    currentTick: round?.tick ?? 0,
    currentStatus: round?.status ?? null,
    currentOutcome: round === null ? null : cloneJson(round.outcome),
    closeReason: room.closeReason,
  };
}

function roomFromRows(
  room: typeof realtimeRooms.$inferSelect,
  players: readonly (typeof realtimeRoomPlayers.$inferSelect)[],
): RealtimeStoredRoom {
  const setupProtocol = setupProtocolGenerationSchema.safeParse(
    room.setupProtocol,
  );
  if (
    !setupProtocol.success ||
    !isJsonValue(room.initialConfig) ||
    !Number.isSafeInteger(room.currentTick) ||
    room.currentTick < 0 ||
    (room.currentRoundNumber !== null &&
      (!Number.isSafeInteger(room.currentRoundNumber) ||
        room.currentRoundNumber <= 0)) ||
    (room.currentPlayerOrder !== null &&
      !Array.isArray(room.currentPlayerOrder)) ||
    (room.currentStatus !== null &&
      !matchStatusSchema.safeParse(room.currentStatus).success) ||
    (room.closeReason !== null &&
      ![
        "OWNER_CLOSED",
        "PLAYER_LEFT",
        "RECONNECT_TIMEOUT",
        "REMATCH_TIMEOUT",
      ].includes(room.closeReason))
  )
    throw new DatabaseError("DATABASE_DATA_INVALID");
  const currentRound =
    room.currentRoundNumber === null ||
    room.currentReplayId === null ||
    room.currentStatus === null ||
    !Array.isArray(room.currentPlayerOrder)
      ? null
      : {
          roundNumber: room.currentRoundNumber,
          replayId: room.currentReplayId,
          playerOrder: room.currentPlayerOrder.map((slot) => String(slot)),
          tick: room.currentTick,
          status: room.currentStatus as "active" | "completed" | "abandoned",
          outcome:
            room.currentOutcome === null
              ? null
              : (room.currentOutcome as JsonValue),
        };
  if (currentRound !== null) {
    if (
      currentRound.playerOrder.length !== 2 ||
      new Set(currentRound.playerOrder).size !== 2 ||
      currentRound.playerOrder.some(
        (slotId) => !players.some((player) => player.playerSlotId === slotId),
      )
    ) {
      throw new DatabaseError("DATABASE_DATA_INVALID");
    }
  }
  const result: RealtimeStoredRoom = {
    roomId: room.roomId,
    roomCode: room.roomCode,
    gameId: room.gameId,
    gameVersion: room.gameVersion,
    setupProtocol: setupProtocol.data,
    initialConfig: room.initialConfig as JsonValue,
    players: players.map((player) => ({
      slotId: player.playerSlotId,
      playerSessionId: player.playerSessionId,
      userId: player.userId,
      reservedUntilMilliseconds: millisecondsFromDate(player.reservedUntil),
    })),
    currentRound,
    ...(room.nextRoundSetup === null
      ? {}
      : {
          nextRoundSetup: room.nextRoundSetup as RoundSetupCoordinatorState,
        }),
    ...(room.previousFinalizedSetup === null
      ? {}
      : {
          previousFinalizedSetup:
            room.previousFinalizedSetup as FinalizedRoundSetup,
        }),
    closeReason: room.closeReason as RoomCloseReason | null,
  };
  if (!validRoom(result)) throw new DatabaseError("DATABASE_DATA_INVALID");
  return result;
}

/** PostgreSQL implementation of the explicit realtime room store. */
export class PostgresRealtimeRoomStore implements RealtimeRoomStore {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async create(room: RealtimeStoredRoom): Promise<void> {
    if (!validRoom(room)) throw new DatabaseError("DATABASE_OPERATION_ERROR");
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.insert(realtimeRooms).values({
          roomId: room.roomId,
          roomCode: room.roomCode,
          gameId: room.gameId,
          gameVersion: room.gameVersion,
          setupProtocol: room.setupProtocol,
          initialConfig: cloneJson(room.initialConfig),
          ...roomRoundColumns(room),
        });
        await transaction.insert(realtimeRoomPlayers).values(
          room.players.map((player) => ({
            roomId: room.roomId,
            playerSlotId: player.slotId,
            playerSessionId: player.playerSessionId,
            userId: player.userId,
            reservedUntil: dateFromMilliseconds(
              player.reservedUntilMilliseconds,
            ),
          })),
        );
      });
    } catch (error) {
      rethrow(error);
    }
  }

  public async save(room: RealtimeStoredRoom): Promise<void> {
    if (!validRoom(room)) throw new DatabaseError("DATABASE_OPERATION_ERROR");
    try {
      await this.database.transaction(async (transaction) => {
        const updated = await transaction
          .update(realtimeRooms)
          .set({
            roomCode: room.roomCode,
            gameId: room.gameId,
            gameVersion: room.gameVersion,
            initialConfig: cloneJson(room.initialConfig),
            ...roomRoundColumns(room),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(realtimeRooms.roomId, room.roomId),
              eq(realtimeRooms.setupProtocol, room.setupProtocol),
            ),
          )
          .returning({ roomId: realtimeRooms.roomId });
        if (updated.length !== 1)
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        await transaction
          .delete(realtimeRoomPlayers)
          .where(eq(realtimeRoomPlayers.roomId, room.roomId));
        await transaction.insert(realtimeRoomPlayers).values(
          room.players.map((player) => ({
            roomId: room.roomId,
            playerSlotId: player.slotId,
            playerSessionId: player.playerSessionId,
            userId: player.userId,
            reservedUntil: dateFromMilliseconds(
              player.reservedUntilMilliseconds,
            ),
          })),
        );
      });
    } catch (error) {
      rethrow(error);
    }
  }

  public async getByRoomCode(
    roomCode: string,
  ): Promise<RealtimeStoredRoom | null> {
    const normalized = roomCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/u.test(normalized)) return null;
    try {
      const rows = await this.database
        .select()
        .from(realtimeRooms)
        .where(eq(realtimeRooms.roomCode, normalized))
        .limit(1);
      const room = rows[0];
      if (room === undefined) return null;
      const players = await this.database
        .select()
        .from(realtimeRoomPlayers)
        .where(eq(realtimeRoomPlayers.roomId, room.roomId))
        .orderBy(asc(realtimeRoomPlayers.playerSlotId));
      return roomFromRows(room, players);
    } catch (error) {
      rethrow(error);
    }
  }
}

function assignedPlayers(room: RealtimeStoredRoom) {
  return room.players.filter(
    (
      player,
    ): player is RealtimeStoredPlayerSlot & {
      readonly playerSessionId: string;
    } => player.playerSessionId !== null,
  );
}

/** PostgreSQL archive adapter for realtime Match/Round lifecycle. */
export class PostgresRealtimeMatchArchive implements RealtimeMatchArchive {
  readonly #resolveDefinition: RealtimeDefinitionResolver | undefined;

  public constructor(
    private readonly database: OnlineGameHubDatabase,
    options: { readonly resolveDefinition?: RealtimeDefinitionResolver } = {},
  ) {
    this.#resolveDefinition = options.resolveDefinition;
  }

  public async createRound(room: RealtimeStoredRoom): Promise<void> {
    const round = room.currentRound;
    const players = assignedPlayers(room);
    if (
      !validRoom(room) ||
      round === null ||
      round.status !== "active" ||
      round.tick !== 0 ||
      players.length !== 2
    ) {
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    }
    try {
      await this.database.transaction(async (transaction) => {
        if (this.#resolveDefinition !== undefined) {
          const definition = this.#resolveDefinition(
            room.gameId,
            room.gameVersion,
          );
          if (
            definition === undefined ||
            definition.manifest.runtime !== "realtime"
          )
            throw new DatabaseError("DATABASE_DATA_INVALID");
        }
        const replay = await transaction
          .select({
            gameId: realtimeReplays.gameId,
            gameVersion: realtimeReplays.gameVersion,
          })
          .from(realtimeReplays)
          .where(eq(realtimeReplays.id, round.replayId))
          .limit(1);
        if (
          replay[0] === undefined ||
          replay[0].gameId !== room.gameId ||
          replay[0].gameVersion !== room.gameVersion
        )
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        await transaction
          .insert(realtimeMatches)
          .values({
            id: randomUUID(),
            runtimeRoomId: room.roomId,
            roundNumber: round.roundNumber,
            replayId: round.replayId,
            gameId: room.gameId,
            gameVersion: room.gameVersion,
            status: "active",
            finalTick: 0,
            startedAt: new Date(),
          })
          .onConflictDoNothing();
        const rows = await transaction
          .select()
          .from(realtimeMatches)
          .where(
            and(
              eq(realtimeMatches.runtimeRoomId, room.roomId),
              eq(realtimeMatches.roundNumber, round.roundNumber),
            ),
          )
          .limit(1);
        const match = rows[0];
        if (
          match === undefined ||
          match.replayId !== round.replayId ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion ||
          match.status !== "active"
        )
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        for (const player of players) {
          await transaction
            .insert(realtimeMatchPlayers)
            .values({
              matchId: match.id,
              playerSlotId: player.slotId,
              playerSessionId: player.playerSessionId,
              userId: player.userId,
            })
            .onConflictDoNothing();
          const stored = await transaction
            .select({
              playerSessionId: realtimeMatchPlayers.playerSessionId,
              userId: realtimeMatchPlayers.userId,
            })
            .from(realtimeMatchPlayers)
            .where(
              and(
                eq(realtimeMatchPlayers.matchId, match.id),
                eq(realtimeMatchPlayers.playerSlotId, player.slotId),
              ),
            )
            .limit(1);
          if (
            stored[0]?.playerSessionId !== player.playerSessionId ||
            stored[0]?.userId !== player.userId
          )
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
        }
      });
    } catch (error) {
      rethrow(error);
    }
  }

  public async saveRound(room: RealtimeStoredRoom): Promise<void> {
    const round = room.currentRound;
    const players = assignedPlayers(room);
    if (!validRoom(room) || round === null || players.length !== 2)
      throw new DatabaseError("DATABASE_OPERATION_ERROR");
    try {
      await this.database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(realtimeMatches)
          .where(
            and(
              eq(realtimeMatches.runtimeRoomId, room.roomId),
              eq(realtimeMatches.roundNumber, round.roundNumber),
            ),
          )
          .limit(1);
        const match = rows[0];
        if (
          match === undefined ||
          match.replayId !== round.replayId ||
          match.gameId !== room.gameId ||
          match.gameVersion !== room.gameVersion ||
          round.tick < match.finalTick
        )
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        const replayRows = await transaction
          .select({
            completedAt: realtimeReplays.completedAt,
            finalTick: realtimeReplays.finalTick,
            recordedOutcome: realtimeReplays.recordedOutcome,
          })
          .from(realtimeReplays)
          .where(eq(realtimeReplays.id, round.replayId))
          .limit(1);
        const replay = replayRows[0];
        if (replay === undefined)
          throw new DatabaseError("DATABASE_OPERATION_ERROR");
        if (round.status === "active") {
          if (match.status === "completed" || match.status === "abandoned")
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          if (replay.completedAt !== null)
            throw new DatabaseError("DATABASE_DATA_INVALID");
          await transaction
            .update(realtimeMatches)
            .set({
              status: "active",
              finalTick: round.tick,
              startedAt: match.startedAt ?? new Date(),
            })
            .where(eq(realtimeMatches.id, match.id));
        } else if (round.status === "completed") {
          if (round.outcome === null)
            throw new DatabaseError("DATABASE_DATA_INVALID");
          if (
            replay.completedAt === null ||
            replay.finalTick !== round.tick ||
            replay.recordedOutcome === null ||
            !jsonEqual(replay.recordedOutcome, round.outcome)
          ) {
            throw new DatabaseError("DATABASE_DATA_INVALID");
          }
          if (match.status === "completed") {
            if (match.finalTick !== round.tick)
              throw new DatabaseError("DATABASE_OPERATION_ERROR");
            return;
          }
          if (match.status !== "active")
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          await transaction
            .update(realtimeMatches)
            .set({
              status: "completed",
              finalTick: round.tick,
              completedAt: match.completedAt ?? new Date(),
              startedAt: match.startedAt ?? new Date(),
            })
            .where(eq(realtimeMatches.id, match.id));
        } else {
          if (match.status === "completed")
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          if (replay.completedAt !== null)
            throw new DatabaseError("DATABASE_DATA_INVALID");
          if (match.status === "abandoned") return;
          await transaction
            .update(realtimeMatches)
            .set({
              status: "abandoned",
              finalTick: round.tick,
              abandonedAt: match.abandonedAt ?? new Date(),
              startedAt: match.startedAt ?? new Date(),
            })
            .where(eq(realtimeMatches.id, match.id));
        }
        for (const player of players) {
          await transaction
            .insert(realtimeMatchPlayers)
            .values({
              matchId: match.id,
              playerSlotId: player.slotId,
              playerSessionId: player.playerSessionId,
              userId: player.userId,
            })
            .onConflictDoNothing();
          const stored = await transaction
            .select({
              playerSessionId: realtimeMatchPlayers.playerSessionId,
              userId: realtimeMatchPlayers.userId,
            })
            .from(realtimeMatchPlayers)
            .where(
              and(
                eq(realtimeMatchPlayers.matchId, match.id),
                eq(realtimeMatchPlayers.playerSlotId, player.slotId),
              ),
            )
            .limit(1);
          if (
            stored[0]?.playerSessionId !== player.playerSessionId ||
            stored[0]?.userId !== player.userId
          ) {
            throw new DatabaseError("DATABASE_OPERATION_ERROR");
          }
        }
      });
    } catch (error) {
      rethrow(error);
    }
  }
}

export interface RealtimeMatchHistoryItem {
  readonly matchId: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: MatchStatus;
  readonly finalRevision: number;
  readonly playerSlotId: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly replayAvailable: boolean;
}

export interface AuthorizedRealtimeReplayMatch {
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: "completed";
  readonly finalRevision: number;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export type UserRealtimeMatchReplayRead =
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "available";
      readonly playerSlotId: string;
      readonly match: AuthorizedRealtimeReplayMatch;
      readonly replay: RealtimeCanonicalReplay;
    };

function parseRealtimeHistoryRow(row: {
  readonly matchId: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly status: string;
  readonly finalTick: number;
  readonly playerSlotId: string;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly abandonedAt: Date | null;
  readonly replayCompletedAt: Date | null;
}): RealtimeMatchHistoryItem {
  const status = matchStatusSchema.safeParse(row.status);
  if (
    !validUuid(row.matchId) ||
    !Number.isSafeInteger(row.roundNumber) ||
    row.roundNumber <= 0 ||
    !isRealtimeGameId(row.gameId) ||
    !isRealtimeGameVersion(row.gameVersion) ||
    !status.success ||
    !Number.isSafeInteger(row.finalTick) ||
    row.finalTick < 0 ||
    row.playerSlotId.length === 0 ||
    !validDate(row.createdAt) ||
    (row.startedAt !== null && !validDate(row.startedAt)) ||
    (row.completedAt !== null && !validDate(row.completedAt)) ||
    (row.abandonedAt !== null && !validDate(row.abandonedAt)) ||
    (row.replayCompletedAt !== null && !validDate(row.replayCompletedAt))
  )
    throw new DatabaseError("DATABASE_DATA_INVALID");
  const finished = row.completedAt ?? row.abandonedAt;
  return {
    matchId: row.matchId,
    roundNumber: row.roundNumber,
    gameId: row.gameId,
    gameVersion: row.gameVersion,
    status: status.data,
    finalRevision: row.finalTick,
    playerSlotId: row.playerSlotId,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: finished?.toISOString() ?? null,
    replayAvailable:
      status.data === "completed" && row.replayCompletedAt !== null,
  };
}

export class PostgresRealtimeMatchRepository {
  public constructor(private readonly database: OnlineGameHubDatabase) {}

  public async listForUser(
    userId: string,
    limit = 50,
  ): Promise<readonly RealtimeMatchHistoryItem[]> {
    if (
      !validUuid(userId) ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > 50
    )
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    try {
      const rows = await this.database
        .select({
          matchId: realtimeMatches.id,
          roundNumber: realtimeMatches.roundNumber,
          gameId: realtimeMatches.gameId,
          gameVersion: realtimeMatches.gameVersion,
          status: realtimeMatches.status,
          finalTick: realtimeMatches.finalTick,
          playerSlotId: realtimeMatchPlayers.playerSlotId,
          createdAt: realtimeMatches.createdAt,
          startedAt: realtimeMatches.startedAt,
          completedAt: realtimeMatches.completedAt,
          abandonedAt: realtimeMatches.abandonedAt,
          replayCompletedAt: realtimeReplays.completedAt,
        })
        .from(realtimeMatchPlayers)
        .innerJoin(
          realtimeMatches,
          eq(realtimeMatches.id, realtimeMatchPlayers.matchId),
        )
        .innerJoin(
          realtimeReplays,
          eq(realtimeReplays.id, realtimeMatches.replayId),
        )
        .where(eq(realtimeMatchPlayers.userId, userId))
        .orderBy(desc(realtimeMatches.createdAt), desc(realtimeMatches.id))
        .limit(limit);
      return rows.map((row) => parseRealtimeHistoryRow(row));
    } catch (error) {
      rethrow(error);
    }
  }

  public async getCompletedReplayForUser(
    userId: string,
    matchId: string,
  ): Promise<UserRealtimeMatchReplayRead> {
    if (!validUuid(userId))
      throw new DatabaseError("DATABASE_CONFIGURATION_ERROR");
    if (!validUuid(matchId)) return { status: "not-found" };
    try {
      const rows = await this.database
        .select({
          replayId: realtimeMatches.replayId,
          roundNumber: realtimeMatches.roundNumber,
          gameId: realtimeMatches.gameId,
          gameVersion: realtimeMatches.gameVersion,
          status: realtimeMatches.status,
          finalTick: realtimeMatches.finalTick,
          playerSlotId: realtimeMatchPlayers.playerSlotId,
          createdAt: realtimeMatches.createdAt,
          startedAt: realtimeMatches.startedAt,
          completedAt: realtimeMatches.completedAt,
          replayCompletedAt: realtimeReplays.completedAt,
        })
        .from(realtimeMatchPlayers)
        .innerJoin(
          realtimeMatches,
          eq(realtimeMatches.id, realtimeMatchPlayers.matchId),
        )
        .innerJoin(
          realtimeReplays,
          eq(realtimeReplays.id, realtimeMatches.replayId),
        )
        .where(
          and(
            eq(realtimeMatchPlayers.userId, userId),
            eq(realtimeMatches.id, matchId),
          ),
        )
        .limit(2);
      if (rows.length !== 1 || rows[0] === undefined)
        return { status: "not-found" };
      const row = rows[0];
      const status = matchStatusSchema.safeParse(row.status);
      if (
        !status.success ||
        status.data !== "completed" ||
        row.startedAt === null ||
        row.completedAt === null ||
        row.replayCompletedAt === null
      )
        return { status: "unavailable" };
      const replay = await new PostgresRealtimeReplayStore(this.database).get(
        row.replayId,
      );
      if (replay === null) throw new DatabaseError("DATABASE_DATA_INVALID");
      return {
        status: "available",
        playerSlotId: row.playerSlotId,
        match: {
          roundNumber: row.roundNumber,
          gameId: row.gameId,
          gameVersion: row.gameVersion,
          status: "completed",
          finalRevision: row.finalTick,
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.completedAt.toISOString(),
        },
        replay,
      };
    } catch (error) {
      rethrow(error);
    }
  }
}
