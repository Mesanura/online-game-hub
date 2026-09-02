import { describe, expect, it } from "vitest";

import {
  REPLAY_FORMAT_VERSION,
  reconstructReplayFrames,
} from "../src/replay.js";
import type { CanonicalReplay, GameDefinitionResolver } from "../src/replay.js";
import {
  RNG_ALGORITHM_V1,
  createRng,
  defineGameId,
  defineGameVersion,
  definePlayerSlotId,
  nextInt,
} from "@online-game-hub/game-sdk";
import type { UnknownGameDefinition } from "@online-game-hub/game-sdk";

const slotA = definePlayerSlotId("slot-a");
const slotB = definePlayerSlotId("slot-b");
const nullSchema = {
  safeParse: (input: unknown) =>
    input === null
      ? { success: true as const, data: null }
      : { success: false as const },
} as unknown as UnknownGameDefinition["configSchema"];
const addActionSchema = {
  safeParse: (input: unknown) =>
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as { readonly type?: unknown }).type === "ADD" &&
    (input as { readonly amount?: unknown }).amount === 1 &&
    Object.keys(input).length === 2
      ? {
          success: true as const,
          data: { type: "ADD", amount: 1 } as const,
        }
      : { success: false as const },
} as unknown as UnknownGameDefinition["actionSchema"];

const definition: UnknownGameDefinition = {
  manifest: {
    id: defineGameId("frame-game"),
    gameVersion: defineGameVersion("1.0.0"),
    title: "Frame Game",
    description: "Test-only deterministic replay definition.",
    defaultConfig: null,
    minPlayers: 2,
    maxPlayers: 2,
    runtime: "turn-based",
    capabilities: { hiddenInformation: false, deterministicRandomness: false },
  },
  configSchema: nullSchema,
  actionSchema: addActionSchema,
  createInitialState: ({ rng }) => {
    const random = nextInt(rng, 10);
    return {
      state: { total: 0, replayNonce: random.value },
      rng: random.next,
    };
  },
  transition: ({ state, actorSlotId, action, rng }) =>
    actorSlotId === slotA || actorSlotId === slotB
      ? {
          status: "accepted" as const,
          state: {
            total:
              (state as { readonly total: number }).total +
              (action as { readonly amount: number }).amount,
            replayNonce: (state as { readonly replayNonce: number })
              .replayNonce,
          },
          rng,
        }
      : { status: "rejected" as const, code: "UNKNOWN_SLOT" },
  projectView: ({ state, viewer }) => ({
    total: (state as { readonly total: number }).total,
    viewer: viewer.kind === "player" ? viewer.slotId : "spectator",
  }),
  getOutcome: (state) =>
    (state as { readonly total: number }).total === 2
      ? {
          type: "WIN",
          winnerSlotId: "slot-a",
          replayNonce: (state as { readonly replayNonce: number }).replayNonce,
        }
      : null,
};

const replayNonce = nextInt(createRng("frame-seed"), 10).value;

const resolveDefinition: GameDefinitionResolver = (gameId, gameVersion) =>
  gameId === "frame-game" && gameVersion === "1.0.0" ? definition : undefined;

const replay = {
  header: {
    replayFormatVersion: REPLAY_FORMAT_VERSION,
    gameId: "frame-game",
    gameVersion: "1.0.0",
    rng: { algorithm: RNG_ALGORITHM_V1, seed: "frame-seed" },
    initialConfig: null,
    players: [{ slotId: "slot-a" }, { slotId: "slot-b" }],
  },
  actions: [
    { sequence: 1, actorSlotId: "slot-a", action: { type: "ADD", amount: 1 } },
    { sequence: 2, actorSlotId: "slot-b", action: { type: "ADD", amount: 1 } },
  ],
  recordedRngCursor: 1,
  recordedOutcome: { type: "WIN", winnerSlotId: "slot-a", replayNonce },
} as const satisfies CanonicalReplay;

describe("replay frame reconstruction", () => {
  it("builds revision zero and one projected frame per accepted canonical Action", () => {
    expect(
      reconstructReplayFrames(replay, resolveDefinition, {
        kind: "player",
        slotId: slotA,
      }),
    ).toEqual({
      status: "rebuilt",
      frames: [
        { revision: 0, view: { total: 0, viewer: "slot-a" } },
        { revision: 1, view: { total: 1, viewer: "slot-a" } },
        { revision: 2, view: { total: 2, viewer: "slot-a" } },
      ],
    });
  });

  it("is deterministic and returns no replay internals", () => {
    const first = reconstructReplayFrames(replay, resolveDefinition, {
      kind: "player",
      slotId: slotB,
    });
    const second = reconstructReplayFrames(replay, resolveDefinition, {
      kind: "player",
      slotId: slotB,
    });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain("frame-seed");
    expect(JSON.stringify(first)).not.toContain("actorSlotId");
    expect(JSON.stringify(first)).not.toContain("recordedOutcome");
  });

  it.each([
    [
      "seed",
      {
        ...replay,
        header: {
          ...replay.header,
          rng: { ...replay.header.rng, seed: "other" },
        },
      },
    ],
    [
      "sequence",
      {
        ...replay,
        actions: [{ ...replay.actions[0], sequence: 2 }, replay.actions[1]],
      },
    ],
    [
      "actor",
      {
        ...replay,
        actions: [
          { ...replay.actions[0], actorSlotId: "unknown" },
          replay.actions[1],
        ],
      },
    ],
    [
      "payload",
      {
        ...replay,
        actions: [
          { ...replay.actions[0], action: { type: "ADD", amount: 2 } },
          replay.actions[1],
        ],
      },
    ],
    [
      "version",
      { ...replay, header: { ...replay.header, gameVersion: "9.9.9" } },
    ],
    [
      "outcome",
      { ...replay, recordedOutcome: { type: "WIN", winnerSlotId: "slot-b" } },
    ],
  ])("fails closed when %s is tampered", (_label, invalidReplay) => {
    expect(
      reconstructReplayFrames(invalidReplay, resolveDefinition, {
        kind: "player",
        slotId: slotA,
      }),
    ).toMatchObject({ status: "invalid" });
  });

  it("rejects incomplete replays, invalid viewers, and throwing projections", () => {
    expect(
      reconstructReplayFrames(
        { ...replay, recordedRngCursor: null, recordedOutcome: null },
        resolveDefinition,
        { kind: "player", slotId: slotA },
      ),
    ).toEqual({ status: "invalid", code: "REPLAY_INCOMPLETE" });
    expect(
      reconstructReplayFrames(replay, resolveDefinition, {
        kind: "player",
        slotId: definePlayerSlotId("not-in-replay"),
      }),
    ).toEqual({ status: "invalid", code: "VIEWER_NOT_PLAYER" });
    expect(
      reconstructReplayFrames(
        replay,
        () => ({
          ...definition,
          projectView: () => {
            throw new Error("unsafe");
          },
        }),
        { kind: "player", slotId: slotA },
      ),
    ).toEqual({ status: "invalid", code: "PROJECTION_FAILED" });
  });
});
