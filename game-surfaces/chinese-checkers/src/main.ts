import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

import {
  CHINESE_CHECKERS_CAMPS,
  chineseCheckersPlayViewSchema,
  chineseCheckersSetupViewSchema,
  type ChineseCheckersPlayIntent,
  type ChineseCheckersPlayView,
  type ChineseCheckersSetupIntent,
  type ChineseCheckersSetupView,
} from "./contracts";
import {
  campForCell,
  campForSlot,
  createCampIntent,
  createMovePieceIntent,
  createPlayerCountIntent,
  createResignIntent,
  createStarterIntent,
  layoutForCell,
  legalTargetsForSelection,
  outcomeLabel,
  setupStatusLabel,
  type ChineseCheckersCamp,
} from "./model";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = ChineseCheckersSetupView | ChineseCheckersPlayView;

interface RuntimeState {
  readonly mode: SurfaceMode;
  readonly init: HostInit | null;
  readonly hostState: HostState | null;
  readonly payload: SurfacePayload | null;
  readonly pendingIntentId: string | null;
  readonly selectedCell: number | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly disposed: boolean;
}

const campLabels: Readonly<Record<ChineseCheckersCamp, string>> = {
  N: "北营地",
  NE: "东北营地",
  SE: "东南营地",
  S: "南营地",
  SW: "西南营地",
  NW: "西北营地",
};

function modeFromLocation(): SurfaceMode {
  if (window.location.pathname.includes("/setup/")) return "setup";
  if (window.location.pathname.includes("/replay/")) return "replay";
  return "play";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  selectedCell: null,
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
    ? chineseCheckersSetupViewSchema.parse(message.payload)
    : chineseCheckersPlayViewSchema.parse(message.payload);
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "chinese-checkers" ||
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
      const payload = parsePayload(message);
      const selectedCell =
        runtime.mode === "setup" || runtime.selectedCell === null
          ? null
          : (payload as ChineseCheckersPlayView).legalMoves.some(
                (move) => move.from === runtime.selectedCell,
              )
            ? runtime.selectedCell
            : null;
      updateRuntime({
        hostState: message,
        payload,
        selectedCell,
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
    const view = runtime.payload as ChineseCheckersPlayView | null;
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
    updateRuntime({
      pendingIntentId: null,
      selectedCell: message.status === "accepted" ? null : runtime.selectedCell,
      notice,
    });
    return;
  }
  updateRuntime({ disposed: true, pendingIntentId: null, selectedCell: null });
}

function submitIntent(
  intent: ChineseCheckersSetupIntent | ChineseCheckersPlayIntent,
  requestedIntentId?: string,
): void {
  if (bridge === null || runtime.pendingIntentId !== null) return;
  if (requestedIntentId === undefined) intentSequence += 1;
  const clientIntentId =
    requestedIntentId ?? `chinese-checkers-${runtime.mode}-${intentSequence}`;
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

function setupDisabled(hostState: HostState): boolean {
  return (
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    runtime.pendingIntentId !== null
  );
}

function renderSetup(
  hostState: HostState,
  view: ChineseCheckersSetupView,
): string {
  const disabled = setupDisabled(hostState);
  const playerCounts = Array.from({ length: 5 }, (_, index) => index + 2)
    .map(
      (count) =>
        `<option ${view.targetPlayerCount === count ? "selected" : ""} value="${count}">${count} 人</option>`,
    )
    .join("");
  const starters = [
    ["OWNER", "房主首位", "由房主所在营地开始"],
    ["NON_OWNER", "其他玩家首位", "按营地逆时针选择首位非房主"],
    ["RANDOM", "随机首位", "服务端在房主与首位非房主之间决定"],
  ] as const;
  const participantCamps = new Set(
    view.participants.flatMap((participant) =>
      participant.camp === null ? [] : [participant.camp],
    ),
  );
  const camps = CHINESE_CHECKERS_CAMPS.map((camp) => {
    const selected = view.yourCamp === camp;
    const taken = participantCamps.has(camp) && !selected;
    const unavailable = disabled || !view.canSelectCamp || taken;
    return `<button aria-pressed="${String(selected)}" class="camp-option" data-camp-option="${camp}" data-camp="${camp}" ${unavailable ? "disabled" : ""} type="button"><span class="camp-dot" aria-hidden="true"></span><strong>${campLabels[camp]}</strong><small>${taken ? "已被选择" : selected ? "你的营地" : "选择此营地"}</small></button>`;
  }).join("");
  const participants = view.participants
    .map(
      (participant) =>
        `<li><span>${escapeHtml(participant.slotId)}${participant.isOwner ? " · 房主" : ""}</span><strong data-participant-camp="${participant.camp ?? "UNSELECTED"}">${participant.camp === null ? "未选营地" : campLabels[participant.camp]}</strong></li>`,
    )
    .join("");
  return `<main class="surface-center"><section class="setup-card" aria-labelledby="setup-title">
    <header class="setup-header"><div><div class="eyebrow">下一局设置</div><h1 id="setup-title">人数、营地与首位</h1></div><label class="player-count">参赛人数<select data-player-count ${disabled || !view.canEditRules ? "disabled" : ""}>${playerCounts}</select></label></header>
    <p data-testid="setup-status">${setupStatusLabel(view)}</p>
    <div class="setup-grid"><section aria-labelledby="camp-title"><h2 id="camp-title">选择你的营地</h2><div class="camp-options" role="group" aria-label="营地选择">${camps}</div>${view.yourCamp === null ? "" : `<button class="clear-camp" data-clear-camp ${disabled || !view.canSelectCamp ? "disabled" : ""} type="button">清除我的营地</button>`}</section>
    <section aria-labelledby="starter-title"><h2 id="starter-title">本局首位</h2><div class="starter-options" role="group" aria-label="首位规则">${starters
      .map(
        ([value, label, description]) =>
          `<button aria-pressed="${String(view.starter === value)}" data-starter="${value}" ${disabled || !view.canEditRules ? "disabled" : ""} type="button"><strong>${label}</strong><span>${description}</span></button>`,
      )
      .join("")}</div></section></div>
    <ol aria-label="参赛席位" class="participant-list">${participants}</ol>
    <p class="footnote">营地决定逆时针顺序；设置完成后每位参赛者仍需分别准备。</p>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function ownSlotId(view: Readonly<ChineseCheckersPlayView>): string | null {
  if (view.yourCamp === null) return null;
  return (
    view.players.find((player) => player.camp === view.yourCamp)?.slotId ?? null
  );
}

function canMove(
  hostState: HostState,
  view: Readonly<ChineseCheckersPlayView>,
): boolean {
  const ownSlot = ownSlotId(view);
  return (
    runtime.mode === "play" &&
    !hostState.readOnly &&
    hostState.connectionState === "connected" &&
    runtime.pendingIntentId === null &&
    view.outcome === null &&
    ownSlot !== null &&
    view.nextTurnSlotId === ownSlot
  );
}

function renderBoard(view: ChineseCheckersPlayView, movable: boolean): string {
  const ownSlot = ownSlotId(view);
  const legalTargets = new Set(
    legalTargetsForSelection(view.legalMoves, runtime.selectedCell),
  );
  const cells = view.board
    .map((slotId, cell) => {
      const layout = layoutForCell(cell);
      const pieceCamp = campForSlot(view, slotId);
      const boardCamp = campForCell(cell);
      const isOwnPiece = slotId !== null && slotId === ownSlot;
      const isLegalSource = view.legalMoves.some((move) => move.from === cell);
      const isSelected = runtime.selectedCell === cell;
      const isLegalTarget = legalTargets.has(cell);
      const enabled = movable && (isOwnPiece || isLegalTarget);
      const occupancy =
        pieceCamp === null ? "空位" : `${campLabels[pieceCamp]}棋子`;
      return `<button aria-label="棋位 ${cell + 1}，${occupancy}${isLegalTarget ? "，可到达" : ""}" class="chinese-checkers-cell${isSelected ? " is-selected" : ""}${isLegalTarget ? " is-legal-target" : ""}" data-camp="${boardCamp ?? "CENTER"}" data-cell-index="${cell}" data-legal-source="${String(isLegalSource)}" data-occupied="${String(slotId !== null)}" data-piece-camp="${pieceCamp ?? "EMPTY"}" ${enabled ? "" : "disabled"} role="gridcell" style="--cc-x:${layout.x};--cc-y:${layout.y}" type="button">${pieceCamp === null ? "" : '<span aria-hidden="true" class="chinese-checkers-piece"></span>'}</button>`;
    })
    .join("");
  return `<div aria-label="中国跳棋六芒星棋盘" class="chinese-checkers-board" role="grid">${cells}</div>`;
}

function rankingReason(
  reason: ChineseCheckersPlayView["rankings"][number]["reason"],
): string {
  if (reason === "FINISHED") return "完成目标营地";
  if (reason === "RESIGNATION") return "投降";
  if (reason === "BLOCKED") return "无路可走";
  return "最后一名未排名玩家";
}

function renderRankings(view: ChineseCheckersPlayView): string {
  if (view.outcome === null) return "";
  return `<ol aria-label="最终排名" class="rankings">${view.outcome.rankings
    .map(
      (entry) =>
        `<li><strong>第 ${entry.rank} 名</strong><span>${escapeHtml(entry.slotId)}</span><small>${rankingReason(entry.reason)}</small></li>`,
    )
    .join("")}</ol>`;
}

function renderPlay(
  hostState: HostState,
  view: ChineseCheckersPlayView,
): string {
  const movable = canMove(hostState, view);
  const nextCamp = campForSlot(view, view.nextTurnSlotId);
  const title =
    view.outcome !== null
      ? outcomeLabel(view)
      : runtime.mode === "replay"
        ? "对局回放"
        : movable
          ? runtime.selectedCell === null
            ? "轮到你行动：选择棋子"
            : "选择高亮的目标棋位"
          : nextCamp === null
            ? "等待服务器同步回合"
            : `当前回合：${campLabels[nextCamp]}`;
  const role =
    view.yourCamp === null
      ? "你正在旁观"
      : `你的棋子：${campLabels[view.yourCamp]}`;
  return `<main class="play-surface"><section class="game-card" aria-labelledby="game-title">
    <header class="game-header"><div><div class="eyebrow">${runtime.mode === "replay" ? "Replay" : "Chinese Checkers"}</div><h1 data-testid="turn-status" id="game-title">${title}</h1></div><span class="role-chip" data-camp="${view.yourCamp ?? "SPECTATOR"}" data-testid="player-camp">${role}</span></header>
    <div class="board-shell">${renderBoard(view, movable)}${renderRankings(view)}</div>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function bindSetupControls(): void {
  surfaceRoot
    .querySelector<HTMLSelectElement>("[data-player-count]")
    ?.addEventListener("change", (event) => {
      const playerCount = Number(
        (event.currentTarget as HTMLSelectElement).value,
      );
      if (Number.isInteger(playerCount)) {
        submitIntent(createPlayerCountIntent(playerCount));
      }
    });
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
          submitIntent(createStarterIntent(starter));
        }
      });
    });
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-camp-option]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const camp = button.dataset.campOption;
        if (CHINESE_CHECKERS_CAMPS.includes(camp as ChineseCheckersCamp)) {
          submitIntent(createCampIntent(camp as ChineseCheckersCamp));
        }
      });
    });
  surfaceRoot
    .querySelector<HTMLButtonElement>("[data-clear-camp]")
    ?.addEventListener("click", () => submitIntent({ type: "CLEAR_CAMP" }));
}

function bindBoardControls(): void {
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-cell-index]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (runtime.hostState === null || runtime.payload === null) return;
        const view = runtime.payload as ChineseCheckersPlayView;
        const cell = Number(button.dataset.cellIndex);
        if (!Number.isInteger(cell) || !canMove(runtime.hostState, view))
          return;
        const targets = new Set(
          legalTargetsForSelection(view.legalMoves, runtime.selectedCell),
        );
        if (runtime.selectedCell !== null && targets.has(cell)) {
          submitIntent(createMovePieceIntent(runtime.selectedCell, cell));
          return;
        }
        if (view.board[cell] === ownSlotId(view)) {
          updateRuntime({
            selectedCell: runtime.selectedCell === cell ? null : cell,
          });
        }
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
      ? renderSetup(
          runtime.hostState,
          runtime.payload as ChineseCheckersSetupView,
        )
      : renderPlay(
          runtime.hostState,
          runtime.payload as ChineseCheckersPlayView,
        );
  if (runtime.mode === "setup") bindSetupControls();
  else bindBoardControls();
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
