// Explicit fixture creation only; never run automatically in tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createRealtimeRng,
  defineRealtimePlayerSlotId,
  type RealtimeCanonicalReplay,
} from "@online-game-hub/realtime-game-sdk";
import { ninjaClashDefinition as game, type Input } from "../src/core/index.js";
for (const count of [2, 3, 4]) {
  const rng = createRealtimeRng("ninja-clash-1.0.0-" + count + "p");
  const players = Array.from({ length: count }, (_, i) =>
    defineRealtimePlayerSlotId("p" + i),
  );
  const config = { playerCount: count, targetScore: 3 as const };
  let state = game.createInitialState({ config, players, rng }).state;
  const events: RealtimeCanonicalReplay["events"][number][] = [];
  let clashAt = -1,
    comboAt = -1;
  const effects = new Set<string>();
  if (count === 4) {
    let preview = state;
    for (let t = 0; t < 180; t++)
      preview = game.step({ state: preview, inputs: [], rng, tick: t }).state;
    const directory = new URL(
      "../../../game-surfaces/ninja-clash/tests/fixtures/",
      import.meta.url,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      new URL("play.json", directory),
      JSON.stringify(
        game.projectView({
          state: preview,
          viewer: { kind: "player", slotId: required(players[0]) },
        }),
        null,
        2,
      ) + "\n",
    );
  }
  while (!state.outcome && state.tick < 12000) {
    const inputs: {
      slotId: ReturnType<typeof defineRealtimePlayerSlotId>;
      input: Input;
    }[] = [];
    const add = (i: number, input: Input) =>
      inputs.push({ slotId: required(players[i]), input });
    if (state.phase === "ACTIVE") {
      const target = state.players.find((p, i) => i > 0 && p.alive);
      const p0 = required(state.players[0]);
      for (const p of state.players) {
        if (!p.alive) continue;
        const destination =
          p.index === 0
            ? clashAt < 0
              ? 28500
              : (target?.x ?? 33000) - 2700
            : 33000 + (p.index - 1) * 1000;
        const delta = destination - p.x;
        const direction = Math.abs(delta) <= 150 ? 0 : delta > 0 ? 1 : -1;
        if (direction !== p.move || state.tick % 15 === 0)
          add(p.index, { type: "MOVE", direction });
      }
      if (
        clashAt < 0 &&
        state.players.every((p) => p.y === 33600) &&
        Math.abs(p0.x - 28500) <= 150 &&
        Math.abs(required(state.players[1]).x - 33000) <= 150
      ) {
        add(0, { type: "MOVE", direction: 1 });
        add(1, { type: "MOVE", direction: -1 });
        add(0, { type: "ATTACK" });
        add(1, { type: "ATTACK" });
        clashAt = state.tick + 3;
      } else if (clashAt >= 0 && state.tick === clashAt + 3) {
        add(0, { type: "ATTACK" });
        comboAt = state.tick;
      } else if (comboAt >= 0 && state.tick === comboAt + 3)
        add(0, { type: "SLIDE" });
      else if (comboAt >= 0 && state.tick === comboAt + 4)
        add(0, { type: "ATTACK" });
      else if (
        comboAt >= 0 &&
        state.tick > comboAt + 4 &&
        target &&
        Math.abs(target.x - p0.x) <= 3200 &&
        Math.abs(target.y - p0.y) < 1500 &&
        state.tick >= p0.attackReady
      ) {
        add(0, { type: "MOVE", direction: target.x >= p0.x ? 1 : -1 });
        add(0, { type: "ATTACK" });
      }
    }
    for (const e of inputs)
      events.push({
        sequence: events.length + 1,
        tick: state.tick,
        actorSlotId: e.slotId,
        input: e.input,
      });
    state = game.step({ state, inputs, rng, tick: state.tick }).state;
    for (const e of state.effects) effects.add(e.kind);
  }
  if (
    !state.outcome ||
    state.outcome.winnerSlotId !== "p0" ||
    !effects.has("CLASH") ||
    !effects.has("SLIDE")
  )
    throw new Error(
      "Incomplete scenario " + count + " " + JSON.stringify(state.players),
    );
  const replay: RealtimeCanonicalReplay = {
    header: {
      replayFormatVersion: 1,
      runtime: "realtime",
      gameId: game.manifest.id,
      gameVersion: game.manifest.gameVersion,
      tickRate: 60,
      rng: { algorithm: rng.algorithm, seed: rng.seed },
      initialConfig: config,
      players: players.map((slotId) => ({ slotId })),
    },
    events,
    finalTick: state.tick,
    recordedRngCursor: 0,
    recordedOutcome: state.outcome,
  };
  const dir = new URL("./fixtures/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    new URL("ninja-clash-1.0.0-" + count + "p.json", dir),
    JSON.stringify(
      {
        replay,
        stateHash: createHash("sha256")
          .update(JSON.stringify(state))
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
