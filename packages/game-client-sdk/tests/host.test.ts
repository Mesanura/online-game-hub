import {
  GAME_ACTION_MESSAGE,
  PROTOCOL_VERSION,
  ROOM_CONTROL_MESSAGE,
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
  readonly leaveConsents: boolean[] = [];

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

  public async leave(consented = true): Promise<number> {
    this.left = true;
    this.leaveConsents.push(consented);
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

  public emitLifecycle(payload: unknown): void {
    for (const handler of this.#messageHandlers.get(ROOM_CONTROL_MESSAGE) ??
      []) {
      handler(payload);
    }
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

function snapshot(
  revision: number,
  causedByCommandId?: string,
  roundNumber = 1,
) {
  return {
    type: "match.snapshot",
    protocolVersion: PROTOCOL_VERSION,
    gameId: "tic-tac-toe",
    gameVersion: "1.0.0",
    roundNumber,
    revision,
    status: "active",
    viewer: { kind: "player", slotId: "slot-1" },
    view: { board: Array<null>(9).fill(null) },
    outcome: null,
    ...(causedByCommandId === undefined ? {} : { causedByCommandId }),
  } as const;
}

function lifecycle(
  roundNumber: number,
  options: {
    readonly causedByCommandId?: string;
    readonly selfReady?: boolean;
    readonly readyPlayerCount?: number;
    readonly closed?: boolean;
    readonly closeReason?: "OWNER_CLOSED" | null;
  } = {},
) {
  const closed = options.closed ?? false;
  return {
    type: "room.lifecycle",
    protocolVersion: PROTOCOL_VERSION,
    roundNumber,
    isOwner: true,
    rematch: {
      available: !closed,
      selfReady: options.selfReady ?? false,
      readyPlayerCount: options.readyPlayerCount ?? 0,
      requiredPlayerCount: 2,
    },
    closed,
    closeReason: options.closeReason ?? null,
    ...(options.causedByCommandId === undefined
      ? {}
      : { causedByCommandId: options.causedByCommandId }),
  } as const;
}

describe("GameClientHost", () => {
  it("starts idle before any room intent", () => {
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([]),
    });
    expect(host.getState()).toEqual({
      connectionState: "idle",
      room: null,
      snapshot: null,
      roomLifecycle: null,
      rejection: null,
      error: null,
    });
  });

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
          roundNumber: 1,
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

  it("sends control commands, resets revision on a new round, and suppresses reconnect after close", async () => {
    const room = new FakeRoom();
    const ids = ["ready-1", "cancel-1", "ready-2", "round-2-action", "close-1"];
    let idIndex = 0;
    let ticketCount = 0;
    const host = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => `ticket-${++ticketCount}`,
      transport: new FakeTransport([room]),
      commandIds: {
        createCommandId: () => ids[idIndex++] ?? "unexpected-command",
      },
    });
    await host.joinRoom("tic-tac-toe", "ABCD2345");
    room.emit(connected);
    room.emitLifecycle(lifecycle(1));
    room.emit(snapshot(5));

    const firstReady = host.requestRematch();
    expect(room.sent.at(-1)).toEqual({
      type: ROOM_CONTROL_MESSAGE,
      payload: {
        type: "room.control",
        protocolVersion: PROTOCOL_VERSION,
        commandId: "ready-1",
        operation: "REQUEST_REMATCH",
      },
    });
    room.emitLifecycle(
      lifecycle(1, {
        causedByCommandId: "ready-1",
        selfReady: true,
        readyPlayerCount: 1,
      }),
    );
    await expect(firstReady).resolves.toBeUndefined();

    const cancelReady = host.cancelRematch();
    expect(room.sent.at(-1)).toMatchObject({
      type: ROOM_CONTROL_MESSAGE,
      payload: { commandId: "cancel-1", operation: "CANCEL_REMATCH" },
    });
    room.emitLifecycle(
      lifecycle(1, {
        causedByCommandId: "cancel-1",
      }),
    );
    await expect(cancelReady).resolves.toBeUndefined();

    const secondReady = host.requestRematch();
    room.emitLifecycle(
      lifecycle(2, {
        causedByCommandId: "ready-2",
      }),
    );
    await expect(secondReady).resolves.toBeUndefined();
    expect(host.getState()).toMatchObject({
      roomLifecycle: { roundNumber: 2 },
      snapshot: null,
    });
    room.emit(snapshot(5));
    expect(host.getState().snapshot).toBeNull();
    room.emit(snapshot(0, undefined, 2));
    expect(host.getState().snapshot?.revision).toBe(0);

    const roundTwoAction = host.submitAction({
      type: "PLACE_MARK",
      cell: 0,
    });
    expect(room.sent.at(-1)).toMatchObject({
      type: GAME_ACTION_MESSAGE,
      payload: {
        commandId: "round-2-action",
        roundNumber: 2,
        expectedRevision: 0,
      },
    });
    room.emit(snapshot(1, "round-2-action", 2));
    await expect(roundTwoAction).resolves.toBeUndefined();

    const close = host.closeRoom();
    room.emitLifecycle(
      lifecycle(2, {
        causedByCommandId: "close-1",
        closed: true,
        closeReason: "OWNER_CLOSED",
      }),
    );
    await expect(close).resolves.toBeUndefined();
    expect(host.getState()).toMatchObject({
      connectionState: "idle",
      room: null,
      snapshot: null,
      roomLifecycle: { closed: true, closeReason: "OWNER_CLOSED" },
      error: null,
    });
    room.disconnect();
    await Promise.resolve();
    expect(ticketCount).toBe(1);
  });

  it("uses consented leave only for an explicit user departure", async () => {
    const explicitRoom = new FakeRoom();
    const explicitHost = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([explicitRoom]),
    });
    await explicitHost.joinRoom("tic-tac-toe", "ABCD2345");
    await explicitHost.leaveRoom();
    expect(explicitRoom.leaveConsents).toEqual([true]);
    expect(explicitHost.getState()).toMatchObject({
      connectionState: "idle",
      room: null,
      roomLifecycle: null,
    });

    const cleanupRoom = new FakeRoom();
    const cleanupHost = new GameClientHost({
      gameServerUrl: "http://127.0.0.1:1234",
      ticketProvider: async () => "ticket-1",
      transport: new FakeTransport([cleanupRoom]),
    });
    await cleanupHost.joinRoom("tic-tac-toe", "ABCD2345");
    await cleanupHost.close();
    expect(cleanupRoom.leaveConsents).toEqual([false]);
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
      roomLifecycle: null,
      rejection: null,
      error: {
        code: "INVALID_SERVER_MESSAGE",
        message: "The Game Server sent an invalid protocol message.",
      },
    });
    expect(JSON.stringify(host.getState())).not.toContain("secret-ticket");
  });
});
