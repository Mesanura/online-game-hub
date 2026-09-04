import Phaser from "phaser";

import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
  type SurfaceMode,
} from "@online-game-hub/game-surface-bridge";

import {
  pongPlayViewSchema,
  pongSetupViewSchema,
  type PongPlayView,
  type PongSetupIntent,
  type PongSetupView,
} from "./contracts";
import {
  createDirectionIntent,
  createSetupIntent,
  setupStatusLabel,
  winnerText,
} from "./model";
import { PongScene, type PongRenderState } from "./pong-scene";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { readonly type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { readonly type: "host.state" }>;
type SurfacePayload = PongSetupView | PongPlayView;

interface RuntimeState {
  readonly mode: SurfaceMode;
  readonly init: HostInit | null;
  readonly hostState: HostState | null;
  readonly payload: SurfacePayload | null;
  readonly previousPlayView: PongPlayView | null;
  readonly receivedAt: number;
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
    ? pongSetupViewSchema.parse(message.payload)
    : pongPlayViewSchema.parse(message.payload);
}

function handleHostMessage(message: HostSurfaceMessage): void {
  if (message.type === "host.init") {
    if (
      message.gameId !== "pong" ||
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
      const shouldResyncDirection =
        runtime.hostState !== null &&
        runtime.hostState.connectionState !== "connected" &&
        message.connectionState === "connected";
      const payload = parsePayload(message);
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
      });
      if (shouldResyncDirection) pongScene?.syncDirection();
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
  game?.destroy(true);
  game = null;
  pongScene = null;
  updateRuntime({ disposed: true, pendingIntentId: null });
}

function submitIntent(
  intent: PongSetupIntent | ReturnType<typeof createDirectionIntent>,
): void {
  if (
    bridge === null ||
    (runtime.mode === "setup" && runtime.pendingIntentId !== null)
  ) {
    return;
  }
  intentSequence += 1;
  const clientIntentId = `pong-${runtime.mode}-${intentSequence}`;
  if (bridge.send({ type: "surface.intent", clientIntentId, intent })) {
    updateRuntime({ pendingIntentId: clientIntentId, notice: null });
  } else {
    updateRuntime({ notice: "游戏连接尚未就绪。" });
  }
}

function canControl(): boolean {
  return (
    runtime.mode === "play" &&
    runtime.hostState?.connectionState === "connected" &&
    runtime.hostState.readOnly === false &&
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
    type: Phaser.AUTO,
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
    runtime.pendingIntentId === null ? "" : "<span>正在确认操作…</span>"
  }`;
}

function renderSetup(hostState: HostState, view: PongSetupView): string {
  const disabled =
    hostState.readOnly ||
    hostState.connectionState !== "connected" ||
    !view.canEdit ||
    runtime.pendingIntentId !== null;
  const options = [
    ["OWNER", "房主发球", "由创建房间的玩家先发球"],
    ["NON_OWNER", "对手发球", "由加入房间的玩家先发球"],
    ["RANDOM", "随机发球", "开始时由权威服务端抽取"],
  ] as const;
  return `<main class="setup-surface"><section class="setup-card" aria-labelledby="setup-title">
    <div class="eyebrow">下一局设置</div><h1 id="setup-title">选择发球方</h1>
    <p class="setup-summary">${setupStatusLabel(view)}</p>
    <div class="setup-options" role="group" aria-label="发球规则">
      ${options
        .map(
          ([value, label, description]) =>
            `<button aria-pressed="${String(
              view.starter === value,
            )}" class="setup-option" data-starter="${value}" ${disabled ? "disabled" : ""} type="button"><strong>${label}</strong><span>${description}</span></button>`,
        )
        .join("")}
    </div>
    <p class="setup-footnote">本阶段比分目标固定为 ${view.config.targetScore} 分。设置后两位玩家仍需分别准备。</p>
    <div class="surface-meta" aria-live="polite">${renderStatus(hostState)}</div>
  </section></main>`;
}

function renderPlay(hostState: HostState, view: PongPlayView): string {
  const status =
    view.outcome === null
      ? hostState.connectionState === "connected"
        ? runtime.mode === "replay"
          ? "对局回放"
          : "比赛进行中"
        : "正在恢复比赛"
      : winnerText(view);
  const role =
    view.yourSide === null
      ? "旁观"
      : `你在${view.yourSide === "LEFT" ? "左" : "右"}侧`;
  return `<main class="play-surface"><section class="pong-shell" aria-labelledby="pong-title">
    <header class="pong-header"><div><div class="eyebrow">${runtime.mode === "replay" ? "对局回放" : "Pong"}</div><h1 id="pong-title">${status}</h1></div><span class="side-chip" id="pong-side">${role}</span></header>
    <div aria-label="Pong 逻辑场地" class="pong-canvas" id="pong-canvas" tabindex="0"></div>
    <div class="pong-footer"><span>方向键或 W / S 控制</span><div class="surface-meta" id="pong-meta" aria-live="polite">${renderStatus(hostState)}</div></div>
  </section></main>`;
}

function updatePlayChrome(hostState: HostState, view: PongPlayView): void {
  const title = document.getElementById("pong-title");
  if (title !== null) {
    title.textContent =
      view.outcome === null
        ? hostState.connectionState === "connected"
          ? runtime.mode === "replay"
            ? "对局回放"
            : "比赛进行中"
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
  if (meta !== null) meta.innerHTML = renderStatus(hostState);
}

function bindSetupControls(): void {
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-starter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.starter;
        if (value === "OWNER" || value === "NON_OWNER" || value === "RANDOM") {
          submitIntent(createSetupIntent(value));
        }
      });
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
    surfaceRoot.innerHTML = renderSetup(
      runtime.hostState,
      runtime.payload as PongSetupView,
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
    updateRuntime({ error: "与网站的安全通信已中断。", pendingIntentId: null }),
});
bridge.start();
