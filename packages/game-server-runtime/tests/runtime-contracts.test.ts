import { createRng } from "@online-game-hub/game-sdk";
import { describe, expect, it } from "vitest";

import {
  InMemoryMetricsCollector,
  InMemoryRoomStore,
  correlatePlayerSessionId,
} from "../src/index.js";
import type { StoredGameRoom } from "../src/index.js";
import { FakeRuntimeClock, TestTicketAuthority } from "../src/testing/index.js";

const storedRoom = {
  roomId: "internal-1",
  roomCode: "ABCD2345",
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  initialConfig: null,
  players: [
    {
      slotId: "slot-1",
      playerSessionId: "session-a",
      userId: null,
      reservedUntilMilliseconds: null,
    },
    {
      slotId: "slot-2",
      playerSessionId: null,
      userId: null,
      reservedUntilMilliseconds: null,
    },
  ],
  currentRound: {
    roundNumber: 1,
    playerOrder: ["slot-1", "slot-2"],
    state: { board: [null] },
    rng: createRng("room-seed"),
    revision: 0,
    status: "active",
    outcome: null,
    replayId: "replay-1",
  },
  closeReason: null,
} as const satisfies StoredGameRoom;

describe("ticket verifier port test authority", () => {
  it("verifies signed claims and rejects all trust-boundary failures", async () => {
    const clock = new FakeRuntimeClock(1_000_000);
    const authority = new TestTicketAuthority({
      issuer: "test-web",
      secret: "test-secret-at-least-16-characters",
      clock,
      lifetimeSeconds: 30,
    });
    const valid = authority.issue("session-a");
    await expect(authority.verify(valid)).resolves.toMatchObject({
      status: "verified",
      playerSessionId: "session-a",
      userId: null,
      claims: { protocolVersion: 5, audience: "game-server" },
    });
    await expect(authority.verify(undefined)).resolves.toMatchObject({
      status: "rejected",
      code: "MISSING_TICKET",
      protocolCode: "UNAUTHENTICATED",
    });
    await expect(authority.verify(`${valid}tampered`)).resolves.toMatchObject({
      status: "rejected",
      code: "INVALID_TICKET",
    });
    await expect(
      authority.verify(
        authority.issue("session-a", { issuedAt: 900, expiresAt: 999 }),
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "EXPIRED_TICKET" });
    await expect(
      authority.verify(
        authority.issue("session-a", { audience: "another-service" }),
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "WRONG_AUDIENCE" });
    await expect(
      authority.verify(authority.issue("session-a", { issuer: "other" })),
    ).resolves.toMatchObject({ status: "rejected", code: "WRONG_ISSUER" });
    await expect(
      authority.verify(authority.issue("session-a", { protocolVersion: 1 })),
    ).resolves.toMatchObject({
      status: "rejected",
      code: "PROTOCOL_VERSION_UNSUPPORTED",
      protocolCode: "PROTOCOL_VERSION_UNSUPPORTED",
    });
  });

  it("uses a fake clock without real waiting", async () => {
    const clock = new FakeRuntimeClock(0);
    const authority = new TestTicketAuthority({
      issuer: "test-web",
      secret: "test-secret-at-least-16-characters",
      clock,
      lifetimeSeconds: 1,
    });
    const ticket = authority.issue("session-a");
    clock.advanceBy(1000);
    await expect(authority.verify(ticket)).resolves.toMatchObject({
      status: "rejected",
      code: "EXPIRED_TICKET",
    });
  });
});

describe("in-memory platform ports", () => {
  it("stores rooms by normalized code with defensive copies", async () => {
    const store = new InMemoryRoomStore();
    await store.create(storedRoom);
    const byId = await store.getByRoomId("internal-1");
    const byCode = await store.getByRoomCode(" abcd2345 ");
    expect(byId).toEqual(storedRoom);
    expect(byCode).toEqual(storedRoom);
    expect(byId).not.toBe(byCode);
    expect(byId?.players).not.toBe(byCode?.players);

    await store.save({
      ...storedRoom,
      currentRound: { ...storedRoom.currentRound, revision: 1 },
    });
    expect(await store.list()).toEqual([
      {
        ...storedRoom,
        currentRound: { ...storedRoom.currentRound, revision: 1 },
      },
    ]);
  });

  it("rejects room id/code conflicts and unknown saves", async () => {
    const store = new InMemoryRoomStore();
    await expect(
      store.create({
        ...storedRoom,
        roomId: "invalid-round",
        roomCode: "EFGH2345",
        currentRound: { ...storedRoom.currentRound, roundNumber: 0 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROOM" });
    await store.create(storedRoom);
    await expect(store.create(storedRoom)).rejects.toMatchObject({
      code: "ROOM_ALREADY_EXISTS",
    });
    await expect(
      store.create({ ...storedRoom, roomId: "internal-2" }),
    ).rejects.toMatchObject({ code: "ROOM_CODE_ALREADY_EXISTS" });
    await expect(
      store.save({ ...storedRoom, roomId: "missing" }),
    ).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
  });

  it("collects metrics and exposes only session correlations", () => {
    const metrics = new InMemoryMetricsCollector();
    const labels = { gameId: "tic-tac-toe", gameVersion: "1.0.0" };
    metrics.increment("actions_accepted_total", labels);
    metrics.increment("actions_accepted_total", labels, 2);
    metrics.setGauge("active_rooms", 1, labels);
    expect(metrics.snapshot()).toEqual([
      { name: "actions_accepted_total", labels, value: 3 },
      { name: "active_rooms", labels, value: 1 },
    ]);
    const correlation = correlatePlayerSessionId("secret-session-id");
    expect(correlation).toMatch(/^session-[0-9a-f]{8}$/u);
    expect(correlation).not.toContain("secret-session-id");
  });
});
