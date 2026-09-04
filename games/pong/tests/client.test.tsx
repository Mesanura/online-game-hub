import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defineRealtimePlayerSlotId } from "@online-game-hub/realtime-game-sdk";

import { PongClient } from "../src/client/module.js";
import type { PongView } from "../src/types.js";

const view: PongView = {
  field: { width: 800_000, height: 400_000 },
  players: [
    { slotId: defineRealtimePlayerSlotId("slot-1"), side: "LEFT" },
    { slotId: defineRealtimePlayerSlotId("slot-2"), side: "RIGHT" },
  ],
  paddles: [
    { y: 200_000, height: 80_000 },
    { y: 200_000, height: 80_000 },
  ],
  ball: { x: 400_000, y: 200_000, radius: 10_000 },
  scores: [2, 1],
  tick: 42,
  targetScore: 3,
  yourSide: "LEFT",
  outcome: null,
};

describe("PongClient", () => {
  it("由游戏客户端呈现比分与 outcome 探针", () => {
    const html = renderToStaticMarkup(
      <PongClient
        acknowledgedInputSequence={0}
        connectionState="connected"
        previousView={null}
        readOnly={false}
        reducedMotion={false}
        serverTick={42}
        submitInput={() => Promise.resolve()}
        view={view}
      />,
    );

    expect(html).toContain('data-testid="score-left">2');
    expect(html).toContain('data-testid="score-right">1');
    expect(html).toContain('data-testid="pong-outcome"></span>');
  });
});
