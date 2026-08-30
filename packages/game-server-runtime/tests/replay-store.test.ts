import { RNG_ALGORITHM_V1 } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import { InMemoryReplayStore, REPLAY_FORMAT_VERSION } from "../src/index.js";
import type { ReplayAction, ReplayHeader } from "../src/index.js";

const header = {
  replayFormatVersion: REPLAY_FORMAT_VERSION,
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  rng: {
    algorithm: RNG_ALGORITHM_V1,
    seed: "store-seed",
  },
  initialConfig: null,
  players: [{ slotId: "player-x" }, { slotId: "player-o" }],
} as const satisfies ReplayHeader;

const firstAction = {
  sequence: 1,
  actorSlotId: "player-x",
  action: { type: "PLACE_MARK", cell: 0 },
} as const satisfies ReplayAction;

describe("InMemoryReplayStore", () => {
  it("creates, appends, completes, and returns defensive copies", async () => {
    const store = new InMemoryReplayStore();
    await store.create("replay-1", header);
    await store.append("replay-1", 0, firstAction);
    await store.complete("replay-1", 1, 0, {
      type: "WIN",
      winnerSlotId: "player-x",
    });
    await store.complete("replay-1", 1, 0, {
      winnerSlotId: "player-x",
      type: "WIN",
    });

    const firstRead = await store.get("replay-1");
    const secondRead = await store.get("replay-1");
    expect(firstRead).toEqual(secondRead);
    expect(firstRead).not.toBe(secondRead);
    expect(firstRead?.header).not.toBe(secondRead?.header);
    expect(firstRead?.actions[0]).not.toBe(secondRead?.actions[0]);
    expect(firstRead).toMatchObject({
      actions: [firstAction],
      recordedRngCursor: 0,
      recordedOutcome: {
        type: "WIN",
        winnerSlotId: "player-x",
      },
    });
  });

  it("makes identical create retry idempotent and rejects conflicts", async () => {
    const store = new InMemoryReplayStore();
    await expect(store.create("", header)).rejects.toMatchObject({
      code: "INVALID_REPLAY_ID",
    });
    await store.create("replay-1", header);
    await expect(store.create("replay-1", header)).resolves.toBeUndefined();
    await expect(
      store.create("replay-1", {
        ...header,
        rng: { ...header.rng, seed: "conflicting-seed" },
      }),
    ).rejects.toMatchObject({
      code: "REPLAY_ALREADY_EXISTS",
    });
    await expect(store.append("unknown", 0, firstAction)).rejects.toMatchObject(
      { code: "REPLAY_NOT_FOUND" },
    );
    await expect(store.get("unknown")).resolves.toBeNull();
  });

  it("makes identical append retry idempotent and rejects conflicts atomically", async () => {
    const store = new InMemoryReplayStore();
    await store.create("replay-1", header);

    await expect(
      store.append("replay-1", 0, { ...firstAction, sequence: 2 }),
    ).rejects.toMatchObject({ code: "INVALID_SEQUENCE" });
    await store.append("replay-1", 0, firstAction);
    await expect(
      store.append("replay-1", 0, firstAction),
    ).resolves.toBeUndefined();
    await expect(
      store.append("replay-1", 0, {
        sequence: 1,
        actorSlotId: "player-o",
        action: { type: "PLACE_MARK", cell: 1 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SEQUENCE" });

    expect((await store.get("replay-1"))?.actions).toEqual([firstAction]);
  });

  it("makes completion idempotent but rejects conflicts and later appends", async () => {
    const store = new InMemoryReplayStore();
    await store.create("replay-1", header);
    await store.append("replay-1", 0, firstAction);
    const outcome = { type: "DRAW" } as const;
    await expect(store.complete("replay-1", 1, 0, null)).rejects.toMatchObject({
      code: "COMPLETION_CONFLICT",
    });
    await store.complete("replay-1", 1, 0, outcome);
    await store.complete("replay-1", 1, 0, outcome);

    await expect(
      store.complete("replay-1", 1, 1, outcome),
    ).rejects.toMatchObject({ code: "COMPLETION_CONFLICT" });
    await expect(
      store.complete("replay-1", 1, 0, {
        type: "WIN",
        winnerSlotId: "player-x",
      }),
    ).rejects.toMatchObject({ code: "COMPLETION_CONFLICT" });
    await expect(
      store.append("replay-1", 1, {
        sequence: 2,
        actorSlotId: "player-o",
        action: { type: "PLACE_MARK", cell: 1 },
      }),
    ).rejects.toMatchObject({ code: "REPLAY_ALREADY_COMPLETED" });
  });
});
