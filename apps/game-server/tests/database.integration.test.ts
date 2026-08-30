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
  SERVER_PROTOCOL_MESSAGE,
  verifyReplay,
} from "@online-game-hub/game-server-runtime";
import {
  createDeterministicRuntimeIdSource,
} from "@online-game-hub/game-server-runtime/testing";
import { createHmacGameServerTicketAuthority } from "@online-game-hub/game-server-ticket";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
} from "@online-game-hub/protocol";
import type {
  GameActionCommand,
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

function command(
  commandId: string,
  expectedRevision: number,
  action: unknown,
): GameActionCommand {
  return {
    type: "game.action",
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    action,
  };
}

describe("real PostgreSQL authoritative persistence", () => {
  it(
    "persists only accepted actions and rebuilds completed history after shutdown",
    async () => {
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
              message.type === "match.snapshot" &&
              message.status === "active",
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
            message.type === "command.rejected" &&
            message.commandId === "stale",
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
          const matches = new PostgresMatchRepository(
            rebuiltClient.database,
          );
          await expect(
            matches.listForGuest("database-guest-a"),
          ).resolves.toEqual([
            expect.objectContaining({
              status: "completed",
              finalRevision: 5,
              playerSlotId: "slot-1",
              replayAvailable: true,
            }),
          ]);
          await expect(
            matches.listForGuest("database-guest-b"),
          ).resolves.toEqual([
            expect.objectContaining({
              status: "completed",
              playerSlotId: "slot-2",
            }),
          ]);
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
    },
    120_000,
  );
});
