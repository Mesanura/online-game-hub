import type { SurfaceMode } from "@online-game-hub/game-surface-bridge";

export type WorkbenchCounterKind = "setup" | "revision" | "tick" | "none";

export interface WorkbenchFixture {
  readonly id: string;
  readonly label: string;
  readonly mode: SurfaceMode;
  readonly gameId: string;
  readonly gameVersion: string;
  readonly roundNumber: number | null;
  readonly counterKind: WorkbenchCounterKind;
  readonly initialCounter: number;
  readonly readOnly: boolean;
  readonly payload: unknown;
  readonly terminalPayload: unknown;
  readonly terminalOutcome: unknown | null;
}

export const WORKBENCH_FIXTURES = Object.freeze([
  {
    id: "setup",
    label: "Setup · 参与者与先手",
    mode: "setup",
    gameId: "workbench-setup",
    gameVersion: "1.0.0",
    roundNumber: 1,
    counterKind: "setup",
    initialCounter: 2,
    readOnly: false,
    payload: {
      config: { boardSize: 15 },
      participantSlotIds: ["slot-a", "slot-b"],
      playerOrder: ["slot-a", "slot-b"],
      assignments: { "slot-a": "BLACK", "slot-b": "WHITE" },
      readiness: {
        requiredSlotIds: ["slot-a", "slot-b"],
        readySlotIds: ["slot-a"],
        selfReady: true,
        canReady: true,
      },
    },
    terminalPayload: {
      config: { boardSize: 15 },
      participantSlotIds: ["slot-a", "slot-b"],
      playerOrder: ["slot-a", "slot-b"],
      assignments: { "slot-a": "BLACK", "slot-b": "WHITE" },
      readiness: {
        requiredSlotIds: ["slot-a", "slot-b"],
        readySlotIds: ["slot-a", "slot-b"],
        selfReady: true,
        canReady: false,
      },
    },
    terminalOutcome: null,
  },
  {
    id: "turn-based-play",
    label: "Play · 回合制棋盘",
    mode: "play",
    gameId: "workbench-board",
    gameVersion: "1.0.0",
    roundNumber: 1,
    counterKind: "revision",
    initialCounter: 3,
    readOnly: false,
    payload: {
      board: ["X", "O", null, null, "X", null, "O", null, null],
      nextTurnSlotId: "slot-b",
      legalCells: [2, 3, 5, 7, 8],
      outcome: null,
    },
    terminalPayload: {
      board: ["X", "O", "O", null, "X", null, null, null, "X"],
      nextTurnSlotId: null,
      legalCells: [],
      outcome: { type: "WIN", winnerSlotId: "slot-a" },
    },
    terminalOutcome: { type: "WIN", winnerSlotId: "slot-a" },
  },
  {
    id: "realtime-play",
    label: "Play · Realtime 2:1",
    mode: "play",
    gameId: "workbench-realtime",
    gameVersion: "1.0.0",
    roundNumber: 1,
    counterKind: "tick",
    initialCounter: 240,
    readOnly: false,
    payload: {
      field: { width: 800, height: 400 },
      previousView: {
        ball: { x: 396, y: 198 },
        paddles: { leftY: 160, rightY: 148 },
      },
      view: {
        ball: { x: 404, y: 202 },
        paddles: { leftY: 160, rightY: 152 },
        score: { left: 4, right: 3, target: 5 },
      },
      acknowledgedInput: 18,
      outcome: null,
    },
    terminalPayload: {
      field: { width: 800, height: 400 },
      previousView: {
        ball: { x: 760, y: 202 },
        paddles: { leftY: 160, rightY: 152 },
      },
      view: {
        ball: { x: 800, y: 202 },
        paddles: { leftY: 160, rightY: 152 },
        score: { left: 5, right: 3, target: 5 },
      },
      acknowledgedInput: 18,
      outcome: { type: "WIN", winnerSlotId: "slot-left" },
    },
    terminalOutcome: { type: "WIN", winnerSlotId: "slot-left" },
  },
  {
    id: "replay",
    label: "Replay · 只读投影帧",
    mode: "replay",
    gameId: "workbench-replay",
    gameVersion: "1.0.0",
    roundNumber: 2,
    counterKind: "revision",
    initialCounter: 6,
    readOnly: true,
    payload: {
      frameIndex: 6,
      frameCount: 8,
      view: {
        board: ["R", "Y", "R", null, "Y", null],
        nextTurnSlotId: "slot-yellow",
      },
    },
    terminalPayload: {
      frameIndex: 7,
      frameCount: 8,
      view: {
        board: ["R", "Y", "R", "R", "Y", "R"],
        nextTurnSlotId: null,
      },
    },
    terminalOutcome: { type: "WIN", winnerSlotId: "slot-red" },
  },
] satisfies readonly [WorkbenchFixture, ...WorkbenchFixture[]]);

export function resolveWorkbenchFixture(id: string): WorkbenchFixture {
  return (
    WORKBENCH_FIXTURES.find((fixture) => fixture.id === id) ??
    WORKBENCH_FIXTURES[0]
  );
}
