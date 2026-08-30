import {
  RNG_ALGORITHM_V1,
  isGameId,
  isGameVersion,
  isJsonValue,
} from "@online-game-hub/game-sdk";
import type { JsonValue } from "@online-game-hub/game-sdk";
import type {
  ReplayAction,
  ReplayHeader,
} from "@online-game-hub/game-server-runtime";

export function cloneJson(value: JsonValue): JsonValue {
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

export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
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
  const leftRecord = left as Readonly<Record<string, JsonValue>>;
  const rightRecord = right as Readonly<Record<string, JsonValue>>;
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      const rightKey = rightKeys[index];
      const leftValue = leftRecord[key];
      const rightValue = rightRecord[key];
      return (
        key === rightKey &&
        leftValue !== undefined &&
        rightValue !== undefined &&
        jsonEqual(leftValue, rightValue)
      );
    })
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function parseReplayPlayers(
  input: unknown,
): ReplayHeader["players"] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const players: { slotId: string; participantRef?: string }[] = [];
  for (const entry of input) {
    const participantRef = isRecord(entry) ? entry.participantRef : undefined;
    if (
      !isRecord(entry) ||
      Object.keys(entry).some(
        (key) => key !== "slotId" && key !== "participantRef",
      ) ||
      typeof entry.slotId !== "string" ||
      entry.slotId.length === 0 ||
      (participantRef !== undefined &&
        (typeof participantRef !== "string" || participantRef.length === 0))
    ) {
      return null;
    }
    players.push(
      participantRef === undefined
        ? { slotId: entry.slotId }
        : { slotId: entry.slotId, participantRef },
    );
  }
  if (new Set(players.map((player) => player.slotId)).size !== players.length) {
    return null;
  }
  return players;
}

export function validReplayHeader(header: ReplayHeader): boolean {
  return (
    header.replayFormatVersion === 1 &&
    isGameId(header.gameId) &&
    isGameVersion(header.gameVersion) &&
    header.rng.algorithm === RNG_ALGORITHM_V1 &&
    header.rng.seed.length > 0 &&
    isJsonValue(header.initialConfig) &&
    parseReplayPlayers(header.players) !== null
  );
}

export function replayHeadersEqual(
  left: ReplayHeader,
  right: ReplayHeader,
): boolean {
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

export function validReplayAction(action: ReplayAction): boolean {
  return (
    Number.isSafeInteger(action.sequence) &&
    action.sequence > 0 &&
    action.actorSlotId.length > 0 &&
    isJsonValue(action.action)
  );
}

export function replayActionsEqual(
  left: ReplayAction,
  right: ReplayAction,
): boolean {
  return (
    left.sequence === right.sequence &&
    left.actorSlotId === right.actorSlotId &&
    jsonEqual(left.action, right.action)
  );
}
