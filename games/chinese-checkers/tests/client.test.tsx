import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRng, definePlayerSlotId } from "@online-game-hub/game-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  createInitialState,
  projectView,
  transition,
} from "../src/core/index.js";
import {
  chineseCheckersClientModule,
  chineseCheckersViewSchema,
  ChineseCheckersClient,
  legalTargetsForSelection,
} from "../src/client/module.js";

describe("Chinese Checkers client contract", () => {
  it("parses a projected 73-cell view and exposes resignation factory", () => {
    const p1 = definePlayerSlotId("p1");
    const p2 = definePlayerSlotId("p2");
    const state = createInitialState({
      config: null,
      players: [p1, p2],
      playerAssignments: ["N", "S"],
      rng: createRng("client"),
    }).state;
    const view = projectView({ state, viewer: { kind: "player", slotId: p1 } });
    expect(chineseCheckersViewSchema.parse(view)).toEqual(view);
    expect(chineseCheckersClientModule.parseView(view)).toEqual(view);
    expect(chineseCheckersClientModule.createResignAction?.()).toEqual({
      type: "RESIGN",
    });
    expect(view.board).toHaveLength(73);
  });

  it("renders every board cell with camp styling and exposes selection targets", () => {
    const p1 = definePlayerSlotId("p1");
    const p2 = definePlayerSlotId("p2");
    const view = projectView({
      state: createInitialState({
        config: null,
        players: [p1, p2],
        playerAssignments: ["N", "S"],
        rng: createRng("client-render"),
      }).state,
      viewer: { kind: "player", slotId: p1 },
    });
    const html = renderToStaticMarkup(
      createElement(ChineseCheckersClient, {
        view,
        revision: 0,
        connectionState: "connected",
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain('aria-label="中国跳棋六芒星棋盘"');
    expect(html.match(/data-cell-index=/gu)).toHaveLength(73);
    expect(html.match(/data-camp="N"/gu)).toHaveLength(6);
    expect(html.match(/data-camp="S"/gu)).toHaveLength(6);
    expect(html.match(/class="chinese-checkers-piece"/gu)).toHaveLength(12);
    const firstMove = view.legalMoves[0];
    if (firstMove === undefined) throw new Error("Move fixture missing.");
    expect(legalTargetsForSelection(view.legalMoves, firstMove.from)).toContain(
      firstMove.to,
    );
    expect(legalTargetsForSelection(view.legalMoves, null)).toEqual([]);
  });

  it("keeps replay rendering read-only and displays the authoritative ranking", () => {
    const p1 = definePlayerSlotId("p1");
    const p2 = definePlayerSlotId("p2");
    const initial = createInitialState({
      config: null,
      players: [p1, p2],
      playerAssignments: ["N", "S"],
      rng: createRng("client-terminal"),
    });
    const resigned = transition({
      state: initial.state,
      rng: initial.rng,
      actorSlotId: p1,
      action: { type: "RESIGN" },
    });
    if (resigned.status !== "accepted") throw new Error("Resignation failed.");
    const view = projectView({
      state: resigned.state,
      viewer: { kind: "player", slotId: p1 },
    });
    const html = renderToStaticMarkup(
      createElement(ChineseCheckersClient, {
        view,
        revision: 1,
        connectionState: "connected",
        readOnly: true,
        submitAction: vi.fn(async () => undefined),
      }),
    );
    expect(html).toContain("本局排名已确定");
    expect(html).toContain("最终排名");
    expect(html.match(/data-cell-index=/gu)).toHaveLength(73);
    expect(html).toMatch(/data-cell-index="2"[^>]*disabled=""/u);
  });
});
