import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SurfaceBridgeHost,
  createSurfaceNonce,
  createSurfaceSandbox,
  type SurfaceBridgeHostStatus,
  type SurfaceFrameWindow,
} from "../src/index.js";

function nextMessage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SurfaceBridgeHost", () => {
  afterEach(() => vi.useRealTimers());

  it("transfers one port, validates the nonce and only then forwards intents", async () => {
    let handshake: unknown;
    let surfacePort: MessagePort | undefined;
    const hostMessages: unknown[] = [];
    const intents: unknown[] = [];
    const statuses: SurfaceBridgeHostStatus[] = [];
    const frameWindow: SurfaceFrameWindow = {
      postMessage(message, _targetOrigin, transfer) {
        handshake = message;
        surfacePort = transfer?.[0] as MessagePort | undefined;
        if (surfacePort !== undefined) {
          surfacePort.onmessage = (event) => hostMessages.push(event.data);
          surfacePort.start();
        }
      },
    };
    const host = new SurfaceBridgeHost({
      frameWindow: () => frameWindow,
      mode: "play",
      init: {
        gameId: "tic-tac-toe",
        gameVersion: "1.1.0",
        locale: "zh-CN",
        reducedMotion: false,
      },
      createNonce: () => "n".repeat(32),
      onIntent: (message) => intents.push(message),
      onStatusChange: (status) => {
        statuses.push(status);
        if (status.state === "ready") {
          host.send({
            type: "host.state",
            sequence: 1,
            connectionState: "connected",
            readOnly: false,
            roundNumber: 1,
            revision: 0,
            payload: { board: [] },
          });
        }
      },
    });

    host.start();
    expect(handshake).toEqual({
      type: "host.hello",
      bridgeVersion: 1,
      nonce: "n".repeat(32),
      mode: "play",
    });
    expect(surfacePort).toBeDefined();
    expect(host.send({ type: "host.dispose" })).toBe(false);

    surfacePort?.postMessage({
      type: "surface.ready",
      bridgeVersion: 1,
      nonce: "n".repeat(32),
    });
    await vi.waitFor(() => expect(host.status.state).toBe("ready"));
    await vi.waitFor(() =>
      expect(hostMessages.slice(0, 2)).toEqual([
        {
          type: "host.init",
          bridgeVersion: 1,
          mode: "play",
          gameId: "tic-tac-toe",
          gameVersion: "1.1.0",
          locale: "zh-CN",
          reducedMotion: false,
        },
        {
          type: "host.state",
          sequence: 1,
          connectionState: "connected",
          readOnly: false,
          roundNumber: 1,
          revision: 0,
          payload: { board: [] },
        },
      ]),
    );

    const intent = {
      type: "surface.intent",
      clientIntentId: "intent-1",
      intent: { type: "PLACE_MARK", cell: 4 },
    } as const;
    surfacePort?.postMessage(intent);
    surfacePort?.postMessage(intent);
    await vi.waitFor(() => expect(intents).toEqual([intent]));
    await vi.waitFor(() =>
      expect(hostMessages).toContainEqual({
        type: "host.intent-result",
        clientIntentId: "intent-1",
        status: "rejected",
        code: "DUPLICATE_CLIENT_INTENT_ID",
      }),
    );
    expect(statuses.map((status) => status.state)).toEqual([
      "loading",
      "ready",
    ]);
    host.dispose();
  });

  it("fails closed on nonce mismatch and can retry with a fresh channel", async () => {
    const ports: MessagePort[] = [];
    const host = new SurfaceBridgeHost({
      frameWindow: () => ({
        postMessage(_message, _targetOrigin, transfer) {
          const port = transfer?.[0] as MessagePort | undefined;
          if (port !== undefined) ports.push(port);
        },
      }),
      mode: "setup",
      init: {
        gameId: "tic-tac-toe",
        gameVersion: "1.1.0",
        locale: "zh-CN",
        reducedMotion: false,
      },
      createNonce: () => "n".repeat(32),
      onIntent: () => undefined,
    });
    host.start();
    ports[0]?.postMessage({
      type: "surface.ready",
      bridgeVersion: 1,
      nonce: "x".repeat(32),
    });
    await nextMessage();
    expect(host.status).toMatchObject({
      state: "failed",
      code: "NONCE_MISMATCH",
    });
    host.retry();
    expect(ports).toHaveLength(2);
    expect(host.status).toMatchObject({ state: "loading", attempt: 2 });
    host.dispose();
  });

  it("times out and refuses messages until a Surface is ready", () => {
    vi.useFakeTimers();
    const host = new SurfaceBridgeHost({
      frameWindow: () => ({ postMessage: () => undefined }),
      mode: "replay",
      init: {
        gameId: "tic-tac-toe",
        gameVersion: "1.1.0",
        locale: "zh-CN",
        reducedMotion: true,
      },
      createNonce: () => "n".repeat(32),
      readyTimeoutMs: 25,
      onIntent: () => undefined,
    });
    host.start();
    expect(
      host.send({
        type: "host.environment",
        width: 100,
        height: 100,
        fullscreen: false,
      }),
    ).toBe(false);
    vi.advanceTimersByTime(25);
    expect(host.status).toMatchObject({
      state: "failed",
      code: "HANDSHAKE_TIMEOUT",
    });
  });

  it("fails closed when the handshake port cannot be transferred", () => {
    const host = new SurfaceBridgeHost({
      frameWindow: () => ({
        postMessage: () => {
          throw new DOMException("transfer failed", "DataCloneError");
        },
      }),
      mode: "play",
      init: {
        gameId: "tic-tac-toe",
        gameVersion: "1.1.0",
        locale: "zh-CN",
        reducedMotion: false,
      },
      createNonce: () => "n".repeat(32),
      onIntent: () => undefined,
    });

    expect(() => host.start()).not.toThrow();
    expect(host.status).toMatchObject({
      state: "failed",
      code: "HANDSHAKE_TRANSFER_FAILED",
    });
  });

  it.each(["roundNumber", "expectedRevision"])(
    "fails closed when a Surface intent forges Host-owned %s",
    async (key) => {
      let surfacePort: MessagePort | undefined;
      const onIntent = vi.fn();
      const host = new SurfaceBridgeHost({
        frameWindow: () => ({
          postMessage(_message, _targetOrigin, transfer) {
            surfacePort = transfer?.[0] as MessagePort | undefined;
          },
        }),
        mode: "play",
        init: {
          gameId: "tic-tac-toe",
          gameVersion: "1.1.0",
          locale: "zh-CN",
          reducedMotion: false,
        },
        createNonce: () => "n".repeat(32),
        onIntent,
      });

      host.start();
      surfacePort?.postMessage({
        type: "surface.ready",
        bridgeVersion: 1,
        nonce: "n".repeat(32),
      });
      await vi.waitFor(() => expect(host.status.state).toBe("ready"));
      surfacePort?.postMessage({
        type: "surface.intent",
        clientIntentId: `forged-${key}`,
        intent: { type: "PLACE_MARK", nested: { [key]: 1 } },
      });
      await vi.waitFor(() =>
        expect(host.status).toMatchObject({
          state: "failed",
          code: "INVALID_MESSAGE",
        }),
      );
      expect(onIntent).not.toHaveBeenCalled();
      host.dispose();
    },
  );

  it("uses a high-entropy nonce and a minimal iframe sandbox", () => {
    const left = createSurfaceNonce();
    const right = createSurfaceNonce();
    expect(left).toHaveLength(43);
    expect(right).toHaveLength(43);
    expect(left).not.toBe(right);
    expect(createSurfaceSandbox()).toBe("allow-scripts");
    expect(createSurfaceSandbox(true)).toBe("allow-scripts allow-pointer-lock");
    expect(createSurfaceSandbox(true)).not.toContain("allow-same-origin");
  });
});
