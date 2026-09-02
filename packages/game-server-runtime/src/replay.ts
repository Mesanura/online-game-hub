import {
  RNG_ALGORITHM_V1,
  createRng,
  definePlayerSlotId,
  isGameId,
  isGameVersion,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type {
  JsonValue,
  RngState,
  UnknownGameDefinition,
  Viewer,
} from "@online-game-hub/game-sdk";

export const REPLAY_FORMAT_VERSION = 1 as const;

export interface ReplayHeader {
  readonly replayFormatVersion: typeof REPLAY_FORMAT_VERSION;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly rng: {
    readonly algorithm: string;
    readonly seed: string;
  };
  readonly initialConfig: JsonValue;
  readonly players: readonly {
    readonly slotId: string;
    readonly participantRef?: string;
  }[];
}

export interface ReplayAction {
  readonly sequence: number;
  readonly actorSlotId: string;
  readonly action: JsonValue;
}

export interface CanonicalReplay {
  readonly header: ReplayHeader;
  readonly actions: readonly ReplayAction[];
  readonly recordedRngCursor: number | null;
  readonly recordedOutcome: JsonValue | null;
}

export interface ReplayStore {
  create(replayId: string, header: ReplayHeader): Promise<void>;
  append(
    replayId: string,
    expectedSequence: number,
    event: ReplayAction,
  ): Promise<void>;
  complete(
    replayId: string,
    expectedSequence: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void>;
  get(replayId: string): Promise<CanonicalReplay | null>;
}

export type ReplayStoreErrorCode =
  | "INVALID_HEADER"
  | "INVALID_REPLAY_ID"
  | "INVALID_REPLAY_ACTION"
  | "REPLAY_ALREADY_EXISTS"
  | "REPLAY_NOT_FOUND"
  | "INVALID_SEQUENCE"
  | "REPLAY_ALREADY_COMPLETED"
  | "COMPLETION_CONFLICT";

export class ReplayStoreError extends Error {
  public readonly code: ReplayStoreErrorCode;

  public constructor(code: ReplayStoreErrorCode, message: string) {
    super(message);
    this.name = "ReplayStoreError";
    this.code = code;
  }
}

interface StoredReplay {
  readonly header: ReplayHeader;
  readonly actions: ReplayAction[];
  recordedRngCursor: number | null;
  recordedOutcome: JsonValue | null;
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

function cloneHeader(header: ReplayHeader): ReplayHeader {
  return {
    replayFormatVersion: REPLAY_FORMAT_VERSION,
    gameId: header.gameId,
    gameVersion: header.gameVersion,
    rng: { algorithm: header.rng.algorithm, seed: header.rng.seed },
    initialConfig: cloneJson(header.initialConfig),
    players: header.players.map((player) =>
      player.participantRef === undefined
        ? { slotId: player.slotId }
        : {
            slotId: player.slotId,
            participantRef: player.participantRef,
          },
    ),
  };
}

function cloneAction(action: ReplayAction): ReplayAction {
  return {
    sequence: action.sequence,
    actorSlotId: action.actorSlotId,
    action: cloneJson(action.action),
  };
}

function cloneReplay(replay: StoredReplay): CanonicalReplay {
  return {
    header: cloneHeader(replay.header),
    actions: replay.actions.map((action) => cloneAction(action)),
    recordedRngCursor: replay.recordedRngCursor,
    recordedOutcome:
      replay.recordedOutcome === null
        ? null
        : cloneJson(replay.recordedOutcome),
  };
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return (
      left.length === right.length &&
      left.every(
        (entry, index) =>
          right[index] !== undefined && jsonEqual(entry, right[index]),
      )
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

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  const leftObject = left as { readonly [key: string]: JsonValue };
  const rightObject = right as { readonly [key: string]: JsonValue };
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      const rightKey = rightKeys[index];
      const leftValue = leftObject[key];
      const rightValue = rightObject[key];
      return (
        key === rightKey &&
        leftValue !== undefined &&
        rightValue !== undefined &&
        jsonEqual(leftValue, rightValue)
      );
    })
  );
}

function headerEqual(left: ReplayHeader, right: ReplayHeader): boolean {
  return (
    left.replayFormatVersion === right.replayFormatVersion &&
    left.gameId === right.gameId &&
    left.gameVersion === right.gameVersion &&
    left.rng.algorithm === right.rng.algorithm &&
    left.rng.seed === right.rng.seed &&
    jsonEqual(left.initialConfig, right.initialConfig) &&
    left.players.length === right.players.length &&
    left.players.every((player, index) => {
      const other = right.players[index];
      return (
        other !== undefined &&
        player.slotId === other.slotId &&
        player.participantRef === other.participantRef
      );
    })
  );
}

function actionEqual(left: ReplayAction, right: ReplayAction): boolean {
  return (
    left.sequence === right.sequence &&
    left.actorSlotId === right.actorSlotId &&
    jsonEqual(left.action, right.action)
  );
}

function validHeader(header: ReplayHeader): boolean {
  const slotIds = header.players.map((player) => player.slotId);
  return (
    header.replayFormatVersion === REPLAY_FORMAT_VERSION &&
    isGameId(header.gameId) &&
    isGameVersion(header.gameVersion) &&
    header.rng.algorithm === RNG_ALGORITHM_V1 &&
    header.rng.seed.length > 0 &&
    isJsonValue(header.initialConfig) &&
    header.players.length > 0 &&
    slotIds.every((slotId) => slotId.length > 0) &&
    new Set(slotIds).size === slotIds.length &&
    header.players.every(
      (player) =>
        player.participantRef === undefined || player.participantRef.length > 0,
    )
  );
}

function validReplayAction(action: ReplayAction): boolean {
  return (
    Number.isSafeInteger(action.sequence) &&
    action.sequence > 0 &&
    action.actorSlotId.length > 0 &&
    isJsonValue(action.action)
  );
}

export class InMemoryReplayStore implements ReplayStore {
  readonly #replays = new Map<string, StoredReplay>();

  public async create(replayId: string, header: ReplayHeader): Promise<void> {
    if (replayId.length === 0) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ID",
        "Replay id must not be empty.",
      );
    }
    if (!validHeader(header)) {
      throw new ReplayStoreError("INVALID_HEADER", "Replay header is invalid.");
    }
    const existing = this.#replays.get(replayId);
    if (existing !== undefined) {
      if (headerEqual(existing.header, header)) {
        return;
      }
      throw new ReplayStoreError(
        "REPLAY_ALREADY_EXISTS",
        "Replay id is already bound to a different header.",
      );
    }

    this.#replays.set(replayId, {
      header: cloneHeader(header),
      actions: [],
      recordedRngCursor: null,
      recordedOutcome: null,
    });
  }

  public async append(
    replayId: string,
    expectedSequence: number,
    event: ReplayAction,
  ): Promise<void> {
    const replay = this.#requireReplay(replayId);
    if (!validReplayAction(event)) {
      throw new ReplayStoreError(
        "INVALID_REPLAY_ACTION",
        "Replay action is invalid.",
      );
    }
    const existing = replay.actions[event.sequence - 1];
    if (
      expectedSequence === event.sequence - 1 &&
      existing !== undefined &&
      actionEqual(existing, event)
    ) {
      return;
    }
    if (replay.recordedRngCursor !== null) {
      throw new ReplayStoreError(
        "REPLAY_ALREADY_COMPLETED",
        "Completed replay cannot accept actions.",
      );
    }
    const currentSequence = replay.actions.length;
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
    replay.actions.push(cloneAction(event));
  }

  public async complete(
    replayId: string,
    expectedSequence: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void> {
    const replay = this.#requireReplay(replayId);
    if (
      !Number.isSafeInteger(expectedSequence) ||
      expectedSequence !== replay.actions.length
    ) {
      throw new ReplayStoreError(
        "INVALID_SEQUENCE",
        "Replay completion sequence does not match canonical actions.",
      );
    }
    if (
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

    if (replay.recordedRngCursor !== null) {
      if (
        replay.recordedRngCursor === finalRngCursor &&
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

    replay.recordedRngCursor = finalRngCursor;
    replay.recordedOutcome = cloneJson(outcome);
  }

  public async get(replayId: string): Promise<CanonicalReplay | null> {
    const replay = this.#replays.get(replayId);
    return replay === undefined ? null : cloneReplay(replay);
  }

  #requireReplay(replayId: string): StoredReplay {
    const replay = this.#replays.get(replayId);
    if (replay === undefined) {
      throw new ReplayStoreError("REPLAY_NOT_FOUND", "Replay was not found.");
    }
    return replay;
  }
}

export type ReplayVerificationErrorCode =
  | "UNSUPPORTED_REPLAY_FORMAT"
  | "INVALID_REPLAY"
  | "UNKNOWN_GAME_OR_VERSION"
  | "DEFINITION_MISMATCH"
  | "INVALID_CONFIG"
  | "NON_CANONICAL_CONFIG"
  | "SEQUENCE_MISMATCH"
  | "INVALID_ACTOR"
  | "INVALID_ACTION"
  | "NON_CANONICAL_ACTION"
  | "ACTION_REJECTED"
  | "INVALID_RNG_STATE"
  | "RNG_CURSOR_MISMATCH"
  | "OUTCOME_MISMATCH"
  | "CORE_ERROR";

export type ReplayVerificationResult =
  | {
      readonly status: "verified";
      readonly state: JsonValue;
      readonly rng: RngState;
      readonly outcome: JsonValue | null;
    }
  | {
      readonly status: "invalid";
      readonly code: ReplayVerificationErrorCode;
      readonly actionSequence?: number;
      readonly detail: string;
    };

export type GameDefinitionResolver = (
  gameId: string,
  gameVersion: string,
) => UnknownGameDefinition | undefined;

function invalid(
  code: ReplayVerificationErrorCode,
  detail: string,
  actionSequence?: number,
): ReplayVerificationResult {
  return actionSequence === undefined
    ? { status: "invalid", code, detail }
    : { status: "invalid", code, detail, actionSequence };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function parseReplay(
  input: unknown,
):
  | { readonly success: true; readonly replay: CanonicalReplay }
  | { readonly success: false; readonly result: ReplayVerificationResult } {
  if (!isRecord(input)) {
    return {
      success: false,
      result: invalid("INVALID_REPLAY", "Replay must be an object."),
    };
  }
  if (!isRecord(input.header)) {
    return {
      success: false,
      result: invalid("INVALID_REPLAY", "Replay header must be an object."),
    };
  }
  if (input.header.replayFormatVersion !== REPLAY_FORMAT_VERSION) {
    return {
      success: false,
      result: invalid(
        "UNSUPPORTED_REPLAY_FORMAT",
        "Replay format version is unsupported.",
      ),
    };
  }
  if (
    !hasOnlyKeys(input, [
      "header",
      "actions",
      "recordedRngCursor",
      "recordedOutcome",
    ]) ||
    !hasOnlyKeys(input.header, [
      "replayFormatVersion",
      "gameId",
      "gameVersion",
      "rng",
      "initialConfig",
      "players",
    ]) ||
    typeof input.header.gameId !== "string" ||
    typeof input.header.gameVersion !== "string" ||
    !isRecord(input.header.rng) ||
    !hasOnlyKeys(input.header.rng, ["algorithm", "seed"]) ||
    typeof input.header.rng.algorithm !== "string" ||
    typeof input.header.rng.seed !== "string" ||
    !isJsonValue(input.header.initialConfig) ||
    !Array.isArray(input.header.players) ||
    !Array.isArray(input.actions) ||
    !(
      input.recordedRngCursor === null ||
      (typeof input.recordedRngCursor === "number" &&
        Number.isSafeInteger(input.recordedRngCursor) &&
        input.recordedRngCursor >= 0)
    ) ||
    !isJsonValue(input.recordedOutcome)
  ) {
    return {
      success: false,
      result: invalid("INVALID_REPLAY", "Replay envelope is invalid."),
    };
  }

  for (const player of input.header.players) {
    if (
      !isRecord(player) ||
      !hasOnlyKeys(player, ["slotId", "participantRef"]) ||
      typeof player.slotId !== "string" ||
      player.slotId.length === 0 ||
      ("participantRef" in player &&
        (typeof player.participantRef !== "string" ||
          player.participantRef.length === 0))
    ) {
      return {
        success: false,
        result: invalid("INVALID_REPLAY", "Replay player is invalid."),
      };
    }
  }

  for (const action of input.actions) {
    if (
      !isRecord(action) ||
      !hasOnlyKeys(action, ["sequence", "actorSlotId", "action"]) ||
      typeof action.sequence !== "number" ||
      !Number.isSafeInteger(action.sequence) ||
      action.sequence <= 0 ||
      typeof action.actorSlotId !== "string" ||
      action.actorSlotId.length === 0 ||
      !isJsonValue(action.action)
    ) {
      return {
        success: false,
        result: invalid("INVALID_REPLAY", "Replay action entry is invalid."),
      };
    }
  }

  return {
    success: true,
    replay: input as unknown as CanonicalReplay,
  };
}

function validReturnedRng(
  rng: Readonly<RngState>,
  seed: string,
  minimumCursor: number,
): boolean {
  return (
    rng.algorithm === RNG_ALGORITHM_V1 &&
    rng.seed === seed &&
    Number.isSafeInteger(rng.cursor) &&
    rng.cursor >= minimumCursor
  );
}

const MAX_REPLAY_FRAME_COUNT = 512;
const MAX_REPLAY_FRAME_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface ReplayFrame {
  readonly revision: number;
  readonly view: JsonValue;
}

export type ReplayFrameReconstructionErrorCode =
  | ReplayVerificationErrorCode
  | "REPLAY_INCOMPLETE"
  | "VIEWER_NOT_PLAYER"
  | "FRAME_LIMIT_EXCEEDED"
  | "RESPONSE_SIZE_EXCEEDED"
  | "PROJECTION_FAILED";

export type ReplayFrameReconstructionResult =
  | {
      readonly status: "rebuilt";
      readonly frames: readonly ReplayFrame[];
    }
  | {
      readonly status: "invalid";
      readonly code: ReplayFrameReconstructionErrorCode;
      readonly actionSequence?: number;
    };

function invalidFrames(
  code: ReplayFrameReconstructionErrorCode,
  actionSequence?: number,
): ReplayFrameReconstructionResult {
  return actionSequence === undefined
    ? { status: "invalid", code }
    : { status: "invalid", code, actionSequence };
}

function serializedFramesExceedLimit(frames: readonly ReplayFrame[]): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(frames)).byteLength >
      MAX_REPLAY_FRAME_RESPONSE_BYTES
    );
  } catch {
    return true;
  }
}

const FORBIDDEN_PROJECTED_KEYS = new Set([
  "replayId",
  "seed",
  "rng",
  "state",
  "action",
  "actorSlotId",
  "playerSessionId",
  "userId",
  "runtimeRoomId",
  "participantRef",
]);

function containsForbiddenProjectedKey(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenProjectedKey(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        FORBIDDEN_PROJECTED_KEYS.has(key) ||
        containsForbiddenProjectedKey(child),
    );
  }
  return false;
}

/**
 * Rebuilds a completed canonical replay for one already-authorized player.
 * The result intentionally contains only projected Views, never replay internals.
 */
export function reconstructReplayFrames(
  replayInput: unknown,
  resolveDefinition: GameDefinitionResolver,
  viewer: Viewer,
): ReplayFrameReconstructionResult {
  const parsedReplay = parseReplay(replayInput);
  if (parsedReplay.success === false) {
    const result = parsedReplay.result;
    return result.status === "invalid"
      ? invalidFrames(result.code)
      : invalidFrames("INVALID_REPLAY");
  }
  const replay = parsedReplay.replay;
  if (replay.recordedRngCursor === null || replay.recordedOutcome === null) {
    return invalidFrames("REPLAY_INCOMPLETE");
  }
  if (
    !validHeader(replay.header) ||
    replay.header.rng.algorithm !== RNG_ALGORITHM_V1
  ) {
    return invalidFrames("INVALID_REPLAY");
  }
  if (replay.actions.length + 1 > MAX_REPLAY_FRAME_COUNT) {
    return invalidFrames("FRAME_LIMIT_EXCEEDED");
  }

  const definition = resolveDefinition(
    replay.header.gameId,
    replay.header.gameVersion,
  );
  if (definition === undefined) {
    return invalidFrames("UNKNOWN_GAME_OR_VERSION");
  }
  if (
    definition.manifest.id !== replay.header.gameId ||
    definition.manifest.gameVersion !== replay.header.gameVersion
  ) {
    return invalidFrames("DEFINITION_MISMATCH");
  }
  if (
    replay.header.players.length < definition.manifest.minPlayers ||
    replay.header.players.length > definition.manifest.maxPlayers
  ) {
    return invalidFrames("INVALID_REPLAY");
  }

  const configResult = definition.configSchema.safeParse(
    replay.header.initialConfig,
  );
  if (!configResult.success || !isJsonValue(configResult.data)) {
    return invalidFrames("INVALID_CONFIG");
  }
  if (!jsonEqual(configResult.data, replay.header.initialConfig)) {
    return invalidFrames("NON_CANONICAL_CONFIG");
  }

  const slotIds = replay.header.players.map((player) => player.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    return invalidFrames("INVALID_REPLAY");
  }
  const players = slotIds.map((slotId) => definePlayerSlotId(slotId));
  if (
    viewer.kind !== "player" ||
    !players.some((slotId) => slotId === viewer.slotId)
  ) {
    return invalidFrames("VIEWER_NOT_PLAYER");
  }

  const frames: ReplayFrame[] = [];
  const appendFrame = (
    revision: number,
    state: JsonValue,
  ): ReplayFrameReconstructionResult | null => {
    let view: JsonValue;
    try {
      view = definition.projectView({ state, viewer });
    } catch {
      return invalidFrames("PROJECTION_FAILED");
    }
    if (!isJsonValue(view) || containsForbiddenProjectedKey(view)) {
      return invalidFrames("PROJECTION_FAILED");
    }
    frames.push({ revision, view: cloneJson(view) });
    return serializedFramesExceedLimit(frames)
      ? invalidFrames("RESPONSE_SIZE_EXCEEDED")
      : null;
  };

  let rng = createRng(replay.header.rng.seed);
  let state: JsonValue;
  try {
    const initialized = definition.createInitialState({
      config: configResult.data,
      players,
      rng,
    });
    if (
      !isJsonValue(initialized.state) ||
      !validReturnedRng(initialized.rng, rng.seed, rng.cursor)
    ) {
      return invalidFrames("INVALID_RNG_STATE");
    }
    state = initialized.state;
    rng = initialized.rng;
    const initialFrameResult = appendFrame(0, state);
    if (initialFrameResult !== null) return initialFrameResult;

    for (const [index, event] of replay.actions.entries()) {
      const expectedSequence = index + 1;
      if (event.sequence !== expectedSequence) {
        return invalidFrames("SEQUENCE_MISMATCH", event.sequence);
      }
      const actorSlotId = players.find(
        (slotId) => slotId === event.actorSlotId,
      );
      if (actorSlotId === undefined) {
        return invalidFrames("INVALID_ACTOR", event.sequence);
      }
      const actionResult = definition.actionSchema.safeParse(event.action);
      if (!actionResult.success || !isJsonValue(actionResult.data)) {
        return invalidFrames("INVALID_ACTION", event.sequence);
      }
      if (!jsonEqual(actionResult.data, event.action)) {
        return invalidFrames("NON_CANONICAL_ACTION", event.sequence);
      }
      const transitioned = definition.transition({
        state,
        actorSlotId,
        action: actionResult.data,
        rng,
      });
      if (transitioned.status === "rejected") {
        return invalidFrames("ACTION_REJECTED", event.sequence);
      }
      if (
        !isJsonValue(transitioned.state) ||
        !validReturnedRng(transitioned.rng, rng.seed, rng.cursor)
      ) {
        return invalidFrames("INVALID_RNG_STATE", event.sequence);
      }
      state = transitioned.state;
      rng = transitioned.rng;
      const frameResult = appendFrame(event.sequence, state);
      if (frameResult !== null) return frameResult;
    }

    if (replay.recordedRngCursor !== rng.cursor) {
      return invalidFrames("RNG_CURSOR_MISMATCH");
    }
    const outcome = definition.getOutcome(state);
    if (!isJsonValue(outcome) || !jsonEqual(outcome, replay.recordedOutcome)) {
      return invalidFrames("OUTCOME_MISMATCH");
    }
    return { status: "rebuilt", frames };
  } catch {
    return invalidFrames("CORE_ERROR");
  }
}

export function verifyReplay(
  replayInput: unknown,
  resolveDefinition: GameDefinitionResolver,
): ReplayVerificationResult {
  const parsedReplay = parseReplay(replayInput);
  if (!parsedReplay.success) {
    return parsedReplay.result;
  }
  const replay = parsedReplay.replay;

  if (
    !validHeader(replay.header) ||
    replay.header.rng.algorithm !== RNG_ALGORITHM_V1
  ) {
    return invalid("INVALID_REPLAY", "Replay header values are invalid.");
  }

  const definition = resolveDefinition(
    replay.header.gameId,
    replay.header.gameVersion,
  );
  if (definition === undefined) {
    return invalid(
      "UNKNOWN_GAME_OR_VERSION",
      "No exact game definition is registered for the replay.",
    );
  }
  if (
    definition.manifest.id !== replay.header.gameId ||
    definition.manifest.gameVersion !== replay.header.gameVersion
  ) {
    return invalid(
      "DEFINITION_MISMATCH",
      "Resolver returned a different game definition.",
    );
  }
  if (
    replay.header.players.length < definition.manifest.minPlayers ||
    replay.header.players.length > definition.manifest.maxPlayers
  ) {
    return invalid(
      "INVALID_REPLAY",
      "Replay player count is outside the manifest range.",
    );
  }

  const configResult = definition.configSchema.safeParse(
    replay.header.initialConfig,
  );
  if (!configResult.success || !isJsonValue(configResult.data)) {
    return invalid("INVALID_CONFIG", "Replay Config schema validation failed.");
  }
  if (!jsonEqual(configResult.data, replay.header.initialConfig)) {
    return invalid(
      "NON_CANONICAL_CONFIG",
      "Replay Config is not the normalized schema output.",
    );
  }

  const slotIds = replay.header.players.map((player) => player.slotId);
  if (new Set(slotIds).size !== slotIds.length) {
    return invalid("INVALID_REPLAY", "Replay player slots must be unique.");
  }
  const players = slotIds.map((slotId) => definePlayerSlotId(slotId));
  let rng = createRng(replay.header.rng.seed);
  let state: JsonValue;

  try {
    const initialized = definition.createInitialState({
      config: configResult.data,
      players,
      rng,
    });
    if (
      !isJsonValue(initialized.state) ||
      !validReturnedRng(initialized.rng, rng.seed, rng.cursor)
    ) {
      return invalid(
        "INVALID_RNG_STATE",
        "Game initialization returned invalid State or RNG.",
      );
    }
    state = initialized.state;
    rng = initialized.rng;

    for (const [index, event] of replay.actions.entries()) {
      const expectedSequence = index + 1;
      if (event.sequence !== expectedSequence) {
        return invalid(
          "SEQUENCE_MISMATCH",
          "Replay action sequence is not continuous.",
          event.sequence,
        );
      }

      const actorSlotId = players.find(
        (slotId) => slotId === event.actorSlotId,
      );
      if (actorSlotId === undefined) {
        return invalid(
          "INVALID_ACTOR",
          "Replay actor is not one of the header slots.",
          event.sequence,
        );
      }

      const actionResult = definition.actionSchema.safeParse(event.action);
      if (!actionResult.success || !isJsonValue(actionResult.data)) {
        return invalid(
          "INVALID_ACTION",
          "Replay Action schema validation failed.",
          event.sequence,
        );
      }
      if (!jsonEqual(actionResult.data, event.action)) {
        return invalid(
          "NON_CANONICAL_ACTION",
          "Replay Action is not the normalized schema output.",
          event.sequence,
        );
      }

      const transitioned = definition.transition({
        state,
        actorSlotId,
        action: actionResult.data,
        rng,
      });
      if (transitioned.status === "rejected") {
        return invalid(
          "ACTION_REJECTED",
          "Canonical replay contains an Action rejected by the Core.",
          event.sequence,
        );
      }
      if (
        !isJsonValue(transitioned.state) ||
        !validReturnedRng(transitioned.rng, rng.seed, rng.cursor)
      ) {
        return invalid(
          "INVALID_RNG_STATE",
          "Game transition returned invalid State or RNG.",
          event.sequence,
        );
      }
      state = transitioned.state;
      rng = transitioned.rng;
    }

    if (
      replay.recordedRngCursor !== null &&
      replay.recordedRngCursor !== rng.cursor
    ) {
      return invalid(
        "RNG_CURSOR_MISMATCH",
        "Rebuilt RNG cursor differs from the recorded cursor.",
      );
    }

    const outcome = definition.getOutcome(state);
    if (outcome !== null && !isJsonValue(outcome)) {
      return invalid("CORE_ERROR", "Game returned a non-JSON Outcome.");
    }
    if (
      outcome === null
        ? replay.recordedOutcome !== null
        : replay.recordedOutcome === null ||
          !jsonEqual(outcome, replay.recordedOutcome)
    ) {
      return invalid(
        "OUTCOME_MISMATCH",
        "Rebuilt Outcome differs from the recorded Outcome.",
      );
    }

    return { status: "verified", state, rng, outcome };
  } catch {
    return invalid(
      "CORE_ERROR",
      "Game definition threw while rebuilding the replay.",
    );
  }
}
