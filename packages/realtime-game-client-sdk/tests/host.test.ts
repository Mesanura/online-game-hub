import { describe, expect, it } from "vitest";

import {
  GAME_SETUP_MESSAGE,
  PROTOCOL_VERSION,
  REALTIME_INPUT_MESSAGE,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
  SETUP_PROTOCOL_VERSION,
} from "@online-game-hub/protocol";

import { RealtimeGameClientHost } from "../src/index.js";
import type {
  RealtimeTransportClient,
  RealtimeTransportRoom,
} from "../src/index.js";

class FakeRoom implements RealtimeTransportRoom {
  readonly sent: Array<{
    readonly type: string | number;
    readonly payload: unknown;
  }> = [];
  readonly #handlers = new Map<
    string | number,
    Array<(payload: unknown) => void>
  >();
  #leaveHandler: ((code: number, reason?: string) => void) | null = null;

  public onMessage<Payload>(
    type: string | number,
    callback: (payload: Payload) => void,
  ): () => void {
    const handlers = this.#handlers.get(type) ?? [];
    handlers.push(callback as (payload: unknown) => void);
    this.#handlers.set(type, handlers);
    return () => undefined;
  }

  public onLeave(callback: (code: number, reason?: string) => void): void {
    this.#leaveHandler = callback;
  }

  public send<Payload>(type: string | number, payload: Payload): void {
    this.sent.push({ type, payload });
  }

  public async leave(): Promise<number> {
    return 1000;
  }

  public emit(type: string | number, payload: unknown): void {
    for (const handler of this.#handlers.get(type) ?? []) handler(payload);
  }

  public disconnect(): void {
    this.#leaveHandler?.(1006, "disconnected");
  }
}

function lifecycle() {
  return {
    type: "room.lifecycle",
    protocolVersion: PROTOCOL_VERSION,
    isOwner: true,
    currentRound: { roundNumber: 1, status: "active" },
    nextRound: null,
    closed: false,
    closeReason: null,
  } as const;
}

function connected() {
  return {
    type: "room.connected",
    protocolVersion: PROTOCOL_VERSION,
    roomCode: "ABCD2345",
    gameId: "pong",
    gameVersion: "1.0.0",
    playerSlotId: "slot-left",
  } as const;
}

function connectedV6() {
  return {
    ...connected(),
    protocolVersion: SETUP_PROTOCOL_VERSION,
  } as const;
}

function lifecycleV6(
  active: boolean,
  options: {
    readonly setupRevision?: number;
    readonly causedByCommandId?: string;
  } = {},
) {
  return {
    type: "room.lifecycle",
    protocolVersion: SETUP_PROTOCOL_VERSION,
    isOwner: true,
    currentRound: active ? { roundNumber: 1, status: "active" as const } : null,
    nextRound: active
      ? null
      : {
          roundNumber: 1,
          setupRevision: options.setupRevision ?? 0,
          setupView: {
            config: { targetScore: 3 },
            starter: options.setupRevision === 1 ? "OWNER" : "UNSELECTED",
            fixedStarterSlotId: null,
            participantSlotIds: ["slot-left", "slot-right"],
            canEdit: true,
          },
          readiness: {
            canReady: options.setupRevision === 1,
            selfReady: false,
            readySlotIds: [],
            requiredSlotIds: ["slot-left", "slot-right"],
          },
        },
    closed: false,
    closeReason: null,
    players: [
      { slotId: "slot-left", occupied: true, online: true, ready: false },
      { slotId: "slot-right", occupied: true, online: true, ready: false },
    ],
    ...(options.causedByCommandId === undefined
      ? {}
      : { causedByCommandId: options.causedByCommandId }),
  } as const;
}

function snapshot(tick: number, acknowledgedInputSequence: number) {
  return {
    type: "realtime.snapshot",
    realtimeProtocolVersion: 1,
    gameId: "pong",
    gameVersion: "1.0.0",
    roundNumber: 1,
    tick,
    viewer: { kind: "player", slotId: "slot-left" },
    view: { tick },
    outcome: null,
    acknowledgedInputSequence,
  } as const;
}

async function setup() {
  const room = new FakeRoom();
  const client: RealtimeTransportClient = {
    async create() {
      return room;
    },
    async join() {
      return room;
    },
  };
  let command = 0;
  const host = new RealtimeGameClientHost<{ readonly tick: number }>({
    gameServerUrl: "http://127.0.0.1:2567",
    ticketProvider: async () => "ticket",
    transport: { createClient: () => client },
    commandIds: { createCommandId: () => `command-${++command}` },
  });
  await host.createRoom("pong", { targetScore: 3 });
  room.emit(SERVER_PROTOCOL_MESSAGE, connected());
  room.emit(ROOM_CONTROL_MESSAGE, lifecycle());
  return { host, room };
}

describe("RealtimeGameClientHost", () => {
  it("sends sequence-only intent and resolves from authoritative ack", async () => {
    const { host, room } = await setup();
    const pending = host.submitInput({ type: "DIRECTION", direction: -1 });
    expect(room.sent.at(-1)).toMatchObject({
      type: REALTIME_INPUT_MESSAGE,
      payload: {
        type: "realtime.input",
        inputSequence: 1,
        roundNumber: 1,
        input: { type: "DIRECTION", direction: -1 },
      },
    });
    expect(room.sent.at(-1)?.payload).not.toHaveProperty("actor");
    expect(room.sent.at(-1)?.payload).not.toHaveProperty("tick");
    room.emit(REALTIME_SERVER_MESSAGE, snapshot(1, 1));
    await expect(pending).resolves.toBeUndefined();
    expect(host.getState().snapshot).toMatchObject({ tick: 1 });
  });

  it("uses V6 for setup while realtime input and snapshots remain V1", async () => {
    const room = new FakeRoom();
    const requests: unknown[] = [];
    const client: RealtimeTransportClient = {
      async create(_roomName, options) {
        requests.push(options);
        return room;
      },
      async join() {
        return room;
      },
    };
    let command = 0;
    const host = new RealtimeGameClientHost<{ readonly tick: number }>({
      gameServerUrl: "http://127.0.0.1:2567",
      ticketProvider: async () => "ticket",
      transport: { createClient: () => client },
      setupProtocol: SETUP_PROTOCOL_VERSION,
      commandIds: { createCommandId: () => `command-${++command}` },
    });
    await host.createRoom("pong", { targetScore: 3 });
    expect(requests[0]).toMatchObject({
      protocolVersion: SETUP_PROTOCOL_VERSION,
    });
    room.emit(SERVER_PROTOCOL_MESSAGE, connectedV6());
    room.emit(ROOM_CONTROL_MESSAGE, lifecycleV6(false));

    const setupCommand = host.selectStarter("OWNER");
    expect(room.sent.at(-1)).toMatchObject({
      type: GAME_SETUP_MESSAGE,
      payload: {
        protocolVersion: SETUP_PROTOCOL_VERSION,
        commandId: "command-1",
        expectedSetupRevision: 0,
        action: { type: "SELECT_STARTER", starter: "OWNER" },
      },
    });
    room.emit(
      ROOM_CONTROL_MESSAGE,
      lifecycleV6(false, {
        setupRevision: 1,
        causedByCommandId: "command-1",
      }),
    );
    await expect(setupCommand).resolves.toBeUndefined();

    const readyCommand = host.readyForRound();
    room.emit(
      ROOM_CONTROL_MESSAGE,
      lifecycleV6(true, { causedByCommandId: "command-2" }),
    );
    await expect(readyCommand).resolves.toBeUndefined();
    room.emit(REALTIME_SERVER_MESSAGE, snapshot(0, 0));
    void host.submitInput({ type: "DIRECTION", direction: 1 });
    expect(room.sent.at(-1)).toMatchObject({
      type: REALTIME_INPUT_MESSAGE,
      payload: {
        realtimeProtocolVersion: 1,
        commandId: "command-3",
        inputSequence: 1,
      },
    });
    expect(room.sent.at(-1)?.payload).not.toHaveProperty("protocolVersion");
  });

  it("ignores backward snapshots and fails closed on a forged viewer", async () => {
    const { host, room } = await setup();
    room.emit(REALTIME_SERVER_MESSAGE, snapshot(4, 0));
    room.emit(REALTIME_SERVER_MESSAGE, snapshot(3, 0));
    expect(host.getState().snapshot?.tick).toBe(4);
    room.emit(REALTIME_SERVER_MESSAGE, {
      ...snapshot(5, 0),
      viewer: { kind: "player", slotId: "slot-right" },
    });
    expect(host.getState()).toMatchObject({
      connectionState: "closed",
      error: "INVALID_SERVER_MESSAGE",
    });
  });

  it("exposes strict rejection and never replays local input", async () => {
    const { host, room } = await setup();
    const pending = host.submitInput({ type: "RESIGN" });
    room.emit(REALTIME_SERVER_MESSAGE, {
      type: "realtime.rejected",
      realtimeProtocolVersion: 1,
      commandId: "command-1",
      code: "STALE_INPUT_SEQUENCE",
      retryable: false,
      acknowledgedInputSequence: 0,
      snapshot: snapshot(0, 0),
    });
    await expect(pending).rejects.toThrow("STALE_INPUT_SEQUENCE");
    expect(host.getState().rejection?.code).toBe("STALE_INPUT_SEQUENCE");
    expect(room.sent).toHaveLength(1);
  });
});
