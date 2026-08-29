import {
  GAME_ACTION_MESSAGE,
  PROTOCOL_VERSION,
  SERVER_PROTOCOL_MESSAGE,
} from "@online-game-hub/protocol";
import { describe, expect, it } from "vitest";

import { CommandRejectedError, GameClientHost } from "../src/host.js";
import type {
  GameTransportClient,
  GameTransportFactory,
  GameTransportRoom,
} from "../src/host.js";

class FakeRoom implements GameTransportRoom {
  readonly sent: {
    readonly type: string | number;
    readonly payload: unknown;
  }[] = [];
  readonly #messageHandlers = new Map<
    string | number,
    ((payload: unknown) => void)[]
  >();
  readonly #leaveHandlers: ((code: number, reason?: string) => void)[] = [];
  public left = false;

  public onMessage<Payload>(
    type: string | number,
    callback: (payload: Payload) => void,
  ): () => void {
    const handlers = this.#messageHandlers.get(type) ?? [];
    const erased = callback as (payload: unknown) => void;
    handlers.push(erased);
    this.#messageHandlers.set(type, handlers);
    return () => {
      const index = handlers.indexOf(erased);
      if (index !== -1) handlers.splice(index, 1);
    };
  }

  public onLeave(callback: (code: number, reason?: string) => void): void {
    this.#leaveHandlers.push(callback);
  }

  public send<Payload>(type: string | number, payload: Payload): void {
    this.sent.push({ type, payload });
  }

  public async leave(): Promise<number> {
    this.left = true;
    return 1000;
  }

  public emit(payload: unknown): void {
    for (const handler of this.#messageHandlers.get(SERVER_PROTOCOL_MESSAGE) ??
      []) {
      handler(payload);
    }
  }

  public disconnect(): void {
    for (const handler of this.#leaveHandlers) handler(1006, "network");
  }
}

class FakeClient implements GameTransportClient {
  readonly requests: {
    readonly method: "create" | "join";
    readonly roomName: string;
    readonly options: unknown;
  }[] = [];

  public constructor(readonly rooms: FakeRoom[]) {}

  public async create(roomName: string, options: unknown): Promise<FakeRoom> {
    this.requests.push({ method: "create", roomName, options });
    const room = this.rooms.shift();
    if (room === undefined) throw new Error("No fake room.");
    return room;
  }

  public async join(roomName: string, options: unknown): Promise<FakeRoom> {
    this.requests.push({ method: "join", roomName, options });
    const room = this.rooms.shift();
    if (room === undefined) throw new Error("No fake room.");
    return room;
  }
}

class FakeTransport implements GameTransportFactory {
  readonly clients: FakeClient[] = [];

  public constructor(private readonly rooms: FakeRoom[]) {}

  public createClient(): FakeClient {
    const client = new FakeClient(this.rooms);
    this.clients.push(client);
    return client;
  }
}

const connected = {
  type: "room.connected",
  protocolVersion: PROTOCOL_VERSION,
  roomCode: "ABCD2345",
  gameId: "tic-tac-toe",
  gameVersion: "1.0.0",
  playerSlotId: "slot-1",
} as const;

function snapshot(revision: number, causedByCommandId?: string) {
  return {
    type: "match.snapshot",
    protocolVersion: PROTOCOL_VERSION,
    gameId: "tic-tac-toe",
    gameVersion: "1.0.0",
    revision,
    status: "active",
    viewer: { kind: "player", slotId: "slot-1" },
    view: { board: Array<null>(9).fill(null) },
    outcome: null,
    ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
  } as const;
}

describe("GameClientHost", () => {
  it("normalizes join codes before matchmaking and applies validated snapshots", async () => {
    const room = new FakeRoom();
    const transport = new FakeTransport([room]);
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport,
    });

    await host.joinRoom("tic-tac-toe", "  abcd2345  ");
    expect(transport.clients[0]?.requests).toEqual([
      {
        method: "join",
        roomName: "game",
        options: {
          type: "room.join",
          protocolVersion: PROTOCOL_VERSION,
          ticket: "ticket-1",
          roomCode: "ABCD2345",
        },
      },
    ]);
    room.emit(connected);
    room.emit(snapshot(0));
    expect(host.getState()).toMatchObject({
      connectionState: "connected",
      room: { playerSlotId: "slot-1" },
      snapshot: { revision: 0 },
      error: null,
    });
  });

  it("adds command ids and the latest authoritative revision", async () => {
    const room = new FakeRoom();
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([room]),
      commandIds: { createCommandId: () => "command-1" },
    });
    await host.createRoom("tic-tac-toe", null);
    room.emit(connected);
    room.emit(snapshot(4));
    const submitted = host.submitAction({ type: "PLACE_MARK", cell: 2 });
    expect(room.sent).toEqual([
      {
        type: GAME_ACTION_MESSAGE,
        payload: {
          type: "game.action",
          protocolVersion: PROTOCOL_VERSION,
          commandId: "command-1",
          expectedRevision: 4,
          action: { type: "PLACE_MARK", cell: 2 },
        },
      },
    ]);
    room.emit(snapshot(5, "command-1"));
    await expect(submitted).resolves.toBeUndefined();
    expect(host.getState().snapshot?.revision).toBe(5);
  });

  it("applies stale recovery snapshots and surfaces structured rejection", async () => {
    const room = new FakeRoom();
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([room]),
      commandIds: { createCommandId: () => "stale-1" },
    });
    await host.joinRoom("tic-tac-toe", "ABCD2345");
    room.emit(connected);
    room.emit(snapshot(1));
    const submitted = host.submitAction({ type: "PLACE_MARK", cell: 0 });
    room.emit({
      type: "command.rejected",
      protocolVersion: PROTOCOL_VERSION,
      commandId: "stale-1",
      code: "STALE_REVISION",
      revision: 2,
      retryable: true,
      snapshot: snapshot(2),
    });
    await expect(submitted).rejects.toBeInstanceOf(CommandRejectedError);
    expect(host.getState()).toMatchObject({
      snapshot: { revision: 2 },
      rejection: { code: "STALE_REVISION" },
    });
  });

  it("reconnects with a fresh ticket and a new join reservation", async () => {
    const firstRoom = new FakeRoom();
    const secondRoom = new FakeRoom();
    const transport = new FakeTransport([firstRoom, secondRoom]);
    let ticketNumber = 0;
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => `ticket-${++ticketNumber}`,
      transport,
      delay: async () => undefined,
    });
    await host.joinRoom("tic-tac-toe", "ABCD2345");
    firstRoom.emit(connected);
    firstRoom.emit(snapshot(3));
    firstRoom.disconnect();
    await Promise.resolve();
    await Promise.resolve();

    expect(ticketNumber).toBe(2);
    expect(transport.clients).toHaveLength(2);
    expect(transport.clients[1]?.requests[0]).toMatchObject({
      method: "join",
      options: { ticket: "ticket-2", roomCode: "ABCD2345" },
    });
    expect(host.getState().connectionState).toBe("reconnecting");
    secondRoom.emit(connected);
    secondRoom.emit(snapshot(3));
    expect(host.getState()).toMatchObject({
      connectionState: "connected",
      room: { playerSlotId: "slot-1" },
      snapshot: { revision: 3 },
    });
  });

  it("fails closed on unknown server payload without exposing transport data", async () => {
    const room = new FakeRoom();
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([room]),
    });
    await host.joinRoom("tic-tac-toe", "ABCD2345");
    room.emit({ type: "match.snapshot", ticket: "secret-ticket" });
    expect(host.getState()).toEqual({
      connectionState: "closed",
      room: null,
      snapshot: null,
      rejection: null,
      error: {
        code: "INVALID_SERVER_MESSAGE",
        message: "The Game Server sent an invalid protocol message.",
      },
    });
    expect(JSON.stringify(host.getState())).not.toContain("secret-ticket");
  });
});
