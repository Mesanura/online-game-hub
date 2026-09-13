import { describe, expect, it } from "vitest";
import type { AccountMatchHistoryItem } from "../src/lib/match-history";
import {
  filterMatchHistory,
  getHistoryGameOptions,
  readHistoryFilters,
} from "../src/lib/match-history-filters";

function match(
  matchId: string,
  gameId: string,
  status: AccountMatchHistoryItem["status"],
): AccountMatchHistoryItem {
  return {
    matchId,
    gameId,
    status,
    gameVersion: "1.0.0",
    roundNumber: 1,
    finalRevision: 1,
    playerSlotId: "slot-1",
    createdAt: "2026-09-13T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    replayAvailable: false,
    result: null,
  };
}

const matches = [
  match("first", "pong", "completed"),
  match("second", "tic-tac-toe", "abandoned"),
  match("third", "pong", "active"),
  match("fourth", "archived-game", "waiting"),
];

function findMatches(query: string) {
  return filterMatchHistory(
    matches,
    readHistoryFilters(
      new URLSearchParams(query),
      getHistoryGameOptions(matches),
    ),
  ).map((item) => item.matchId);
}

describe("match history filters", () => {
  it("combines game and status without sorting or changing records", () => {
    expect(findMatches("game=pong")).toEqual(["first", "third"]);
    expect(findMatches("game=pong&status=completed")).toEqual(["first"]);
    expect(findMatches("status=abandoned")).toEqual(["second"]);
    expect(findMatches("game=tic-tac-toe&status=completed")).toEqual([]);
    expect(
      filterMatchHistory(matches, { game: "pong", status: "completed" })[0],
    ).toBe(matches[0]);
  });

  it("keeps historical games selectable even when absent from the current catalog", () => {
    expect(getHistoryGameOptions(matches)).toContainEqual({
      id: "archived-game",
      title: "历史游戏（archived-game）",
    });
    expect(
      getHistoryGameOptions(matches).filter((game) => game.id === "pong"),
    ).toHaveLength(1);
    expect(findMatches("game=archived-game&status=waiting")).toEqual([
      "fourth",
    ]);
  });

  it.each([
    "game=unknown&status=invalid",
    "game=__proto__&status=toString",
    "",
  ])("ignores invalid or absent query enums: %s", (query) => {
    expect(findMatches(query)).toEqual(matches.map((item) => item.matchId));
  });

  it("distinguishes a valid game with no recent matches from an invalid game", () => {
    expect(findMatches("game=air-hockey")).toEqual([]);
    expect(filterMatchHistory([], { game: null, status: null })).toEqual([]);
  });
});
