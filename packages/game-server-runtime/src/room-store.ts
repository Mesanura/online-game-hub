import { isJsonValue } from "@online-game-hub/game-sdk";
import type { JsonValue, RngState } from "@online-game-hub/game-sdk";
import { SETUP_RNG_ALGORITHM_V1 } from "@online-game-hub/game-setup";
import type {
  FinalizedRoundSetup,
  RoundSetupCoordinatorState,
} from "@online-game-hub/game-setup";
import {
  setupProtocolGenerationSchema,
  type MatchStatus,
  type RoomCloseReason,
  type SetupProtocolGeneration,
} from "@online-game-hub/protocol";

export interface StoredPlayerSlot {
  readonly slotId: string;
  readonly playerSessionId: string | null;
  readonly userId?: string | null;
  readonly reservedUntilMilliseconds: number | null;
  readonly assignment?: string | null;
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
  readonly setupProtocol: SetupProtocolGeneration;
  readonly initialConfig: JsonValue;
  readonly players: readonly StoredPlayerSlot[];
  readonly currentRound: StoredGameRound | null;
  /** Present only while a Protocol V6 room offers setup for its next round. */
  readonly nextRoundSetup?: RoundSetupCoordinatorState;
  /** Present after a Protocol V6 room has finalized and started at least one round. */
  readonly previousFinalizedSetup?: FinalizedRoundSetup;
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
    ...(room.nextRoundSetup === undefined
      ? {}
      : { nextRoundSetup: cloneRoundSetup(room.nextRoundSetup) }),
    ...(room.previousFinalizedSetup === undefined
      ? {}
      : {
          previousFinalizedSetup: cloneFinalizedSetup(
            room.previousFinalizedSetup,
          ),
        }),
  };
}

function cloneFinalizedSetup(setup: FinalizedRoundSetup): FinalizedRoundSetup {
  return {
    config: cloneJson(setup.config as JsonValue),
    participantSlotIds: [...setup.participantSlotIds],
    playerOrder: [...setup.playerOrder],
    assignments: setup.assignments.map((entry) => ({ ...entry })),
  };
}

function cloneRoundSetup(
  setup: RoundSetupCoordinatorState,
): RoundSetupCoordinatorState {
  return {
    schemaVersion: 1,
    setupState: cloneJson(setup.setupState as JsonValue),
    setupRevision: setup.setupRevision,
    setupRng: { ...setup.setupRng },
    readySlotIds: [...setup.readySlotIds],
    finalizedSetup:
      setup.finalizedSetup === null
        ? null
        : cloneFinalizedSetup(setup.finalizedSetup),
  };
}

function validFinalizedSetup(
  setup: FinalizedRoundSetup,
  slots: readonly StoredPlayerSlot[],
): boolean {
  const participantSlotIds = setup.participantSlotIds;
  const occupiedSlotIds = new Set(
    slots
      .filter((slot) => slot.playerSessionId !== null)
      .map((slot) => slot.slotId),
  );
  const assignmentSlotIds = setup.assignments.map((entry) => entry.slotId);
  return (
    isJsonValue(setup.config) &&
    participantSlotIds.length > 0 &&
    new Set(participantSlotIds).size === participantSlotIds.length &&
    participantSlotIds.every((slotId) => occupiedSlotIds.has(slotId)) &&
    setup.playerOrder.length === participantSlotIds.length &&
    new Set(setup.playerOrder).size === setup.playerOrder.length &&
    setup.playerOrder.every((slotId) => participantSlotIds.includes(slotId)) &&
    assignmentSlotIds.length === participantSlotIds.length &&
    new Set(assignmentSlotIds).size === assignmentSlotIds.length &&
    assignmentSlotIds.every((slotId) => participantSlotIds.includes(slotId)) &&
    setup.assignments.every(
      (entry) =>
        entry.assignment === null ||
        (typeof entry.assignment === "string" && entry.assignment.length > 0),
    )
  );
}

function validRoundSetup(
  setup: RoundSetupCoordinatorState,
  slots: readonly StoredPlayerSlot[],
): boolean {
  const slotIds = new Set(slots.map((slot) => slot.slotId));
  return (
    setup.schemaVersion === 1 &&
    isJsonValue(setup.setupState) &&
    Number.isSafeInteger(setup.setupRevision) &&
    setup.setupRevision >= 0 &&
    setup.setupRng.algorithm === SETUP_RNG_ALGORITHM_V1 &&
    setup.setupRng.seed.length > 0 &&
    Number.isSafeInteger(setup.setupRng.cursor) &&
    setup.setupRng.cursor >= 0 &&
    new Set(setup.readySlotIds).size === setup.readySlotIds.length &&
    setup.readySlotIds.every((slotId) => slotIds.has(slotId)) &&
    (setup.finalizedSetup === null ||
      validFinalizedSetup(setup.finalizedSetup, slots))
  );
}

function validRoom(room: StoredGameRoom): boolean {
  const slots = room.players.map((player) => player.slotId);
  const round = room.currentRound;
  const validRound =
    round === null ||
    (Number.isSafeInteger(round.roundNumber) &&
      round.roundNumber > 0 &&
      round.replayId.length > 0 &&
      round.playerOrder.length > 0 &&
      round.playerOrder.length <= room.players.length &&
      new Set(round.playerOrder).size === round.playerOrder.length &&
      round.playerOrder.every((slotId) => slots.includes(slotId)) &&
      Number.isSafeInteger(round.revision) &&
      round.revision >= 0 &&
      isJsonValue(round.state) &&
      isJsonValue(round.outcome));
  const validSetup =
    room.setupProtocol === 5
      ? room.nextRoundSetup === undefined &&
        room.previousFinalizedSetup === undefined
      : (room.nextRoundSetup === undefined ||
          validRoundSetup(room.nextRoundSetup, room.players)) &&
        (room.previousFinalizedSetup === undefined ||
          validFinalizedSetup(room.previousFinalizedSetup, room.players)) &&
        (room.closeReason !== null || round?.status === "active"
          ? true
          : room.nextRoundSetup !== undefined) &&
        (round === null || room.previousFinalizedSetup !== undefined);
  return (
    room.roomId.length > 0 &&
    /^[A-HJ-NP-Z2-9]{8}$/u.test(room.roomCode) &&
    room.gameId.length > 0 &&
    room.gameVersion.length > 0 &&
    setupProtocolGenerationSchema.safeParse(room.setupProtocol).success &&
    room.players.length > 0 &&
    room.players.every(
      (player) =>
        (player.assignment === undefined ||
          player.assignment === null ||
          player.assignment.length > 0) &&
        (player.userId === undefined ||
          player.userId === null ||
          (typeof player.userId === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
              player.userId,
            ))),
    ) &&
    slots.every((slot) => slot.length > 0) &&
    new Set(slots).size === slots.length &&
    isJsonValue(room.initialConfig) &&
    validRound &&
    validSetup &&
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
    if (existing.setupProtocol !== room.setupProtocol) {
      throw new RoomStoreError(
        "INVALID_ROOM",
        "Room setup protocol cannot change after creation.",
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
