import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GameSurfaceBridge,
  type SurfaceMessageEventTarget,
} from "../src/index.js";

class FakeWindowTarget implements SurfaceMessageEventTarget {
  listener: ((event: MessageEvent) => void) | null = null;

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent) => void,
  ): void {
    if (this.listener === listener) this.listener = null;
  }

  emit(event: Partial<MessageEvent>): void {
    this.listener?.(event as MessageEvent);
  }
}

describe("GameSurfaceBridge", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts exactly one source-bound handshake and then uses only its port", async () => {
    const target = new FakeWindowTarget();
    const parentWindow = {} as Window;
    const channel = new MessageChannel();
    const surfaceMessages: unknown[] = [];
    const hostMessages: unknown[] = [];
    channel.port1.onmessage = (event) => surfaceMessages.push(event.data);
    channel.port1.start();
    const bridge = new GameSurfaceBridge({
      windowTarget: target,
      parentWindow,
      allowedHostOrigin: "https://hub.example",
      onMessage: (message) => hostMessages.push(message),
    });
    bridge.start();
    target.emit({
      source: {} as Window,
      origin: "https://hub.example",
      data: {
        type: "host.hello",
        bridgeVersion: 1,
        nonce: "n".repeat(32),
        mode: "play",
      },
      ports: [channel.port2],
    });
    expect(bridge.connected).toBe(false);
    target.emit({
      source: parentWindow,
      origin: "https://hub.example",
      data: {
        type: "host.hello",
        bridgeVersion: 1,
        nonce: "n".repeat(32),
        mode: "play",
      },
      ports: [channel.port2],
    });
    expect(bridge.connected).toBe(true);
    expect(bridge.mode).toBe("play");
    await vi.waitFor(() =>
      expect(surfaceMessages).toEqual([
        {
          type: "surface.ready",
          bridgeVersion: 1,
          nonce: "n".repeat(32),
        },
      ]),
    );

    channel.port1.postMessage({
      type: "host.init",
      bridgeVersion: 1,
      mode: "play",
      gameId: "tic-tac-toe",
      gameVersion: "1.1.0",
      locale: "zh-CN",
      reducedMotion: false,
    });
    await vi.waitFor(() => expect(hostMessages).toHaveLength(1));
    bridge.dispose();
  });

  it("suppresses duplicate intent ids before they reach the Host", async () => {
    const target = new FakeWindowTarget();
    const parentWindow = {} as Window;
    const channel = new MessageChannel();
    const surfaceMessages: unknown[] = [];
    channel.port1.onmessage = (event) => surfaceMessages.push(event.data);
    channel.port1.start();
    const bridge = new GameSurfaceBridge({
      windowTarget: target,
      parentWindow,
      allowedHostOrigin: "*",
      onMessage: () => undefined,
    });
    bridge.start();
    target.emit({
      source: parentWindow,
      origin: "null",
      data: {
        type: "host.hello",
        bridgeVersion: 1,
        nonce: "n".repeat(32),
        mode: "setup",
      },
      ports: [channel.port2],
    });
    expect(bridge.connected).toBe(true);
    const intent = {
      type: "surface.intent",
      clientIntentId: "intent-1",
      intent: { type: "SET_VALUE", value: 1 },
    } as const;
    expect(bridge.send(intent)).toBe(true);
    expect(bridge.send(intent)).toBe(false);
    await vi.waitFor(() => expect(surfaceMessages).toContainEqual(intent));
    bridge.dispose();
  });

  it("fails closed on timeout or invalid port messages", async () => {
    vi.useFakeTimers();
    const target = new FakeWindowTarget();
    const errors: Error[] = [];
    const bridge = new GameSurfaceBridge({
      windowTarget: target,
      parentWindow: {} as Window,
      allowedHostOrigin: "https://hub.example",
      readyTimeoutMs: 10,
      onMessage: () => undefined,
      onProtocolError: (error) => errors.push(error),
    });
    bridge.start();
    vi.advanceTimersByTime(10);
    await vi.runAllTimersAsync();
    expect(bridge.connected).toBe(false);
    expect(errors[0]?.message).toContain("timed out");
  });
});
