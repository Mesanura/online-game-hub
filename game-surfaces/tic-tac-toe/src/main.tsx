import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

import {
  ticTacToeHistoricalPlayViewSchema,
  ticTacToePlayViewSchema,
  ticTacToeSetupViewSchema,
  type TicTacToeCellIndex,
  type TicTacToePlayView,
  type TicTacToeSetupIntent,
  type TicTacToeSetupView,
} from "./contracts";
import {
  createPlayIntent,
  createResignIntent,
  createSetupIntent,
  markForSlot,
  playStatusLabel,
  resultSummary,
  setupStatusLabel,
} from "./model";
import { setupNotice } from "./setup-ui";
import "./styles.css";
import "./setup.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = TicTacToeSetupView | TicTacToePlayView;

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
const root = createRoot(rootElement);
let intentSequence = 0;
let bridge: GameSurfaceBridge | null = null;
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
  if (runtime.mode === "setup") {
    return ticTacToeSetupViewSchema.parse(message.payload);
  }
  return runtime.init?.gameVersion === "1.0.0"
    ? ticTacToeHistoricalPlayViewSchema.parse(message.payload)
    : ticTacToePlayViewSchema.parse(message.payload);
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "tic-tac-toe" ||
      (message.gameVersion !== "1.0.0" && message.gameVersion !== "1.1.0") ||
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
      const resetPending =
        runtime.hostState !== null &&
        (message.connectionState !== "connected" ||
          message.readOnly ||
          message.roundNumber !== runtime.hostState.roundNumber);
      updateRuntime({
        hostState: message,
        payload,
        error: null,
        pendingIntentId: resetPending ? null : runtime.pendingIntentId,
        notice: resetPending
          ? runtime.pendingIntentId !== null &&
            message.connectionState !== "connected"
            ? "连接已中断，请在重连后检查当前设置。"
            : null
          : runtime.notice,
      });
      if (runtime.mode === "play") {
        const summary = resultSummary(payload as TicTacToePlayView);
        if (summary !== null) {
          bridge?.send({
            type: "surface.result-summary",
            stateSequence: message.sequence,
            ...summary,
          });
        }
      }
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
    const view = runtime.payload as TicTacToePlayView | null;
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
    const notice = setupNotice(message.status, message.code);
    updateRuntime({ pendingIntentId: null, notice });
    return;
  }
  updateRuntime({ disposed: true, pendingIntentId: null });
}

function submitIntent(
  intent:
    | TicTacToeSetupIntent
    | ReturnType<typeof createPlayIntent>
    | ReturnType<typeof createResignIntent>,
  requestedIntentId?: string,
): void {
  if (
    bridge === null ||
    runtime.pendingIntentId !== null ||
    runtime.disposed ||
    runtime.hostState?.connectionState !== "connected" ||
    runtime.hostState.readOnly
  )
    return;
  if (requestedIntentId === undefined) intentSequence += 1;
  const clientIntentId =
    requestedIntentId ?? `tic-tac-toe-${runtime.mode}-${intentSequence}`;
  if (
    bridge.send({
      type: "surface.intent",
      clientIntentId,
      intent,
    })
  ) {
    updateRuntime({ pendingIntentId: clientIntentId, notice: null });
  } else {
    updateRuntime({ notice: "游戏连接尚未就绪。" });
  }
}

function SurfaceStatus({ hostState }: { readonly hostState: HostState }) {
  const connectionLabel =
    hostState.connectionState === "connected"
      ? "已连接"
      : hostState.connectionState === "reconnecting"
        ? "正在重连"
        : "等待连接";
  return (
    <div className="surface-meta" aria-live="polite">
      <span data-connection={hostState.connectionState}>{connectionLabel}</span>
      {runtime.pendingIntentId === null ? null : <span>正在确认操作…</span>}
    </div>
  );
}

function SetupSurface({
  hostState,
  view,
}: {
  readonly hostState: HostState;
  readonly view: TicTacToeSetupView;
}) {
  const disabled =
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    !view.canEdit;
  const options = [
    ["OWNER", "房主先手", "由创建房间的玩家执 X"],
    ["NON_OWNER", "另一位玩家先手", "由加入房间的玩家执 X"],
    ["RANDOM", "随机先手", "开始时随机决定谁执 X"],
  ] as const;
  return (
    <main className="setup-surface">
      <section className="setup-card" aria-labelledby="setup-title">
        <div className="eyebrow">下一局设置</div>
        <h1 id="setup-title">选择谁先手</h1>
        <p
          className="setup-summary"
          data-testid="setup-summary"
          aria-live="polite"
        >
          {setupStatusLabel(view)}
        </p>
        <figure className="setup-preview" data-testid="setup-preview">
          <svg
            viewBox="0 0 160 160"
            role="img"
            aria-label="三乘三棋盘，第一行三个X相连获胜"
          >
            <rect width="160" height="160" rx="18" fill="#ede5f7" />
            <path
              d="M55 12v136M105 12v136M12 55h136M12 105h136"
              stroke="#ad9bc5"
              strokeWidth="2"
            />
            <g fill="#67539f" fontSize="32" textAnchor="middle">
              <text x="30" y="43">
                X
              </text>
              <text x="80" y="43">
                X
              </text>
              <text x="130" y="43">
                X
              </text>
              <text x="80" y="94" fill="#327662">
                O
              </text>
              <text x="30" y="144" fill="#327662">
                O
              </text>
            </g>
            <path d="M17 30h126" stroke="#67539f" strokeWidth="2" />
          </svg>
          <figcaption>
            <strong>X 先手，O 后手</strong>
            <p>
              轮流在 3×3
              棋盘的空格落子。横、竖或斜向三子相连即获胜；九格填满且无人三连则平局。
            </p>
          </figcaption>
        </figure>
        <p className="setup-footnote">
          已加入 {view.participantSlotIds.length}/2 人；
          {view.canEdit
            ? "选择本局设置后，双方分别准备。"
            : "由房主修改本局规则，你可以查看后准备。"}
        </p>
        <div className="setup-options" role="group" aria-label="先手规则">
          {options.map(([value, label, description]) => (
            <button
              aria-pressed={view.starter === value}
              aria-disabled={disabled || runtime.pendingIntentId !== null}
              className="setup-option"
              disabled={disabled}
              key={value}
              onClick={() => {
                if (view.starter !== value)
                  submitIntent(createSetupIntent(value));
              }}
              type="button"
            >
              <strong>{label}</strong>
              <span>{description}</span>
            </button>
          ))}
        </div>
        <p className="setup-footnote">
          设置确认后，每位参与者仍需在房间准备区分别确认。
        </p>
        <SurfaceStatus hostState={hostState} />
      </section>
    </main>
  );
}

function PlaySurface({
  hostState,
  view,
}: {
  readonly hostState: HostState;
  readonly view: TicTacToePlayView;
}) {
  const yourPlayer = view.players.find(
    (player) => player.mark === view.yourMark,
  );
  const isYourTurn =
    view.outcome === null &&
    yourPlayer !== undefined &&
    yourPlayer.slotId === view.nextTurnSlotId;
  const winningCells =
    view.outcome?.type === "WIN" && "winningCells" in view.outcome
      ? new Set<TicTacToeCellIndex>(view.outcome.winningCells)
      : new Set<TicTacToeCellIndex>();
  const interactionDisabled =
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    runtime.pendingIntentId !== null ||
    !isYourTurn;

  return (
    <main className="play-surface">
      <section className="board-shell" aria-labelledby="board-title">
        <header className="board-header">
          <div>
            <div className="eyebrow">
              {runtime.mode === "replay" ? "对局回放" : "井字棋"}
            </div>
            <h1 id="board-title">{playStatusLabel(view)}</h1>
          </div>
          <div className="mark-chip">
            {view.yourMark === null ? "旁观" : `你的棋子 ${view.yourMark}`}
          </div>
        </header>
        <div className="tic-board" role="grid" aria-label="井字棋棋盘">
          {view.board.map((slotId, index) => {
            const cell = index as TicTacToeCellIndex;
            const mark = markForSlot(view, slotId);
            return (
              <button
                aria-label={`格子 ${index + 1}${mark === null ? "，空" : `，${mark}`}`}
                className={winningCells.has(cell) ? "winning-cell" : undefined}
                disabled={interactionDisabled || slotId !== null}
                key={cell}
                onClick={() => submitIntent(createPlayIntent(cell))}
                role="gridcell"
                type="button"
              >
                <span data-mark={mark}>{mark}</span>
              </button>
            );
          })}
        </div>
        <SurfaceStatus hostState={hostState} />
      </section>
    </main>
  );
}

function SurfaceApp() {
  if (runtime.error !== null) {
    return (
      <main className="surface-center" role="alert">
        <div className="message-card">
          <h1>游戏画面无法继续</h1>
          <p>{runtime.error}</p>
        </div>
      </main>
    );
  }
  if (runtime.disposed) {
    return (
      <main className="surface-center">
        <div className="message-card">游戏画面已关闭。</div>
      </main>
    );
  }
  if (
    runtime.init === null ||
    runtime.hostState === null ||
    runtime.payload === null
  ) {
    return (
      <main className="surface-center" role="status">
        <div className="loading-mark" aria-hidden="true">
          ×
        </div>
        <p>正在同步游戏…</p>
      </main>
    );
  }
  return (
    <>
      {runtime.mode === "setup" ? (
        <SetupSurface
          hostState={runtime.hostState}
          view={runtime.payload as TicTacToeSetupView}
        />
      ) : (
        <PlaySurface
          hostState={runtime.hostState}
          view={runtime.payload as TicTacToePlayView}
        />
      )}
      {runtime.notice === null ? null : (
        <div className="surface-notice" role="status">
          {runtime.notice}
        </div>
      )}
    </>
  );
}

function render(): void {
  root.render(
    <StrictMode>
      <SurfaceApp />
    </StrictMode>,
  );
}

render();
bridge = new GameSurfaceBridge({
  allowedHostOrigin: "*",
  onMessage: handleHostMessage,
  onProtocolError: () =>
    updateRuntime({
      error: "与网站的安全通信已中断。",
      pendingIntentId: null,
    }),
});
bridge.start();
