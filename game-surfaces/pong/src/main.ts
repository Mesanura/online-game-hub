import Phaser from "phaser";

import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";

import {
  parsePlayView,
  pongSetupViewSchema,
  type PongPlayView,
  type PongSetupIntent,
  type PongSetupView,
} from "./contracts";
import {
  createDirectionIntent,
  createResignIntent,
  createSetupIntent,
  createTargetScoreIntent,
  winnerText,
  resultSummary,
} from "./model";
import { PongScene, type PongRenderState } from "./pong-scene";
import { setupNotice, replaceSetupContents } from "./setup-ui";
import { renderSetupView } from "./setup-presentation";
import "./styles.css";
import "./setup.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = PongSetupView | PongPlayView;

interface RuntimeState {
  readonly mode: "setup" | "play";
  readonly init: HostInit | null;
  readonly hostState: HostState | null;
  readonly payload: SurfacePayload | null;
  readonly previousPlayView: PongPlayView | null;
  readonly receivedAt: number;
  readonly pendingIntentId: string | null;
  readonly pendingIntentType:
    PongSetupIntent["type"] | "DIRECTION" | "RESIGN" | null;
  readonly notice: string | null;
  readonly error: string | null;
  readonly disposed: boolean;
}

function modeFromLocation(): RuntimeState["mode"] {
  if (window.location.pathname.includes("/setup/")) return "setup";
  return "play";
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Surface root element is missing.");
const surfaceRoot = rootElement;
let intentSequence = 0;
let bridge: GameSurfaceBridge | null = null;
let game: Phaser.Game | null = null;
let pongScene: PongScene | null = null;
let runtime: RuntimeState = {
  mode: modeFromLocation(),
  init: null,
  hostState: null,
  payload: null,
  previousPlayView: null,
  receivedAt: 0,
  pendingIntentId: null,
  pendingIntentType: null,
  notice: null,
  error: null,
  disposed: false,
};

function updateRuntime(patch: Partial<RuntimeState>): void {
  runtime = { ...runtime, ...patch };
  render();
}

function reportSurfaceError(code: string, message: string): void {
  updateRuntime({
    error: message,
    pendingIntentId: null,
    pendingIntentType: null,
  });
  bridge?.send({ type: "surface.error", code, message });
}

function parsePayload(message: HostState): SurfacePayload {
  return runtime.mode === "setup"
    ? pongSetupViewSchema.parse(message.payload)
    : parsePlayView(message.payload, runtime.init?.gameVersion ?? "");
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "pong" ||
      !["1.0.0", "1.1.0", "1.2.0"].includes(message.gameVersion) ||
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
      const shouldResyncDirection =
        runtime.hostState !== null &&
        runtime.hostState.connectionState !== "connected" &&
        message.connectionState === "connected";
      const payload = parsePayload(message);
      const resetPending =
        runtime.hostState !== null &&
        (message.connectionState !== "connected" ||
          message.readOnly ||
          message.roundNumber !== runtime.hostState.roundNumber);
      updateRuntime({
        hostState: message,
        payload,
        previousPlayView:
          runtime.mode === "setup"
            ? null
            : runtime.payload === null
              ? null
              : (runtime.payload as PongPlayView),
        receivedAt: performance.now(),
        error: null,
        pendingIntentId: resetPending ? null : runtime.pendingIntentId,
        pendingIntentType: resetPending ? null : runtime.pendingIntentType,
        notice: resetPending
          ? runtime.pendingIntentId !== null &&
            message.connectionState !== "connected"
            ? "连接已中断，请在重连后检查当前设置。"
            : null
          : runtime.notice,
      });
      if (shouldResyncDirection) pongScene?.syncDirection();
      if (runtime.mode === "play") {
        const summary = resultSummary(payload as PongPlayView);
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
    game?.scale.refresh();
    return;
  }
  if (message.type === "host.command") {
    const view = runtime.payload as PongPlayView | null;
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
    const notice = setupNotice(message.status, message.code);
    updateRuntime({ pendingIntentId: null, pendingIntentType: null, notice });
    return;
  }
  game?.destroy(true);
  game = null;
  pongScene = null;
  updateRuntime({
    disposed: true,
    pendingIntentId: null,
    pendingIntentType: null,
  });
}

function submitIntent(
  intent:
    | PongSetupIntent
    | ReturnType<typeof createDirectionIntent>
    | ReturnType<typeof createResignIntent>,
  requestedIntentId?: string,
): void {
  if (
    bridge === null ||
    runtime.disposed ||
    runtime.hostState?.connectionState !== "connected" ||
    runtime.hostState.readOnly ||
    (runtime.mode === "setup" && runtime.pendingIntentId !== null)
  ) {
    if (runtime.mode === "setup") render();
    return;
  }
  if (requestedIntentId === undefined) intentSequence += 1;
  const clientIntentId =
    requestedIntentId ?? `pong-${runtime.mode}-${intentSequence}`;
  if (bridge.send({ type: "surface.intent", clientIntentId, intent })) {
    updateRuntime({
      pendingIntentId: clientIntentId,
      pendingIntentType: intent.type,
      notice: null,
    });
  } else {
    updateRuntime({ notice: "游戏连接尚未就绪。" });
  }
}

function canControl(): boolean {
  return (
    runtime.mode === "play" &&
    runtime.hostState?.connectionState === "connected" &&
    runtime.hostState.readOnly === false &&
    runtime.pendingIntentType !== "RESIGN" &&
    (runtime.payload as PongPlayView | null)?.outcome === null
  );
}

function ensureGame(): void {
  if (game !== null || runtime.mode === "setup") return;
  const parent = document.getElementById("pong-canvas");
  if (parent === null) return;
  pongScene = new PongScene({
    getRenderState: (): PongRenderState | null => {
      if (runtime.payload === null || runtime.mode === "setup") return null;
      return {
        gameVersion: runtime.init?.gameVersion ?? "",
        current: runtime.payload as PongPlayView,
        previous: runtime.previousPlayView,
        receivedAt: runtime.receivedAt,
        reducedMotion: runtime.init?.reducedMotion ?? false,
      };
    },
    canControl,
    onDirection: (direction) => submitIntent(createDirectionIntent(direction)),
  });
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: 800,
    height: 400,
    backgroundColor: "#142827",
    render: { antialias: true, pixelArt: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 800,
      height: 400,
    },
    scene: pongScene,
  });
}

function renderStatus(hostState: HostState): string {
  const connectionLabel =
    hostState.connectionState === "connected"
      ? "已连接"
      : hostState.connectionState === "reconnecting"
        ? "正在重连"
        : "等待连接";
  return `<span data-connection="${hostState.connectionState}">${connectionLabel}</span>${
    runtime.pendingIntentId === null ||
    runtime.pendingIntentType === "DIRECTION"
      ? ""
      : "<span>正在确认操作…</span>"
  }`;
}

function renderPlay(hostState: HostState, view: PongPlayView): string {
  const status =
    view.outcome === null
      ? hostState.connectionState === "connected"
        ? "比赛进行中"
        : "正在恢复比赛"
      : winnerText(view);
  const role =
    view.yourSide === null
      ? "旁观"
      : `你在${view.yourSide === "LEFT" ? "左" : "右"}侧`;
  return `<main class="play-surface"><section class="pong-shell" aria-labelledby="pong-title">
    <header class="pong-header"><div><div class="eyebrow">Pong</div><h1 id="pong-title">${status}</h1></div><span class="side-chip" id="pong-side">${role}</span></header>
    <span class="sr-only" data-testid="score-left" id="score-left">${view.scores[0]}</span>
    <span class="sr-only" data-testid="score-right" id="score-right">${view.scores[1]}</span>
    <span class="sr-only" data-testid="pong-outcome" id="pong-outcome">${view.outcome === null ? "" : view.outcome.reason}</span>
    <div class="pong-stage"><div aria-label="Pong 逻辑场地" class="pong-canvas" id="pong-canvas" tabindex="0"></div></div>
    <div class="pong-footer"><span>方向键或 W / S 控制</span><div class="surface-meta" id="pong-meta" aria-live="polite">${renderStatus(hostState)}</div></div>
  </section></main>`;
}

function updatePlayChrome(hostState: HostState, view: PongPlayView): void {
  const title = document.getElementById("pong-title");
  if (title !== null) {
    title.textContent =
      view.outcome === null
        ? hostState.connectionState === "connected"
          ? "比赛进行中"
          : "正在恢复比赛"
        : winnerText(view);
  }
  const side = document.getElementById("pong-side");
  if (side !== null) {
    side.textContent =
      view.yourSide === null
        ? "旁观"
        : `你在${view.yourSide === "LEFT" ? "左" : "右"}侧`;
  }
  const meta = document.getElementById("pong-meta");
  const status = renderStatus(hostState);
  if (meta !== null && meta.innerHTML !== status) meta.innerHTML = status;
  const scoreLeft = document.getElementById("score-left");
  if (scoreLeft !== null) scoreLeft.textContent = String(view.scores[0]);
  const scoreRight = document.getElementById("score-right");
  if (scoreRight !== null) scoreRight.textContent = String(view.scores[1]);
  const outcome = document.getElementById("pong-outcome");
  if (outcome !== null) outcome.textContent = view.outcome?.reason ?? "";
}

function bindSetupControls(): void {
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-starter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-pressed") === "true") return;
        const value = button.dataset.starter;
        if (value === "OWNER" || value === "NON_OWNER" || value === "RANDOM") {
          submitIntent(createSetupIntent(value));
        }
      });
    });
  surfaceRoot
    .querySelector<HTMLSelectElement>("select[data-target-score]")
    ?.addEventListener("change", (event) => {
      const score = Number((event.currentTarget as HTMLSelectElement).value);
      if (Number.isInteger(score) && score >= 1 && score <= 9) {
        submitIntent(createTargetScoreIntent(score));
      }
    });
}

function render(): void {
  if (runtime.error !== null) {
    game?.destroy(true);
    game = null;
    pongScene = null;
    surfaceRoot.innerHTML = `<main class="surface-center" role="alert"><div class="message-card"><h1>游戏画面无法继续</h1><p>${runtime.error}</p></div></main>`;
    return;
  }
  if (runtime.disposed) {
    surfaceRoot.innerHTML =
      '<main class="surface-center"><div class="message-card">游戏画面已关闭。</div></main>';
    return;
  }
  if (
    runtime.init === null ||
    runtime.hostState === null ||
    runtime.payload === null
  ) {
    surfaceRoot.innerHTML =
      '<main class="surface-center" role="status"><div class="loading-ball" aria-hidden="true"></div><p>正在同步游戏…</p></main>';
    return;
  }
  if (runtime.mode === "setup") {
    replaceSetupContents(
      surfaceRoot,
      renderSetupView(
        runtime.payload as PongSetupView,
        runtime.hostState.readOnly ||
          runtime.hostState.connectionState !== "connected",
        runtime.pendingIntentId !== null,
        renderStatus(runtime.hostState),
      ),
    );
    bindSetupControls();
  } else if (game === null) {
    surfaceRoot.innerHTML = renderPlay(
      runtime.hostState,
      runtime.payload as PongPlayView,
    );
    ensureGame();
  } else {
    updatePlayChrome(runtime.hostState, runtime.payload as PongPlayView);
  }
  const existingNotice = document.getElementById("surface-notice");
  existingNotice?.remove();
  if (runtime.notice !== null) {
    const notice = document.createElement("div");
    notice.className = "surface-notice";
    notice.id = "surface-notice";
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
    updateRuntime({
      error: "与网站的安全通信已中断。",
      pendingIntentId: null,
      pendingIntentType: null,
    }),
});
bridge.start();
