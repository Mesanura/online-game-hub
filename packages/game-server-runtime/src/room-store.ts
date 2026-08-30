import { isJsonValue } from "@online-game-hub/game-sdk";
import type { JsonValue, RngState } from "@online-game-hub/game-sdk";
import type { MatchStatus } from "@online-game-hub/protocol";

export interface StoredPlayerSlot {
  readonly slotId: string;
  readonly playerSessionId: string | null;
  readonly reservedUntilMilliseconds: number | null;
}

export interface StoredGameRoom {
  readonly roomId: string;
  readonly roomCode: string;
  readonly roundNumber: number;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly initialConfig: JsonValue;
  readonly players: readonly StoredPlayerSlot[];
  readonly state: JsonValue;
  readonly rng: RngState;
  readonly revision: number;
  readonly status: MatchStatus;
  readonly outcome: JsonValue | null;
  readonly replayId: string;
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
    state: cloneJson(room.state),
    rng: { ...room.rng },
    outcome: room.outcome === null ? null : cloneJson(room.outcome),
  };
}

function validRoom(room: StoredGameRoom): boolean {
  const slots = room.players.map((player) => player.slotId);
  return (
    room.roomId.length > 0 &&
    /^[A-HJ-NP-Z2-9]{8}$/u.test(room.roomCode) &&
    Number.isSafeInteger(room.roundNumber) &&
    room.roundNumber > 0 &&
    room.gameId.length > 0 &&
    room.gameVersion.length > 0 &&
    room.replayId.length > 0 &&
    room.players.length > 0 &&
    slots.every((slot) => slot.length > 0) &&
    new Set(slots).size === slots.length &&
    Number.isSafeInteger(room.revision) &&
    room.revision >= 0 &&
    isJsonValue(room.initialConfig) &&
    isJsonValue(room.state) &&
    isJsonValue(room.outcome)
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
