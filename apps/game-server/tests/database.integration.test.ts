import { Client as ColyseusClient } from "@colyseus/sdk";
import type { Room as ClientRoom } from "@colyseus/sdk";
import {
  PostgresMatchRepository,
  PostgresReplayStore,
  PostgresUserRepository,
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
  StarterChoice,
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
  roundNumber = 1,
): GameActionCommand {
  return {
    type: "game.action",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    roundNumber,
    expectedRevision,
    action,
  };
}

function controlCommand(
  commandId: string,
  operation: RoomControlOperation,
  starter?: StarterChoice,
): RoomControlCommand {
  if (operation === "SELECT_STARTER") {
    if (starter === undefined) {
      throw new Error("SELECT_STARTER requires a starter.");
    }
    return {
      type: "room.control",
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      operation,
      starter,
    };
  }
  return {
    type: "room.control",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    operation,
  };
}

function startRound(
  ownerRoom: ClientRoom,
  nonOwnerRoom: ClientRoom,
  commandPrefix: string,
  starter: StarterChoice = "OWNER",
): void {
  ownerRoom.send(
    ROOM_CONTROL_MESSAGE,
    controlCommand(`${commandPrefix}-starter`, "SELECT_STARTER", starter),
  );
  ownerRoom.send(
    ROOM_CONTROL_MESSAGE,
    controlCommand(`${commandPrefix}-owner-ready`, "READY_FOR_ROUND"),
  );
  nonOwnerRoom.send(
    ROOM_CONTROL_MESSAGE,
    controlCommand(`${commandPrefix}-non-owner-ready`, "READY_FOR_ROUND"),
  );
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
      const users = new PostgresUserRepository(isolated.client.database);
      const accountA = await users.createUser();
      const unrelatedAccount = await users.createUser();
      const clientA = new ColyseusClient(address.httpUrl);
      const clientB = new ColyseusClient(address.httpUrl);
      roomA = await clientA.create(GAME_ROOM_NAME, {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-account-a", accountA.userId),
        gameId: "tic-tac-toe",
        initialConfig: null,
      });
      const inboxA = new MessageInbox(roomA);
      await inboxA.next(
        (message) => message.type === "room.connected",
        "creator connection",
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
      await inboxB.next(
        (message) => message.type === "room.connected",
        "joiner connection",
      );
      startRound(roomA, roomB, "database-tic-tac-toe-round-1");
      await Promise.all([
        activeA,
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
      expect(stored).toMatchObject({
        currentRound: { status: "completed", revision: 5 },
      });
      const replay = await app.replayStore.get(
        stored?.currentRound?.replayId ?? "",
      );
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
        ).get(stored?.currentRound?.replayId ?? "");
        expect(rebuiltReplay?.actions).toHaveLength(5);
        expect(
          verifyReplay(rebuiltReplay, resolveGameDefinition),
        ).toMatchObject({ status: "verified" });
        const matches = new PostgresMatchRepository(rebuiltClient.database);
        await expect(matches.listForUser(accountA.userId)).resolves.toEqual([
          expect.objectContaining({
            status: "completed",
            finalRevision: 5,
            playerSlotId: "slot-1",
            replayAvailable: true,
          }),
        ]);
        await expect(
          matches.listForUser(unrelatedAccount.userId),
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
      const users = new PostgresUserRepository(isolated.client.database);
      const accountA = await users.createUser();
      const accountB = await users.createUser();
      const abandonedAccount = await users.createUser();
      const unrelatedAccount = await users.createUser();
      roomA = await new ColyseusClient(address.httpUrl).create(GAME_ROOM_NAME, {
        type: "room.create",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-connect-four-a", accountA.userId),
        gameId: "connect-four",
        initialConfig: null,
      });
      const inboxA = new MessageInbox(roomA);
      const lifecycleA = new LifecycleInbox(roomA);
      await inboxA.next(
        (message) => message.type === "room.connected",
        "Connect Four creator connection",
      );
      const activeA = inboxA.next(
        (message) =>
          message.type === "match.snapshot" && message.status === "active",
        "Connect Four creator active snapshot",
      );
      roomB = await new ColyseusClient(address.httpUrl).join(GAME_ROOM_NAME, {
        type: "room.join",
        protocolVersion: PROTOCOL_VERSION,
        ticket: tickets.issue("database-connect-four-b", accountB.userId),
        roomCode: "CFDB2345",
      });
      const inboxB = new MessageInbox(roomB);
      const lifecycleB = new LifecycleInbox(roomB);
      await inboxB.next(
        (message) => message.type === "room.connected",
        "Connect Four joiner connection",
      );
      startRound(roomA, roomB, "database-connect-four-round-1");
      await Promise.all([
        activeA,
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
      const replayRoundOneId = storedRoundOne?.currentRound?.replayId ?? "";
      expect(storedRoundOne).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.1.0",
        currentRound: { roundNumber: 1, revision: 7, status: "completed" },
      });

      await Promise.all([
        lifecycleA.next(
          (message) => message.nextRound?.roundNumber === 2,
          "round one rematch lifecycle for creator",
        ),
        lifecycleB.next(
          (message) => message.nextRound?.roundNumber === 2,
          "round one rematch lifecycle for joiner",
        ),
      ]);
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
      startRound(roomA, roomB, "database-connect-four-round-2");
      await Promise.all([roundTwoSnapshotA, roundTwoSnapshotB]);
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
      const replayRoundTwoId = storedRoundTwo?.currentRound?.replayId ?? "";
      expect(storedRoundTwo).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.1.0",
        currentRound: { roundNumber: 2, revision: 7, status: "completed" },
      });
      expect(replayRoundTwoId).not.toBe(replayRoundOneId);

      abandonedRoomA = await new ColyseusClient(address.httpUrl).create(
        GAME_ROOM_NAME,
        {
          type: "room.create",
          protocolVersion: PROTOCOL_VERSION,
          ticket: tickets.issue(
            "database-connect-four-abandoned-a",
            abandonedAccount.userId,
          ),
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
      const abandonedInboxB = new MessageInbox(abandonedRoomB);
      await abandonedInboxB.next(
        (message) => message.type === "room.connected",
        "abandoned joiner connection",
      );
      startRound(
        abandonedRoomA,
        abandonedRoomB,
        "database-connect-four-abandoned-round-1",
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
      const abandonedReplayId = abandonedStored?.currentRound?.replayId ?? "";
      expect(abandonedStored).toMatchObject({
        gameId: "connect-four",
        gameVersion: "1.1.0",
        currentRound: { roundNumber: 1, revision: 0, status: "abandoned" },
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
            gameVersion: "1.1.0",
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
        const history = await matches.listForUser(accountA.userId);
        expect(history).toHaveLength(2);
        expect(history.map((item) => item.roundNumber).sort()).toEqual([1, 2]);
        expect(new Set(history.map((item) => item.matchId)).size).toBe(2);
        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              gameId: "connect-four",
              gameVersion: "1.1.0",
              roundNumber: 1,
              status: "completed",
              finalRevision: 7,
              playerSlotId: "slot-1",
              replayAvailable: true,
            }),
            expect.objectContaining({
              gameId: "connect-four",
              gameVersion: "1.1.0",
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
          matches.listForUser(unrelatedAccount.userId),
        ).resolves.toEqual([]);
        await expect(
          matches.listForUser(abandonedAccount.userId),
        ).resolves.toEqual([
          expect.objectContaining({
            gameId: "connect-four",
            gameVersion: "1.1.0",
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
