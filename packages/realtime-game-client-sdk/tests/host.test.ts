import { describe, expect, it } from "vitest";

import {
  REALTIME_INPUT_MESSAGE,
  REALTIME_SERVER_MESSAGE,
  ROOM_CONTROL_MESSAGE,
  SERVER_PROTOCOL_MESSAGE,
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
    protocolVersion: 5,
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
    protocolVersion: 5,
    roomCode: "ABCD2345",
    gameId: "pong",
    gameVersion: "1.0.0",
    playerSlotId: "slot-left",
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
