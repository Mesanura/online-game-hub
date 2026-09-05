import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

import {
  gomokuPlayViewSchema,
  gomokuSetupViewSchema,
  type GomokuPlayView,
  type GomokuSetupIntent,
  type GomokuSetupView,
} from "./contracts";
import {
  createPlaceStoneIntent,
  createResignIntent,
  createSetupIntent,
  outcomeLabel,
  setupStatusLabel,
} from "./model";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = GomokuSetupView | GomokuPlayView;

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
    ? gomokuSetupViewSchema.parse(message.payload)
    : gomokuPlayViewSchema.parse(message.payload);
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "gomoku" ||
      !["1.0.0", "1.1.0"].includes(message.gameVersion) ||
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
    const view = runtime.payload as GomokuPlayView | null;
    if (
      runtime.mode !== "play" ||
      runtime.init?.gameVersion !== "1.1.0" ||
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
    | GomokuSetupIntent
    | ReturnType<typeof createPlaceStoneIntent>
    | ReturnType<typeof createResignIntent>,
  requestedIntentId?: string,
): void {
  if (bridge === null || runtime.pendingIntentId !== null) return;
  if (requestedIntentId === undefined) intentSequence += 1;
  const clientIntentId =
    requestedIntentId ?? `gomoku-${runtime.mode}-${intentSequence}`;
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

function renderSetup(hostState: HostState, view: GomokuSetupView): string {
  const disabled =
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    !view.canEdit ||
    runtime.pendingIntentId !== null;
  const options = [
    ["OWNER", "房主先手", "房主使用黑棋"],
    ["NON_OWNER", "对手先手", "加入房间的玩家使用黑棋"],
    ["RANDOM", "随机先手", "由权威服务端决定黑棋"],
  ] as const;
  return `<main class="surface-center"><section class="setup-card" aria-labelledby="setup-title">
    <div class="eyebrow">下一局设置</div><h1 id="setup-title">选择黑棋玩家</h1>
    <p>${setupStatusLabel(view)}</p><div class="setup-options" role="group" aria-label="先手规则">
      ${options
        .map(
          ([value, label, description]) =>
            `<button aria-pressed="${String(view.starter === value)}" data-starter="${value}" ${disabled ? "disabled" : ""} type="button"><strong>${label}</strong><span>${description}</span></button>`,
        )
        .join("")}
    </div><p class="footnote">本局为 ${view.config.boardSize}×${view.config.boardSize} 棋盘；设置后双方仍需分别准备。</p>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function canMove(hostState: HostState, view: GomokuPlayView): boolean {
  if (
    runtime.mode !== "play" ||
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    runtime.pendingIntentId !== null ||
    view.outcome !== null ||
    view.yourStone === null
  ) {
    return false;
  }
  return (
    view.players.find((player) => player.stone === view.yourStone)?.slotId ===
    view.nextTurnSlotId
  );
}

function renderPlay(hostState: HostState, view: GomokuPlayView): string {
  const winningCells = new Set(
    view.outcome !== null && "winningCells" in view.outcome
      ? view.outcome.winningCells
      : [],
  );
  const movable = canMove(hostState, view);
  const title =
    view.outcome === null
      ? runtime.mode === "replay"
        ? "对局回放"
        : movable
          ? "轮到你落子"
          : "等待对手落子"
      : outcomeLabel(view);
  const role =
    view.yourStone === null
      ? "旁观"
      : `你执${view.yourStone === "BLACK" ? "黑" : "白"}棋`;
  const cells = view.board
    .map((slotId, cell) => {
      const player = view.players.find(
        (candidate) => candidate.slotId === slotId,
      );
      const stone = player?.stone ?? "EMPTY";
      const disabled = !movable || slotId !== null;
      const row = Math.floor(cell / view.boardSize) + 1;
      const column = (cell % view.boardSize) + 1;
      return `<button aria-label="第 ${row} 行第 ${column} 列${stone === "EMPTY" ? "空位" : stone === "BLACK" ? "黑棋" : "白棋"}" class="board-cell" data-cell-index="${cell}" data-stone="${stone}" data-winning="${String(winningCells.has(cell))}" ${disabled ? "disabled" : ""} role="gridcell" type="button"><span></span></button>`;
    })
    .join("");
  return `<main class="play-surface"><section class="game-card" aria-labelledby="game-title">
    <header><div><div class="eyebrow">${runtime.mode === "replay" ? "Replay" : "Gomoku"}</div><h1 data-testid="turn-status" id="game-title">${title}</h1></div><span class="role-chip" data-testid="player-stone">${role}</span></header>
    <div aria-label="五子棋棋盘" class="board" role="grid" style="--board-size: ${view.boardSize}">${cells}</div>
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
      ? renderSetup(runtime.hostState, runtime.payload as GomokuSetupView)
      : renderPlay(runtime.hostState, runtime.payload as GomokuPlayView);
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
