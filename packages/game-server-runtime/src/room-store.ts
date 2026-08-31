import { isJsonValue } from "@online-game-hub/game-sdk";
import type { JsonValue, RngState } from "@online-game-hub/game-sdk";
import type { MatchStatus, RoomCloseReason } from "@online-game-hub/protocol";

export interface StoredPlayerSlot {
  readonly slotId: string;
  readonly playerSessionId: string | null;
  readonly reservedUntilMilliseconds: number | null;
}

export interface StoredGameRound {
  readonly roundNumber: number;
  readonly playerOrder: readonly string[];
  readonly replayId: string;
  readonly state: JsonValue;
  readonly rng: RngState;
  readonly revision: number;
  readonly status: Exclude<MatchStatus, "waiting">;
  readonly outcome: JsonValue | null;
}

export interface StoredGameRoom {
  readonly roomId: string;
  readonly roomCode: string;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly initialConfig: JsonValue;
  readonly players: readonly StoredPlayerSlot[];
  readonly currentRound: StoredGameRound | null;
  readonly closeReason: RoomCloseReason | null;
}

export interface RoomStore {
  create(room: StoredGameRoom): Promise<void>;
  save(room: StoredGameRoom): Promise<void>;
  getByRoomId(roomId: string): Promise<StoredGameRoom | null>;
  getByRoomCode(roomCode: string): Promise<StoredGameRoom | null>;
  list(): Promise<readonly StoredGameRoom[]>;
}

export type RoomStoreErrorCode =
  | "INVALID_ROOM"
  | "ROOM_ALREADY_EXISTS"
  | "ROOM_CODE_ALREADY_EXISTS"
  | "ROOM_NOT_FOUND";

export class RoomStoreError extends Error {
  public constructor(
    public readonly code: RoomStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoomStoreError";
  }
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJson(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]),
    );
  }
  return value;
}

function cloneRoom(room: StoredGameRoom): StoredGameRoom {
  return {
    ...room,
    initialConfig: cloneJson(room.initialConfig),
    players: room.players.map((player) => ({ ...player })),
    currentRound:
      room.currentRound === null
        ? null
        : {
            ...room.currentRound,
            playerOrder: [...room.currentRound.playerOrder],
            state: cloneJson(room.currentRound.state),
            rng: { ...room.currentRound.rng },
            outcome:
              room.currentRound.outcome === null
                ? null
                : cloneJson(room.currentRound.outcome),
          },
  };
}

function validRoom(room: StoredGameRoom): boolean {
  const slots = room.players.map((player) => player.slotId);
  const round = room.currentRound;
  const validRound =
    round === null ||
    (Number.isSafeInteger(round.roundNumber) &&
      round.roundNumber > 0 &&
      round.replayId.length > 0 &&
      round.playerOrder.length === room.players.length &&
      new Set(round.playerOrder).size === round.playerOrder.length &&
      round.playerOrder.every((slotId) => slots.includes(slotId)) &&
      Number.isSafeInteger(round.revision) &&
      round.revision >= 0 &&
      isJsonValue(round.state) &&
      isJsonValue(round.outcome));
  return (
    room.roomId.length > 0 &&
    /^[A-HJ-NP-Z2-9]{8}$/u.test(room.roomCode) &&
    room.gameId.length > 0 &&
    room.gameVersion.length > 0 &&
    room.players.length > 0 &&
    slots.every((slot) => slot.length > 0) &&
    new Set(slots).size === slots.length &&
    isJsonValue(room.initialConfig) &&
    validRound &&
    (room.closeReason === null || typeof room.closeReason === "string")
  );
}

export class InMemoryRoomStore implements RoomStore {
  readonly #roomsById = new Map<string, StoredGameRoom>();
  readonly #roomIdByCode = new Map<string, string>();

  public async create(room: StoredGameRoom): Promise<void> {
    if (!validRoom(room)) {
      throw new RoomStoreError("INVALID_ROOM", "Room record is invalid.");
    }
    if (this.#roomsById.has(room.roomId)) {
      throw new RoomStoreError("ROOM_ALREADY_EXISTS", "Room already exists.");
    }
    if (this.#roomIdByCode.has(room.roomCode)) {
      throw new RoomStoreError(
        "ROOM_CODE_ALREADY_EXISTS",
        "Room code already exists.",
      );
    }
    this.#roomsById.set(room.roomId, cloneRoom(room));
    this.#roomIdByCode.set(room.roomCode, room.roomId);
  }

  public async save(room: StoredGameRoom): Promise<void> {
    if (!validRoom(room)) {
      throw new RoomStoreError("INVALID_ROOM", "Room record is invalid.");
    }
    const existing = this.#roomsById.get(room.roomId);
    if (existing === undefined) {
      throw new RoomStoreError("ROOM_NOT_FOUND", "Room was not found.");
    }
    if (existing.roomCode !== room.roomCode) {
      throw new RoomStoreError(
        "INVALID_ROOM",
        "Room code cannot change after creation.",
      );
    }
    this.#roomsById.set(room.roomId, cloneRoom(room));
  }

  public async getByRoomId(roomId: string): Promise<StoredGameRoom | null> {
    const room = this.#roomsById.get(roomId);
    return room === undefined ? null : cloneRoom(room);
  }

  public async getByRoomCode(roomCode: string): Promise<StoredGameRoom | null> {
    const roomId = this.#roomIdByCode.get(roomCode.trim().toUpperCase());
    return roomId === undefined ? null : this.getByRoomId(roomId);
  }

  public async list(): Promise<readonly StoredGameRoom[]> {
    return [...this.#roomsById.values()].map((room) => cloneRoom(room));
  }
}
