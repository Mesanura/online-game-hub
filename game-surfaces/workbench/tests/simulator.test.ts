import { describe, expect, it } from "vitest";

import { resolveWorkbenchFixture } from "../src/fixtures";
import {
  advanceWorkbenchSimulation,
  createWorkbenchSimulation,
  createWorkbenchStateMessage,
  updateWorkbenchSimulation,
} from "../src/simulator";

describe("Surface Workbench simulator", () => {
  it("advances only connected non-terminal simulations", () => {
    const initial = createWorkbenchSimulation(
      resolveWorkbenchFixture("turn-based-play"),
    );
    const advanced = advanceWorkbenchSimulation(initial);
    expect(advanced.counter).toBe(initial.counter + 1);
    expect(initial.counter).toBe(3);

    const reconnecting = updateWorkbenchSimulation(advanced, {
      connectionState: "reconnecting",
    });
    expect(advanceWorkbenchSimulation(reconnecting)).toBe(reconnecting);

    const terminal = updateWorkbenchSimulation(advanced, { terminal: true });
    expect(createWorkbenchStateMessage(terminal, 1).readOnly).toBe(true);
    expect(advanceWorkbenchSimulation(terminal)).toBe(terminal);
  });

  it("maps setup, revision and tick counters to Bridge messages", () => {
    const setup = createWorkbenchStateMessage(
      createWorkbenchSimulation(resolveWorkbenchFixture("setup")),
      1,
    );
    const turnBased = createWorkbenchStateMessage(
      createWorkbenchSimulation(resolveWorkbenchFixture("turn-based-play")),
      2,
    );
    const realtime = createWorkbenchStateMessage(
      createWorkbenchSimulation(resolveWorkbenchFixture("realtime-play")),
      3,
    );

    expect(setup).toMatchObject({ sequence: 1, setupRevision: 2 });
    expect(turnBased).toMatchObject({ sequence: 2, revision: 3 });
    expect(realtime).toMatchObject({ sequence: 3, tick: 240 });
  });

  it("resets counters and read-only defaults when fixtures change", () => {
    const active = advanceWorkbenchSimulation(
      createWorkbenchSimulation(resolveWorkbenchFixture("turn-based-play")),
    );
    const replay = updateWorkbenchSimulation(active, {
      fixture: resolveWorkbenchFixture("replay"),
      terminal: false,
    });

    expect(replay.counter).toBe(6);
    expect(replay.readOnly).toBe(true);
  });
});
