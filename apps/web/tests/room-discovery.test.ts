import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("../src/server/runtime-config", () => ({
  getWebServerConfig: () => ({
    gameServerPublicUrl: "https://games.example.test",
  }),
}));

import { GET } from "../src/app/api/room-discovery/route";

function request(query = "gameId=tic-tac-toe&roomCode=ABCD2345") {
  return {
    nextUrl: new URL(`https://web.example.test/api/room-discovery?${query}`),
  } as NextRequest;
}

function discoveryResponse(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "ABCD2345",
    gameId: "tic-tac-toe",
    gameVersion: "1.1.0",
    setupProtocol: 6,
    runtime: "turn-based",
    ...overrides,
  };
}

describe("room discovery proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes the query and returns only a validated private response", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json(discoveryResponse(), { status: 200 }),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await GET(
      request("gameId=tic-tac-toe&roomCode=%20abcd2345%20"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual(discoveryResponse());
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://games.example.test/room-discovery?gameId=tic-tac-toe&roomCode=ABCD2345",
    );
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  });

  it.each([
    ["missing game id", "roomCode=ABCD2345"],
    ["invalid room code", "gameId=tic-tac-toe&roomCode=INVALID1"],
    ["extra query field", "gameId=tic-tac-toe&roomCode=ABCD2345&slot=1"],
    [
      "duplicate query field",
      "gameId=tic-tac-toe&roomCode=ABCD2345&roomCode=EFGH2345",
    ],
  ])("rejects %s before contacting the Game Server", async (_label, query) => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_ROOM_DISCOVERY_REQUEST",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("preserves an upstream not-found without exposing its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "INTERNAL_DETAIL", roomId: "secret" },
          { status: 404 },
        ),
      ),
    );

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({ code: "ROOM_NOT_FOUND" });
  });

  it.each([
    ["upstream failure", async () => Response.json({}, { status: 500 })],
    [
      "network failure",
      async () => {
        throw new Error("network detail");
      },
    ],
  ])("maps %s to a stable unavailable response", async (_label, fetcher) => {
    vi.stubGlobal("fetch", vi.fn(fetcher));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      code: "ROOM_DISCOVERY_UNAVAILABLE",
    });
  });

  it.each([
    ["invalid payload", { roomCode: "ABCD2345" }],
    ["mismatched game", discoveryResponse({ gameId: "pong" })],
    ["mismatched code", discoveryResponse({ roomCode: "EFGH2345" })],
    ["extra sensitive field", discoveryResponse({ ticket: "secret" })],
  ])("rejects an %s from the Game Server", async (_label, payload) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(payload, { status: 200 })),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    await expect(response.json()).resolves.toEqual({
      code: "ROOM_DISCOVERY_UNAVAILABLE",
    });
  });
});
