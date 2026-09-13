import { describe, expect, it } from "vitest";
import { gameCatalog } from "@online-game-hub/game-registry/catalog";
import { filterCatalog, readCatalogFilters } from "../src/lib/catalog-filters";

function findGames(query: string) {
  return filterCatalog(
    gameCatalog,
    readCatalogFilters(new URLSearchParams(query)),
  ).map((game) => game.id);
}

describe("catalog filters", () => {
  it("combines Chinese search, runtime and inclusive player limits in catalog order", () => {
    expect(findGames("q=棋&players=3")).toEqual(["chinese-checkers"]);
    expect(findGames("players=6")).toEqual(["chinese-checkers", "tank-maze"]);
    expect(findGames("players=7")).toEqual(["tank-maze"]);
    expect(findGames("q=坦克&runtime=turn-based&players=8")).toEqual([]);
    expect(findGames("q=%20坦克%20&runtime=realtime&players=8")).toEqual([
      "tank-maze",
    ]);
    expect(findGames("players=2")).toEqual(gameCatalog.map((game) => game.id));
  });

  it("searches title or description without case or surrounding whitespace sensitivity", () => {
    const template = gameCatalog[0];
    if (template === undefined) throw new Error("The game catalog is empty.");
    const game = {
      ...template,
      title: "Alpha",
      description: "Play with Friends",
    };
    for (const query of [" ALPHA ", "friends", " PLAY "]) {
      expect(
        filterCatalog([game], { query, runtime: null, players: null }),
      ).toEqual([game]);
    }
    expect(
      filterCatalog([game], {
        query: "unlisted",
        runtime: null,
        players: null,
      }),
    ).toEqual([]);
  });

  it.each(["1", "9", "2.5", "02", "NaN", "-2", ""])(
    "ignores unsupported player enum %s",
    (players) => {
      expect(
        readCatalogFilters(
          new URLSearchParams({ players, runtime: "unsupported" }),
        ),
      ).toEqual({
        query: "",
        runtime: null,
        players: null,
      });
    },
  );

  it("treats empty or whitespace-only searches as all games", () => {
    expect(findGames("q=%20%20")).toEqual(findGames(""));
  });
});
