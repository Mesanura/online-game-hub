import type { HostSurfaceMessage } from "@online-game-hub/game-surface-bridge";

import type { WorkbenchFixture } from "./fixtures";

export type WorkbenchConnectionState =
  "idle" | "loading" | "connecting" | "connected" | "reconnecting" | "closed";

export interface WorkbenchSimulation {
  readonly fixture: WorkbenchFixture;
  readonly connectionState: WorkbenchConnectionState;
  readonly readOnly: boolean;
  readonly reducedMotion: boolean;
  readonly terminal: boolean;
  readonly counter: number;
}

export function createWorkbenchSimulation(
  fixture: WorkbenchFixture,
): WorkbenchSimulation {
  return Object.freeze({
    fixture,
    connectionState: "connected",
    readOnly: fixture.readOnly,
    reducedMotion: false,
    terminal: false,
    counter: fixture.initialCounter,
  });
}

export function updateWorkbenchSimulation(
  state: WorkbenchSimulation,
  update: Partial<Omit<WorkbenchSimulation, "fixture">> & {
    readonly fixture?: WorkbenchFixture;
  },
): WorkbenchSimulation {
  const fixture = update.fixture ?? state.fixture;
  const terminal = update.terminal ?? state.terminal;
  return Object.freeze({
    fixture,
    connectionState: update.connectionState ?? state.connectionState,
    readOnly: fixture.readOnly ? true : (update.readOnly ?? state.readOnly),
    reducedMotion: update.reducedMotion ?? state.reducedMotion,
    terminal,
    counter:
      update.fixture === undefined
        ? (update.counter ?? state.counter)
        : fixture.initialCounter,
  });
}

export function advanceWorkbenchSimulation(
  state: WorkbenchSimulation,
): WorkbenchSimulation {
  if (
    state.connectionState !== "connected" ||
    state.terminal ||
    state.fixture.counterKind === "none"
  ) {
    return state;
  }
  return updateWorkbenchSimulation(state, { counter: state.counter + 1 });
}

export function createWorkbenchStateMessage(
  state: WorkbenchSimulation,
  sequence: number,
): Extract<HostSurfaceMessage, { readonly type: "host.state" }> {
  const counter =
    state.fixture.counterKind === "revision"
      ? { revision: state.counter }
      : state.fixture.counterKind === "tick"
        ? { tick: state.counter }
        : state.fixture.counterKind === "setup"
          ? { setupRevision: state.counter }
          : {};
  return {
    type: "host.state",
    sequence,
    connectionState: state.connectionState,
    readOnly: state.readOnly || state.terminal,
    roundNumber: state.fixture.roundNumber,
    ...counter,
    payload: state.terminal
      ? state.fixture.terminalPayload
      : state.fixture.payload,
    outcome: state.terminal ? state.fixture.terminalOutcome : null,
  };
}
