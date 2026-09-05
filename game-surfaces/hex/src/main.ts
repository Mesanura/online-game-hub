import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

import {
  HEX_BOARD_SIZE,
  hexPlayViewSchema,
  hexSetupViewSchema,
  type HexPlayView,
  type HexSetupIntent,
  type HexSetupView,
} from "./contracts";
import {
  colorForSlot,
  coordinateLabel,
  createPlaceStoneIntent,
  createResignIntent,
  createSetupIntent,
  layoutForCell,
  outcomeLabel,
  setupStatusLabel,
} from "./model";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = HexSetupView | HexPlayView;

interface RuntimeState {
  readonly mode: SurfaceMode;
  readonly init: HostInit | null;
  readonly hostState: HostState | null;
  readonly payload: SurfacePayload | null;
  readonly pendingIntentId: string | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly disposed: boolean;
}

function modeFromLocation(): SurfaceMode {
  if (window.location.pathname.includes("/setup/")) return "setup";
  if (window.location.pathname.includes("/replay/")) return "replay";
  return "play";
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Surface root element is missing.");
const surfaceRoot = rootElement;
let bridge: GameSurfaceBridge | null = null;
let intentSequence = 0;
let runtime: RuntimeState = {
  mode: modeFromLocation(),
  init: null,
  hostState: null,
  payload: null,
  pendingIntentId: null,
  notice: null,
  error: null,
  disposed: false,
};

function updateRuntime(patch: Partial<RuntimeState>): void {
  runtime = { ...runtime, ...patch };
  render();
}

function reportSurfaceError(code: string, message: string): void {
  updateRuntime({ error: message, pendingIntentId: null });
  bridge?.send({ type: "surface.error", code, message });
}

function parsePayload(message: HostState): SurfacePayload {
  return runtime.mode === "setup"
    ? hexSetupViewSchema.parse(message.payload)
    : hexPlayViewSchema.parse(message.payload);
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "hex" ||
      message.gameVersion !== "1.0.0" ||
      message.mode !== runtime.mode
    ) {
      reportSurfaceError(
        "SURFACE_TARGET_MISMATCH",
        "游戏画面与房间版本不匹配。",
      );
      return;
    }
    document.documentElement.dataset.reducedMotion = String(
      message.reducedMotion,
    );
    document.documentElement.lang = message.locale;
    updateRuntime({ init: message });
    return;
  }
  if (message.type === "host.state") {
    if (runtime.init === null) {
      reportSurfaceError("STATE_BEFORE_INIT", "游戏画面尚未完成初始化。");
      return;
    }
    try {
      updateRuntime({
        hostState: message,
        payload: parsePayload(message),
        error: null,
      });
    } catch {
      reportSurfaceError("INVALID_PROJECTED_VIEW", "服务器视图格式无效。");
    }
    return;
  }
  if (message.type === "host.environment") {
    document.documentElement.style.setProperty(
      "--surface-width",
      `${message.width}px`,
    );
    document.documentElement.style.setProperty(
      "--surface-height",
      `${message.height}px`,
    );
    document.documentElement.dataset.fullscreen = String(message.fullscreen);
    return;
  }
  if (message.type === "host.command") {
    const view = runtime.payload as HexPlayView | null;
    if (
      runtime.mode !== "play" ||
      runtime.hostState?.connectionState !== "connected" ||
      runtime.hostState?.readOnly !== false ||
      view?.outcome !== null
    ) {
      reportSurfaceError(
        "PLATFORM_CONTROL_NOT_ALLOWED",
        "当前游戏状态不允许执行平台控制。",
      );
      return;
    }
    submitIntent(createResignIntent(), message.clientIntentId);
    return;
  }
  if (message.type === "host.intent-result") {
    if (message.clientIntentId !== runtime.pendingIntentId) return;
    const notice =
      message.status === "accepted"
        ? null
        : message.status === "stale"
          ? "房间状态已更新，请重新操作。"
          : `操作未被接受${message.code === undefined ? "" : `：${message.code}`}`;
    updateRuntime({ pendingIntentId: null, notice });
    return;
  }
  updateRuntime({ disposed: true, pendingIntentId: null });
}

function submitIntent(
  intent:
    | HexSetupIntent
    | ReturnType<typeof createPlaceStoneIntent>
    | ReturnType<typeof createResignIntent>,
  requestedIntentId?: string,
): void {
  if (bridge === null || runtime.pendingIntentId !== null) return;
  if (requestedIntentId === undefined) intentSequence += 1;
  const clientIntentId =
    requestedIntentId ?? `hex-${runtime.mode}-${intentSequence}`;
  if (bridge.send({ type: "surface.intent", clientIntentId, intent })) {
    updateRuntime({ pendingIntentId: clientIntentId, notice: null });
  } else {
    updateRuntime({ notice: "游戏连接尚未就绪。" });
  }
}

function renderStatus(hostState: HostState): string {
  const label =
    hostState.connectionState === "connected"
      ? "已连接"
      : hostState.connectionState === "reconnecting"
        ? "正在重连"
        : "等待连接";
  return `<span data-connection="${hostState.connectionState}">${label}</span>${runtime.pendingIntentId === null ? "" : "<span>正在确认操作…</span>"}`;
}

function renderSetup(hostState: HostState, view: HexSetupView): string {
  const disabled =
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    !view.canEdit ||
    runtime.pendingIntentId !== null;
  const options = [
    ["OWNER", "房主先手", "房主使用蓝棋"],
    ["NON_OWNER", "对手先手", "加入房间的玩家使用蓝棋"],
    ["RANDOM", "随机先手", "由权威服务端决定蓝方"],
  ] as const;
  return `<main class="surface-center"><section class="setup-card" aria-labelledby="setup-title">
    <div class="eyebrow">下一局设置</div><h1 id="setup-title">选择蓝方玩家</h1>
    <p>${setupStatusLabel(view)}</p><div class="setup-options" role="group" aria-label="先手规则">
      ${options
        .map(
          ([value, label, description]) =>
            `<button aria-pressed="${String(view.starter === value)}" data-starter="${value}" ${disabled ? "disabled" : ""} type="button"><strong>${label}</strong><span>${description}</span></button>`,
        )
        .join("")}
    </div><p class="footnote">设置决定本局棋色；双方仍需分别准备。</p>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function canMove(hostState: HostState, view: HexPlayView): boolean {
  if (
    runtime.mode !== "play" ||
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    runtime.pendingIntentId !== null ||
    view.outcome !== null ||
    view.yourColor === null
  ) {
    return false;
  }
  return (
    view.players.find((player) => player.color === view.yourColor)?.slotId ===
    view.nextTurnSlotId
  );
}

type HexEdgeKind = "upper-left" | "upper-right" | "lower-right" | "lower-left";
type HexVertex =
  "top-left" | "top-right" | "right" | "bottom-right" | "bottom-left" | "left";

const edgeKinds: readonly HexEdgeKind[] = [
  "upper-left",
  "upper-right",
  "lower-right",
  "lower-left",
];
const vertexOffsets: Readonly<Record<HexVertex, readonly [number, number]>> = {
  "top-left": [-0.25, -0.5],
  "top-right": [0.25, -0.5],
  right: [0.5, 0],
  "bottom-right": [0.25, 0.5],
  "bottom-left": [-0.25, 0.5],
  left: [-0.5, 0],
};

function svgPoint(row: number, column: number, vertex: HexVertex): string {
  const layout = layoutForCell(row * HEX_BOARD_SIZE + column);
  const [offsetX, offsetY] = vertexOffsets[vertex];
  return `${(layout.x + 0.5 + offsetX) * 100},${(layout.y + 5.5 + offsetY) * 100}`;
}

function edgeBandPath(kind: HexEdgeKind): string {
  const points: string[] = [];
  const append = (row: number, column: number, vertex: HexVertex) => {
    const point = svgPoint(row, column, vertex);
    if (points.at(-1) !== point) points.push(point);
  };
  if (kind === "upper-left") {
    append(0, 0, "left");
    for (let row = 0; row < HEX_BOARD_SIZE; row += 1) {
      append(row, 0, "top-left");
      append(row, 0, "top-right");
    }
  } else if (kind === "upper-right") {
    append(HEX_BOARD_SIZE - 1, 0, "top-right");
    for (let column = 0; column < HEX_BOARD_SIZE; column += 1) {
      append(HEX_BOARD_SIZE - 1, column, "right");
      if (column < HEX_BOARD_SIZE - 1) {
        append(HEX_BOARD_SIZE - 1, column + 1, "top-right");
      }
    }
  } else if (kind === "lower-right") {
    append(0, HEX_BOARD_SIZE - 1, "bottom-right");
    for (let row = 0; row < HEX_BOARD_SIZE; row += 1) {
      append(row, HEX_BOARD_SIZE - 1, "right");
      if (row < HEX_BOARD_SIZE - 1) {
        append(row + 1, HEX_BOARD_SIZE - 1, "bottom-right");
      }
    }
  } else {
    append(0, 0, "left");
    for (let column = 0; column < HEX_BOARD_SIZE; column += 1) {
      append(0, column, "bottom-left");
      append(0, column, "bottom-right");
    }
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point}`)
    .join(" ");
}

function edgeCoordinate(kind: HexEdgeKind, index: number) {
  const row = kind === "lower-left" ? 0 : kind === "upper-right" ? 10 : index;
  const column =
    kind === "upper-left" ? 0 : kind === "lower-right" ? 10 : index;
  const label =
    kind === "upper-left" || kind === "lower-right"
      ? String.fromCharCode(65 + index)
      : String(index + 1);
  return { row, column, label };
}

function renderBoard(view: HexPlayView, movable: boolean): string {
  const winningPath =
    view.outcome?.reason === "CONNECTION"
      ? new Set(view.outcome.winningPath)
      : new Set<number>();
  const cells = view.board
    .map((slotId, cell) => {
      const color = colorForSlot(view, slotId);
      const layout = layoutForCell(cell);
      const coordinate = coordinateLabel(cell);
      return `<button aria-label="${coordinate}，${color === null ? "空" : color === "BLUE" ? "蓝方" : "红方"}" class="hex-cell${winningPath.has(cell) ? " winning-cell" : ""}" data-cell-index="${cell}" data-color="${color ?? "EMPTY"}" data-coordinate="${coordinate}" data-layout-x="${layout.x}" data-layout-y="${layout.y}" ${!movable || slotId !== null ? "disabled" : ""} role="gridcell" style="grid-column:${(layout.row + layout.column) * 3 + 1} / span 4;grid-row:${layout.column - layout.row + HEX_BOARD_SIZE} / span 2" type="button">${color === null ? "" : '<span aria-hidden="true" class="hex-piece"></span>'}</button>`;
    })
    .join("");
  const bands = edgeKinds
    .map(
      (kind) =>
        `<path class="hex-edge-band hex-edge-band-${kind === "upper-left" || kind === "lower-right" ? "red" : "blue"}" d="${edgeBandPath(kind)}"></path>`,
    )
    .join("");
  const coordinates = edgeKinds
    .flatMap((kind) =>
      Array.from({ length: HEX_BOARD_SIZE }, (_, index) => {
        const coordinate = edgeCoordinate(kind, index);
        const layout = layoutForCell(
          coordinate.row * HEX_BOARD_SIZE + coordinate.column,
        );
        return `<span aria-hidden="true" class="hex-coordinate hex-coordinate-${kind}" style="grid-column:${(layout.row + layout.column) * 3 + 1} / span 4;grid-row:${layout.column - layout.row + HEX_BOARD_SIZE} / span 2">${coordinate.label}</span>`;
      }),
    )
    .join("");
  return `<div aria-colcount="${HEX_BOARD_SIZE}" aria-label="六贯棋棋盘" aria-rowcount="${HEX_BOARD_SIZE}" class="hex-board" role="grid">${cells}<svg aria-hidden="true" class="hex-edge-bands" preserveAspectRatio="none" viewBox="0 0 1600 1100">${bands}</svg>${coordinates}</div>`;
}

function renderPlay(hostState: HostState, view: HexPlayView): string {
  const movable = canMove(hostState, view);
  const nextColor = colorForSlot(view, view.nextTurnSlotId);
  const title =
    view.outcome !== null
      ? outcomeLabel(view)
      : runtime.mode === "replay"
        ? "对局回放"
        : movable
          ? "轮到你落子"
          : nextColor === null
            ? "等待服务器同步回合"
            : `当前回合：${nextColor === "BLUE" ? "蓝方" : "红方"}`;
  const role =
    view.yourColor === null
      ? "你正在旁观"
      : `你的棋子：${view.yourColor === "BLUE" ? "蓝方" : "红方"}`;
  return `<main class="play-surface"><section class="game-card" aria-labelledby="game-title">
    <header><div><div class="eyebrow">${runtime.mode === "replay" ? "Replay" : "Hex"}</div><h1 data-testid="turn-status" id="game-title">${title}</h1></div><span class="role-chip" data-color="${view.yourColor ?? "SPECTATOR"}" data-testid="player-color">${role}</span></header>
    <div class="board-shell">${renderBoard(view, movable)}</div>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function bindControls(): void {
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-starter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const starter = button.dataset.starter;
        if (
          starter === "OWNER" ||
          starter === "NON_OWNER" ||
          starter === "RANDOM"
        ) {
          submitIntent(createSetupIntent(starter));
        }
      });
    });
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-cell-index]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const cell = Number(button.dataset.cellIndex);
        if (Number.isInteger(cell)) submitIntent(createPlaceStoneIntent(cell));
      });
    });
}

function render(): void {
  if (runtime.error !== null) {
    surfaceRoot.innerHTML = `<main class="surface-center" role="alert"><section class="message-card"><h1>游戏画面无法继续</h1><p>${runtime.error}</p></section></main>`;
    return;
  }
  if (runtime.disposed) {
    surfaceRoot.innerHTML =
      '<main class="surface-center"><section class="message-card">游戏画面已关闭。</section></main>';
    return;
  }
  if (
    runtime.init === null ||
    runtime.hostState === null ||
    runtime.payload === null
  ) {
    surfaceRoot.innerHTML =
      '<main class="surface-center" role="status"><p>正在同步游戏…</p></main>';
    return;
  }
  surfaceRoot.innerHTML =
    runtime.mode === "setup"
      ? renderSetup(runtime.hostState, runtime.payload as HexSetupView)
      : renderPlay(runtime.hostState, runtime.payload as HexPlayView);
  bindControls();
  if (runtime.notice !== null) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.role = "status";
    notice.textContent = runtime.notice;
    surfaceRoot.append(notice);
  }
}

render();
bridge = new GameSurfaceBridge({
  allowedHostOrigin: "*",
  onMessage: handleHostMessage,
  onProtocolError: () =>
    updateRuntime({ error: "与网站的安全通信已中断。", pendingIntentId: null }),
});
bridge.start();
