import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { MatchHistoryProjectionItem } from "@online-game-hub/database";
import type { WebServerConfig } from "../src/server/config";

const mocks = vi.hoisted(() => ({
  turnList: vi.fn(),
  realtimeList: vi.fn(),
  turnRead: vi.fn(),
  realtimeRead: vi.fn(),
  close: vi.fn(),
  account: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@online-game-hub/database", () => ({
  createPostgresDatabaseClient: () => ({ database: {}, close: mocks.close }),
  PostgresMatchRepository: class {
    listForUserWithResults = mocks.turnList;
    getCompletedReplayForUser = mocks.turnRead;
  },
  PostgresRealtimeMatchRepository: class {
    listForUserWithResults = mocks.realtimeList;
    getCompletedReplayForUser = mocks.realtimeRead;
  },
}));
vi.mock("../src/server/runtime-config", () => ({
  getWebServerConfig: () => ({
    databaseMode: "postgres",
    databaseUrl: "postgresql://unused.test/test",
  }),
}));
vi.mock("../src/server/auth-service", () => ({
  resolveAccountSession: mocks.account,
}));
vi.mock("../src/server/auth-response", () => ({
  clearAuthenticatedCookies: vi.fn(),
}));

import {
  getGameReplayMode,
  listUserMatchHistory,
} from "../src/server/match-history";
import { GET } from "../src/app/api/matches/[matchId]/replay/route";
import { GET as getHistory } from "../src/app/api/matches/route";

const config: WebServerConfig = {
  applicationEnvironment: "test",
  databaseMode: "postgres",
  databaseUrl: "postgresql://unused.test/test",
  gameServerPublicUrl: "http://games.test",
  guestSessionSecret: "test",
  guestCookieSecure: false,
  ticketIssuer: "test",
  ticketSecret: "test",
  ticketLifetimeSeconds: 30,
};

function match(
  gameId: string,
  gameVersion: string,
  available = true,
): MatchHistoryProjectionItem {
  return {
    matchId: `${gameId}-${gameVersion}`,
    roundNumber: 1,
    gameId,
    gameVersion,
    status: "completed",
    finalRevision: 5,
    playerSlotId: "player-a",
    createdAt: "2026-09-06T00:00:00.000Z",
    startedAt: "2026-09-06T00:00:00.000Z",
    finishedAt: "2026-09-06T00:01:00.000Z",
    replayAvailable: available,
    recordedOutcome: null,
    players: [{ slotId: "player-a" }, { slotId: "player-b" }],
  };
}

function readReplay() {
  return GET(new NextRequest("https://web.test/api/matches/test/replay"), {
    params: Promise.resolve({ matchId: "test" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.turnList.mockResolvedValue([]);
  mocks.realtimeList.mockResolvedValue([]);
  mocks.turnRead.mockResolvedValue({ status: "not-found" });
  mocks.realtimeRead.mockResolvedValue({ status: "not-found" });
  mocks.account.mockResolvedValue({ userId: "account-a" });
  mocks.close.mockResolvedValue(undefined);
});

describe("exact game replay capability", () => {
  it("returns private personal results without exposing repository projection inputs", async () => {
    mocks.turnList.mockResolvedValue([
      {
        ...match("tic-tac-toe", "1.1.0"),
        recordedOutcome: {
          type: "WIN",
          winnerSlotId: "player-b",
          reason: "RESIGNATION",
          resignedSlotId: "player-a",
        },
        internalSecret: "never-return",
      },
    ]);
    mocks.realtimeList.mockResolvedValue([
      {
        ...match("pong", "1.2.0"),
        playerSlotId: "player-b",
        recordedOutcome: {
          type: "WIN",
          reason: "SCORE",
          winnerSlotId: "player-b",
          scores: [1, 3],
        },
        players: [
          { slotId: "player-a", participantRef: "secret-account" },
          { slotId: "player-b" },
        ],
      },
    ]);
    const response = await getHistory(
      new NextRequest(
        "https://web.test/api/matches?userId=other&slot=player-a",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toBe("Cookie");
    const payload = await response.json();
    expect(payload.matches).toEqual([
      expect.objectContaining({
        gameId: "tic-tac-toe",
        result: { kind: "win-loss", value: "loss" },
        replayAvailable: true,
      }),
      expect.objectContaining({
        gameId: "pong",
        result: { kind: "score", own: 3, opponent: 1 },
        replayAvailable: false,
      }),
    ]);
    for (const item of payload.matches) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "matchId",
          "roundNumber",
          "gameId",
          "gameVersion",
          "status",
          "finalRevision",
          "playerSlotId",
          "createdAt",
          "startedAt",
          "finishedAt",
          "result",
          "replayAvailable",
        ].sort(),
      );
    }
    expect(mocks.turnList).toHaveBeenCalledWith("account-a");
    expect(mocks.realtimeList).toHaveBeenCalledWith("account-a");
  });

  it("isolates invalid results and keeps the stable 50-row history bound", async () => {
    const records = Array.from({ length: 55 }, (_, index) => ({
      ...match("tic-tac-toe", "1.1.0"),
      matchId: String(index).padStart(2, "0"),
      recordedOutcome: index === 54 ? { broken: true } : { type: "DRAW" },
    }));
    mocks.turnList.mockResolvedValue(records);
    const result = await listUserMatchHistory(config, "account-a");
    expect(result).toHaveLength(50);
    expect(result[0]).toMatchObject({ matchId: "54", result: null });
    expect(result[1]).toMatchObject({
      matchId: "53",
      result: { kind: "win-loss", value: "draw" },
    });
    expect(result[49]?.matchId).toBe("05");
  });

  it("does not query history for unauthenticated requests", async () => {
    mocks.account.mockResolvedValueOnce(null);
    const response = await getHistory(
      new NextRequest("https://web.test/api/matches"),
    );
    expect(response.status).toBe(401);
    expect(mocks.turnList).not.toHaveBeenCalled();
    expect(mocks.realtimeList).not.toHaveBeenCalled();
  });

  it.each([
    ["tic-tac-toe", "1.0.0", "player-playback"],
    ["tic-tac-toe", "1.1.0", "player-playback"],
    ["pong", "1.0.0", "record-only"],
    ["pong", "1.1.0", "record-only"],
    ["pong", "1.2.0", "record-only"],
    ["badminton", "1.0.0", "record-only"],
    ["badminton", "2.0.0", undefined],
    ["missing", "1.0.0", undefined],
  ])(
    "resolves %s@%s without substituting the current version",
    (gameId, version, mode) => {
      expect(getGameReplayMode(gameId, version)).toBe(mode);
    },
  );

  it("filters player availability after ownership reads without mutating archive metadata", async () => {
    const records = [
      match("tic-tac-toe", "1.0.0"),
      match("tic-tac-toe", "1.1.0", false),
      match("pong", "1.0.0"),
      match("badminton", "1.0.0"),
      match("unknown", "1.0.0"),
      match("pong", "1.1.0"),
      match("pong", "1.2.0"),
    ];
    mocks.turnList.mockResolvedValue(records.slice(0, 2));
    mocks.realtimeList.mockResolvedValue(records.slice(2));
    const history = await listUserMatchHistory(config, "account-a");
    expect(
      Object.fromEntries(
        history.map((item) => [item.matchId, item.replayAvailable]),
      ),
    ).toEqual({
      "tic-tac-toe-1.0.0": true,
      "tic-tac-toe-1.1.0": false,
      "pong-1.0.0": false,
      "pong-1.1.0": false,
      "pong-1.2.0": false,
      "badminton-1.0.0": false,
      "unknown-1.0.0": false,
    });
    expect(records[3]?.replayAvailable).toBe(true);
    expect(mocks.turnList).toHaveBeenCalledWith("account-a");
    expect(mocks.realtimeList).toHaveBeenCalledWith("account-a");
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["badminton", "1.0.0"],
    ["pong", "1.0.0"],
    ["pong", "1.1.0"],
    ["pong", "1.2.0"],
  ])(
    "rejects %s@%s playback before frame construction and returns private headers",
    async (gameId, gameVersion) => {
      mocks.realtimeRead.mockResolvedValue({
        status: "available",
        match: match(gameId, gameVersion),
        playerSlotId: "player-a",
        replay: { deliberatelyInvalid: "must-not-be-reconstructed" },
      });
      const response = await readReplay();
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("no-store, private");
      expect(response.headers.get("vary")).toBe("Cookie");
      expect(await response.json()).toEqual({
        code: "PLAYER_PLAYBACK_NOT_SUPPORTED",
      });
    },
  );

  it("fails closed on an unavailable exact version", async () => {
    mocks.realtimeRead.mockResolvedValue({
      status: "available",
      match: match("badminton", "2.0.0"),
    });
    const response = await readReplay();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "REPLAY_UNAVAILABLE" });
  });

  it("keeps unauthenticated and nonparticipant requests indistinguishable from existing authorization behavior", async () => {
    mocks.account.mockResolvedValueOnce(null);
    const anonymous = await readReplay();
    expect(anonymous.status).toBe(401);
    expect(mocks.turnRead).not.toHaveBeenCalled();
    expect(mocks.realtimeRead).not.toHaveBeenCalled();
    const nonparticipant = await readReplay();
    expect(nonparticipant.status).toBe(404);
    expect(await nonparticipant.json()).toEqual({ code: "MATCH_NOT_FOUND" });
  });

  it.each(["1.0.0", "1.1.0"])(
    "still serves verified projected frames for tic-tac-toe@%s",
    async (version) => {
      const replay = JSON.parse(
        await readFile(
          new URL(
            `../../../games/tic-tac-toe/tests/fixtures/tic-tac-toe-${version}-win.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      mocks.turnRead.mockResolvedValue({
        status: "available",
        match: {
          ...match("tic-tac-toe", version),
          finalRevision: replay.actions.length,
        },
        playerSlotId: replay.header.players[0].slotId,
        replay,
      });
      const response = await readReplay();
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.frames).toHaveLength(replay.actions.length + 1);
      expect(payload.match.gameVersion).toBe(version);
      expect(JSON.stringify(payload.frames)).not.toMatch(
        /rngSeed|canonicalReplay|actorSlotId|rawState/u,
      );
    },
  );
});
