import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  PostgresMatchRepository,
  PostgresReplayStore,
  createPostgresDatabaseClient,
} from "@online-game-hub/database";
import {
  createIsolatedTestDatabase,
  requireTestDatabaseUrl,
} from "@online-game-hub/database/testing";
import { resolveGameDefinition } from "@online-game-hub/game-registry/server";
import {
  GAME_ACTION_MESSAGE,
  GAME_ROOM_NAME,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  verifyReplay,
} from "@online-game-hub/game-server-runtime";
import { createDeterministicRuntimeIdSource } from "@online-game-hub/game-server-runtime/testing";
import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";
import {
  PROTOCOL_VERSION,
  roomLifecycleStateSchema,
  serverMessageSchema,
} from "@online-game-hub/protocol";
import type {
  GameActionCommand,
  RoomControlCommand,
  RoomControlOperation,
  RoomLifecycleState,
  ServerMessage,
} from "@online-game-hub/protocol";
import { describe, expect, it } from "vitest";

import { createProductionGameServer } from "../src/index.js";

class MessageInbox {
  readonly #messages: ServerMessage[] = [];
  readonly #waiters: Array<{
    readonly predicate: (message: ServerMessage) => boolean;
    readonly resolve: (message: ServerMessage) => void;
  }> = [];

  public constructor(room: ClientRoom) {
    room.onMessage<unknown>(SERVER_PROTOCOL_MESSAGE, (raw) => {
      const parsed = serverMessageSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Server emitted an invalid protocol message.");
      }
      const index = this.#waiters.findIndex((waiter) =>
        waiter.predicate(parsed.data),
      );
      if (index === -1) {
        this.#messages.push(parsed.data);
        return;
      }
      this.#waiters.splice(index, 1)[0]?.resolve(parsed.data);
    });
  }

  public next(
    predicate: (message: ServerMessage) => boolean,
    label = "server message",
  ): Promise<ServerMessage> {
    const index = this.#messages.findIndex(predicate);
    if (index !== -1) {
      const message = this.#messages.splice(index, 1)[0];
      if (message !== undefined) return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.#waiters.push(waiter);
      const timeout = setTimeout(() => {
        const waiterIndex = this.#waiters.indexOf(waiter);
        if (waiterIndex !== -1) this.#waiters.splice(waiterIndex, 1);
        const pending = this.#messages.map((message) =>
          message.type === "command.rejected"
            ? `${message.type}:${message.commandId ?? "none"}:${message.code}`
            : message.type === "match.snapshot"
              ? `${message.type}:${message.revision}`
              : message.type,
        );
        reject(
          new Error(
            `Timed out waiting for ${label}; pending=${pending.join(",")}.`,
          ),
        );
      }, 5_000);
      waiter.resolve = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };
    });
  }
}

class LifecycleInbox {
  readonly #messages: RoomLifecycleState[] = [];
  readonly #waiters: Array<{
    readonly predicate: (message: RoomLifecycleState) => boolean;
    readonly resolve: (message: RoomLifecycleState) => void;
  }> = [];

  public constructor(room: ClientRoom) {
    room.onMessage<unknown>(ROOM_CONTROL_MESSAGE, (raw) => {
      const parsed = roomLifecycleStateSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("Server emitted an invalid room lifecycle message.");
      }
      const index = this.#waiters.findIndex((waiter) =>
        waiter.predicate(parsed.data),
      );
      if (index === -1) {
        this.#messages.push(parsed.data);
        return;
      }
      this.#waiters.splice(index, 1)[0]?.resolve(parsed.data);
    });
  }

  public next(
    predicate: (message: RoomLifecycleState) => boolean,
    label = "room lifecycle",
  ): Promise<RoomLifecycleState> {
    const index = this.#messages.findIndex(predicate);
    if (index !== -1) {
      const message = this.#messages.splice(index, 1)[0];
      if (message !== undefined) return Promise.resolve(message);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.#waiters.push(waiter);
      const timeout = setTimeout(() => {
        const waiterIndex = this.#waiters.indexOf(waiter);
        if (waiterIndex !== -1) this.#waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for ${label}.`));
      }, 5_000);
      waiter.resolve = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };
    });
  }
}

function command(
  commandId: string,
  expectedRevision: number,
  action: unknown,
  roundNumber?: number,
): GameActionCommand {
  return {
    type: "game.action",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    ...(roundNumber === undefined ? {} : { roundNumber }),
    expectedRevision,
    action,
  };
}

function controlCommand(
  commandId: string,
  operation: RoomControlOperation,
): RoomControlCommand {
  return {
    type: "room.control",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    operation,
  };
}

describe("real PostgreSQL authoritative persistence", () => {
  it("persists only accepted actions and rebuilds completed history after shutdown", async () => {
    const isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
    const issuer = "database-integration-web";
    const secret = "database-integration-ticket-secret-at-least-32-bytes";
    const tickets = createHmacGameServerTicketAuthority({
      issuer,
      secret,
      lifetimeSeconds: 60,
    });
    const app = createProductionGameServer(
      {
        applicationEnvironment: "test",
        databaseMode: "postgres",
        databaseUrl: isolated.url,
        hostname: "127.0.0.1",
        port: 0,
        ticketIssuer: issuer,
        ticketSecret: secret,
        allowedWebOrigins: ["http://127.0.0.1:3000"],
        reconnectGraceMilliseconds: 0,
      },
      {
        ids: createDeterministicRuntimeIdSource(["PERS2345"]),
        logger: { write: () => undefined },
      },
    );
    let roomA: ClientRoom | undefined;
    let roomB: ClientRoom | undefined;
    try {
      const address = await app.start();
      const clientA = new ColyseusClient(address.httpUrl);
      const clientB = new ColyseusClient(address.httpUrl);
      roomA = await clientA.create(GAME_ROOM_NAME, {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-guest-a"),
        gameId: "tic-tac-toe",
        initialConfig: null,
      });
      const inboxA = new MessageInbox(roomA);
      await inboxA.next(
        (message) => message.type === "room.connected",
        "creator connection",
      );
      await inboxA.next(
        (message) => message.type === "match.snapshot",
        "creator waiting snapshot",
      );
      const activeA = inboxA.next(
        (message) =>
          message.type === "match.snapshot" && message.status === "active",
        "creator active snapshot",
      );
      roomB = await clientB.join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-guest-b"),
        roomCode: "PERS2345",
      });
      const inboxB = new MessageInbox(roomB);
      await Promise.all([
        activeA,
        inboxB.next(
          (message) => message.type === "room.connected",
          "joiner connection",
        ),
        inboxB.next(
          (message) =>
            message.type === "match.snapshot" && message.status === "active",
          "joiner active snapshot",
        ),
      ]);

      roomA.send(GAME_ACTION_MESSAGE, {
        ...command("forged-actor", 0, {
          type: "PLACE_MARK",
          cell: 0,
        }),
        actorSlotId: "slot-2",
      });
      await inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.code === "INVALID_ACTION_PAYLOAD",
        "forged actor rejection",
      );
      roomA.send(
        GAME_ACTION_MESSAGE,
        command("accepted-1", 0, { type: "PLACE_MARK", cell: 0 }),
      );
      await inboxA.next(
        (message) =>
          message.type === "match.snapshot" &&
          message.causedByCommandId === "accepted-1",
        "first accepted snapshot",
      );
      roomA.send(
        GAME_ACTION_MESSAGE,
        command("accepted-1", 0, { type: "PLACE_MARK", cell: 0 }),
      );
      await inboxA.next(
        (message) =>
          message.type === "match.snapshot" &&
          message.causedByCommandId === "accepted-1",
        "duplicate command result",
      );
      roomB.send(
        GAME_ACTION_MESSAGE,
        command("stale", 0, { type: "PLACE_MARK", cell: 3 }),
      );
      await inboxB.next(
        (message) =>
          message.type === "command.rejected" && message.commandId === "stale",
        "stale revision rejection",
      );
      roomA.send(
        GAME_ACTION_MESSAGE,
        command("rule-rejected", 1, {
          type: "PLACE_MARK",
          cell: 1,
        }),
      );
      await inboxA.next(
        (message) =>
          message.type === "command.rejected" &&
          message.commandId === "rule-rejected",
        "game rule rejection",
      );

      const accepted = async (
        room: ClientRoom,
        inbox: MessageInbox,
        id: string,
        revision: number,
        cell: number,
      ) => {
        room.send(
          GAME_ACTION_MESSAGE,
          command(id, revision, { type: "PLACE_MARK", cell }),
        );
        await inbox.next(
          (message) =>
            message.type === "match.snapshot" &&
            message.causedByCommandId === id,
          `${id} accepted snapshot`,
        );
      };
      await accepted(roomB, inboxB, "accepted-2", 1, 3);
      await accepted(roomA, inboxA, "accepted-3", 2, 1);
      await accepted(roomB, inboxB, "accepted-4", 3, 4);
      await accepted(roomA, inboxA, "accepted-5", 4, 2);

      const stored = await app.roomStore.getByRoomCode("PERS2345");
      expect(stored).toMatchObject({ status: "completed", revision: 5 });
      const replay = await app.replayStore.get(stored?.replayId ?? "");
      expect(replay?.actions).toHaveLength(5);
      expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
        status: "verified",
      });
      await roomA.leave();
      await roomB.leave();
      roomA = undefined;
      roomB = undefined;
      await app.stop();

      const rebuiltClient = createPostgresDatabaseClient({
        url: isolated.url,
        applicationName: "game-server-database-integration-rebuilt",
        maxConnections: 2,
      });
      try {
        const rebuiltReplay = await new PostgresReplayStore(
          rebuiltClient.database,
        ).get(stored?.replayId ?? "");
        expect(rebuiltReplay?.actions).toHaveLength(5);
        expect(
          verifyReplay(rebuiltReplay, resolveGameDefinition),
        ).toMatchObject({ status: "verified" });
        const matches = new PostgresMatchRepository(rebuiltClient.database);
        await expect(matches.listForGuest("database-guest-a")).resolves.toEqual(
          [
            expect.objectContaining({
              status: "completed",
              finalRevision: 5,
              playerSlotId: "slot-1",
              replayAvailable: true,
            }),
          ],
        );
        await expect(matches.listForGuest("database-guest-b")).resolves.toEqual(
          [
            expect.objectContaining({
              status: "completed",
              playerSlotId: "slot-2",
            }),
          ],
        );
        await expect(
          matches.listForGuest("database-unrelated-guest"),
        ).resolves.toEqual([]);
      } finally {
        await rebuiltClient.close();
      }
    } finally {
      await roomA?.leave().catch(() => undefined);
      await roomB?.leave().catch(() => undefined);
      await app.stop().catch(() => undefined);
      await isolated.close();
    }
  }, 120_000);

  it("persists two Connect Four rounds and rebuilds exact replays plus safe history from a new connection", async () => {
    const isolated = await createIsolatedTestDatabase(
      requireTestDatabaseUrl(process.env),
    );
    const issuer = "connect-four-database-integration-web";
    const secret = "connect-four-database-ticket-secret-at-least-32-bytes";
    const tickets = createHmacGameServerTicketAuthority({
      issuer,
      secret,
      lifetimeSeconds: 60,
    });
    const app = createProductionGameServer(
      {
        applicationEnvironment: "test",
        databaseMode: "postgres",
        databaseUrl: isolated.url,
        hostname: "127.0.0.1",
        port: 0,
        ticketIssuer: issuer,
        ticketSecret: secret,
        allowedWebOrigins: ["http://127.0.0.1:3000"],
        reconnectGraceMilliseconds: 0,
      },
      {
        ids: createDeterministicRuntimeIdSource(["CFDB2345", "CFAB2345"]),
        logger: { write: () => undefined },
      },
    );
    let roomA: ClientRoom | undefined;
    let roomB: ClientRoom | undefined;
    let abandonedRoomA: ClientRoom | undefined;
    let abandonedRoomB: ClientRoom | undefined;
    try {
      const address = await app.start();
      roomA = await new ColyseusClient(address.httpUrl).create(GAME_ROOM_NAME, {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-connect-four-a"),
        gameId: "connect-four",
        initialConfig: null,
      });
      const inboxA = new MessageInbox(roomA);
      const lifecycleA = new LifecycleInbox(roomA);
      await inboxA.next(
        (message) => message.type === "room.connected",
        "Connect Four creator connection",
      );
      await inboxA.next(
        (message) => message.type === "match.snapshot",
        "Connect Four waiting snapshot",
      );
      const activeA = inboxA.next(
        (message) =>
          message.type === "match.snapshot" && message.status === "active",
        "Connect Four creator active snapshot",
      );
      roomB = await new ColyseusClient(address.httpUrl).join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-connect-four-b"),
        roomCode: "CFDB2345",
      });
      const inboxB = new MessageInbox(roomB);
      const lifecycleB = new LifecycleInbox(roomB);
      await Promise.all([
        activeA,
        inboxB.next(
          (message) => message.type === "room.connected",
          "Connect Four joiner connection",
        ),
        inboxB.next(
          (message) =>
            message.type === "match.snapshot" && message.status === "active",
          "Connect Four joiner active snapshot",
        ),
      ]);

      const acceptedDrop = async (
        room: ClientRoom,
        inbox: MessageInbox,
        id: string,
        revision: number,
        column: number,
        roundNumber: number,
      ): Promise<void> => {
        room.send(
          GAME_ACTION_MESSAGE,
          command(id, revision, { type: "DROP_DISC", column }, roundNumber),
        );
        await inbox.next(
          (message) =>
            message.type === "match.snapshot" &&
            message.causedByCommandId === id,
          `${id} accepted snapshot`,
        );
      };

      const winningColumns = [0, 0, 1, 1, 2, 2, 3] as const;
      for (const [index, column] of winningColumns.entries()) {
        await acceptedDrop(
          index % 2 === 0 ? roomA : roomB,
          index % 2 === 0 ? inboxA : inboxB,
          `connect-four-round-1-${index + 1}`,
          index,
          column,
          1,
        );
      }
      const storedRoundOne = await app.roomStore.getByRoomCode("CFDB2345");
      const replayRoundOneId = storedRoundOne?.replayId ?? "";
      expect(storedRoundOne).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.0.0",
        roundNumber: 1,
        revision: 7,
        status: "completed",
      });

      await Promise.all([
        lifecycleA.next(
          (message) => message.rematch.available,
          "round one rematch lifecycle for creator",
        ),
        lifecycleB.next(
          (message) => message.rematch.available,
          "round one rematch lifecycle for joiner",
        ),
      ]);
      roomA.send(
        ROOM_CONTROL_MESSAGE,
        controlCommand("connect-four-ready-a", "REQUEST_REMATCH"),
      );
      await lifecycleA.next(
        (message) => message.causedByCommandId === "connect-four-ready-a",
        "creator ready",
      );
      const roundTwoLifecycleA = lifecycleA.next(
        (message) => message.roundNumber === 2,
        "creator round two lifecycle",
      );
      const roundTwoLifecycleB = lifecycleB.next(
        (message) =>
          message.roundNumber === 2 &&
          message.causedByCommandId === "connect-four-ready-b",
        "joiner round two lifecycle",
      );
      const roundTwoSnapshotA = inboxA.next(
        (message) =>
          message.type === "match.snapshot" &&
          message.roundNumber === 2 &&
          message.revision === 0,
        "creator round two snapshot",
      );
      const roundTwoSnapshotB = inboxB.next(
        (message) =>
          message.type === "match.snapshot" &&
          message.roundNumber === 2 &&
          message.revision === 0,
        "joiner round two snapshot",
      );
      roomB.send(
        ROOM_CONTROL_MESSAGE,
        controlCommand("connect-four-ready-b", "REQUEST_REMATCH"),
      );
      await Promise.all([
        roundTwoLifecycleA,
        roundTwoLifecycleB,
        roundTwoSnapshotA,
        roundTwoSnapshotB,
      ]);
      for (const [index, column] of winningColumns.entries()) {
        await acceptedDrop(
          index % 2 === 0 ? roomA : roomB,
          index % 2 === 0 ? inboxA : inboxB,
          `connect-four-round-2-${index + 1}`,
          index,
          column,
          2,
        );
      }
      const storedRoundTwo = await app.roomStore.getByRoomCode("CFDB2345");
      const replayRoundTwoId = storedRoundTwo?.replayId ?? "";
      expect(storedRoundTwo).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.0.0",
        roundNumber: 2,
        revision: 7,
        status: "completed",
      });
      expect(replayRoundTwoId).not.toBe(replayRoundOneId);

      abandonedRoomA = await new ColyseusClient(address.httpUrl).create(
        GAME_ROOM_NAME,
        {
          type: "room.create",
          protocolVersion: PROTOCOL_VERSION,
          ticket: tickets.issue("database-connect-four-abandoned-a"),
          gameId: "connect-four",
          initialConfig: null,
        },
      );
      const abandonedInboxA = new MessageInbox(abandonedRoomA);
      await abandonedInboxA.next(
        (message) => message.type === "room.connected",
        "abandoned creator connection",
      );
      const abandonedActiveA = abandonedInboxA.next(
        (message) =>
          message.type === "match.snapshot" && message.status === "active",
        "abandoned creator active snapshot",
      );
      abandonedRoomB = await new ColyseusClient(address.httpUrl).join(
        GAME_ROOM_NAME,
        {
          type: "room.join",
          protocolVersion: PROTOCOL_VERSION,
          ticket: tickets.issue("database-connect-four-abandoned-b"),
          roomCode: "CFAB2345",
        },
      );
      await abandonedActiveA;
      await abandonedRoomB.leave(true);
      abandonedRoomB = undefined;
      await abandonedInboxA.next(
        (message) =>
          message.type === "match.snapshot" && message.status === "abandoned",
        "abandoned snapshot",
      );
      const abandonedStored = await app.roomStore.getByRoomCode("CFAB2345");
      const abandonedReplayId = abandonedStored?.replayId ?? "";
      expect(abandonedStored).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.0.0",
        roundNumber: 1,
        revision: 0,
        status: "abandoned",
      });

      await roomA.leave();
      await roomB.leave();
      await abandonedRoomA.leave().catch(() => undefined);
      roomA = undefined;
      roomB = undefined;
      abandonedRoomA = undefined;
      await app.stop();

      const rebuiltClient = createPostgresDatabaseClient({
        url: isolated.url,
        applicationName: "connect-four-database-integration-rebuilt",
        maxConnections: 2,
      });
      try {
        const rebuiltReplays = new PostgresReplayStore(rebuiltClient.database);
        for (const replayId of [replayRoundOneId, replayRoundTwoId]) {
          const replay = await rebuiltReplays.get(replayId);
          expect(replay?.header).toMatchObject({
            replayFormatVersion: 1,
            gameId: "connect-four",
            gameVersion: "1.0.0",
          });
          expect(replay?.actions).toHaveLength(7);
          expect(verifyReplay(replay, resolveGameDefinition)).toMatchObject({
            status: "verified",
            rng: { cursor: 0 },
            outcome: { type: "WIN", winnerSlotId: "slot-1" },
          });
        }
        await expect(
          rebuiltReplays.get(abandonedReplayId),
        ).resolves.toMatchObject({
          actions: [],
          recordedRngCursor: null,
          recordedOutcome: null,
        });

        const matches = new PostgresMatchRepository(rebuiltClient.database);
        const history = await matches.listForGuest("database-connect-four-a");
        expect(history).toHaveLength(2);
        expect(history.map((item) => item.roundNumber).sort()).toEqual([1, 2]);
        expect(new Set(history.map((item) => item.matchId)).size).toBe(2);
        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              gameId: "connect-four",
              gameVersion: "1.0.0",
              roundNumber: 1,
              status: "completed",
              finalRevision: 7,
              playerSlotId: "slot-1",
              replayAvailable: true,
            }),
            expect.objectContaining({
              gameId: "connect-four",
              gameVersion: "1.0.0",
              roundNumber: 2,
              status: "completed",
              finalRevision: 7,
              playerSlotId: "slot-1",
              replayAvailable: true,
            }),
          ]),
        );
        const serializedHistory = JSON.stringify(history);
        for (const forbidden of [
          "board",
          "actions",
          "recordedOutcome",
          "seed",
          "database-connect-four-b",
        ]) {
          expect(serializedHistory).not.toContain(forbidden);
        }
        await expect(
          matches.listForGuest("database-connect-four-unrelated"),
        ).resolves.toEqual([]);
        await expect(
          matches.listForGuest("database-connect-four-abandoned-a"),
        ).resolves.toEqual([
          expect.objectContaining({
            gameId: "connect-four",
            gameVersion: "1.0.0",
            roundNumber: 1,
            status: "abandoned",
            finalRevision: 0,
            replayAvailable: false,
          }),
        ]);
      } finally {
        await rebuiltClient.close();
      }
    } finally {
      await roomA?.leave().catch(() => undefined);
      await roomB?.leave().catch(() => undefined);
      await abandonedRoomA?.leave().catch(() => undefined);
      await abandonedRoomB?.leave().catch(() => undefined);
      await app.stop().catch(() => undefined);
      await isolated.close();
    }
  }, 120_000);
});
