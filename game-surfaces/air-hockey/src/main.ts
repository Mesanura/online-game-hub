import Phaser from "phaser";
import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";
import { AirHockeyAudio } from "./audio";
import {
  parsePlayView,
  playIntentSchema,
  setupIntentSchema,
  setupViewSchema,
  type PlayIntent,
  type PlayView,
  type SetupIntent,
  type SetupView,
} from "./contracts";
import {
  CANVAS,
  ImpactFeed,
  PointerControls,
  phaseLabel,
  pointerTarget,
  resultSummary,
  setupNotice,
  shouldInterpolate,
} from "./model";
import { AirHockeyScene } from "./scene";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { type: "host.state" }>;
const element = document.getElementById("root");
if (element === null) throw new Error("Missing Surface root.");
const root = element;
const mode = window.location.pathname.includes("/setup/") ? "setup" : "play";
document.documentElement.dataset.mode = mode;
const controls = new PointerControls();
const impacts = new ImpactFeed();
const audio = new AirHockeyAudio();
const listeners = new AbortController();
let init: HostInit | null = null;
let host: HostState | null = null;
let view: PlayView | null = null;
let previous: PlayView | null = null;
let setup: SetupView | null = null;
let receivedAt = 0;
let game: Phaser.Game | null = null;
let resize: ResizeObserver | null = null;
let serial = 0;
let frame = 0;
let pendingSetup: string | null = null;
let setupFocus: string | null = null;
let setupMessage = "";
let pendingResign: string | null = null;
let failed = false;
let disposed = false;
let setupBuilt = false;

function text(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node !== null && node.textContent !== value) node.textContent = value;
}
function canTransmit(): boolean {
  return (
    !failed &&
    !disposed &&
    init !== null &&
    mode === "play" &&
    host?.connectionState === "connected" &&
    !host.readOnly &&
    view !== null &&
    view.outcome === null &&
    pendingResign === null
  );
}
function canControl(): boolean {
  return canTransmit() && !document.hidden;
}
function send(
  intent: SetupIntent | PlayIntent,
  requestedId?: string,
): string | null {
  if (
    failed ||
    disposed ||
    init === null ||
    host?.connectionState !== "connected" ||
    host.readOnly
  )
    return null;
  const clientIntentId = requestedId ?? `air-hockey-${mode}-${++serial}`;
  const payload =
    mode === "setup"
      ? setupIntentSchema.parse(intent)
      : playIntentSchema.parse(intent);
  if (
    !bridge.send({ type: "surface.intent", clientIntentId, intent: payload })
  ) {
    text("surface-notice", "操作暂未送达，请检查连接。");
    return null;
  }
  return clientIntentId;
}
function release(sendStop: boolean): void {
  const touch = controls.touchId;
  const active = controls.active;
  controls.discard();
  const canvas = game?.canvas;
  if (touch !== null && canvas?.hasPointerCapture(touch))
    canvas.releasePointerCapture(touch);
  if (sendStop && active && canTransmit())
    send({ type: "CONTROL", target: null });
}
function stop(): void {
  controls.discard();
  impacts.clear();
  cancelAnimationFrame(frame);
  resize?.disconnect();
  listeners.abort();
  game?.destroy(true);
  audio.dispose();
  game = null;
  pendingSetup = null;
}
function fail(code: string, message: string): void {
  if (failed || disposed) return;
  failed = true;
  stop();
  root.innerHTML =
    '<main class="loading" role="alert"><h1>球场暂不可用</h1><p id="failure-message"></p></main>';
  text("failure-message", message);
  bridge.send({ type: "surface.error", code, message });
}
function drawPreview(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#setup-preview");
  const context = canvas?.getContext("2d");
  if (
    canvas === null ||
    context === null ||
    context === undefined ||
    setup === null
  )
    return;
  context.clearRect(0, 0, 132, 220);
  context.fillStyle = "#0b1020";
  context.strokeStyle = "#45536a";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(3, 3, 126, 214, 7);
  context.fill();
  context.stroke();
  context.strokeStyle = "#45536a";
  context.beginPath();
  context.arc(66, 110, 27, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(3, 110);
  context.lineTo(129, 110);
  context.stroke();
  context.setLineDash([]);
  const colors = setup.canEdit
    ? ["#f59e0b", "#3b82f6"]
    : ["#3b82f6", "#f59e0b"];
  for (const [i, color] of colors.entries()) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(66, i === 0 ? 58 : 162, 9, 0, Math.PI * 2);
    context.fill();
    context.fillRect(49, i === 0 ? 3 : 215, 34, 2);
  }
  context.fillStyle = "#f1f5f9";
  context.beginPath();
  context.arc(66, 110, 4, 0, Math.PI * 2);
  context.fill();
}
function renderSetup(): void {
  if (setup === null) return;
  if (!setupBuilt) {
    setupBuilt = true;
    root.innerHTML = `<main class="setup-shell">
      <p class="eyebrow">Air Hockey · 双人对战</p><h1>气垫球</h1>
      <p class="setup-intro">掌握击球的速度，守住你的球门。</p>
      <section class="setup-card" aria-labelledby="score-heading"><h2 id="score-heading">胜利分数</h2><p id="setup-permission"></p>
        <div class="score-options" role="group" aria-label="胜利分数">${[5, 7, 11].map((score) => `<button class="score-option" type="button" data-score="${score}" aria-pressed="false">${score} 分</button>`).join("")}</div>
        <p class="confirmed-setting" id="confirmed-setting" role="status"></p><div class="setup-notice" id="surface-notice" role="status" aria-live="polite"></div>
      </section>
      <section class="setup-card rules-layout" aria-labelledby="rules-heading"><div><h2 id="rules-heading">开球前，了解球场</h2>
        <ul><li>你始终在下半场，鼠标移动或单指拖动控制球拍。</li><li>击球越快，球速越快。把白球打入对方球门得 1 分。</li><li>房主先发球，此后由失分方发球。等待时只有发球方碰球有效。</li><li>先到目标分数获胜，无需领先两分。</li></ul>
        <div class="player-colors"><span class="blue">P1 · 房主 · 蓝色</span><span class="orange">P2 · 橙色</span></div>
      </div><canvas class="setup-preview" id="setup-preview" width="132" height="220" role="img" aria-label="球场示意：自己的球拍始终在下半场"></canvas></section>
    </main>`;
    root
      .querySelectorAll<HTMLButtonElement>("[data-score]")
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            if (
              pendingSetup !== null ||
              setup?.canEdit !== true ||
              host?.connectionState !== "connected" ||
              host.readOnly
            )
              return;
            const targetScore = setupIntentSchema.parse({
              type: "SET_TARGET_SCORE",
              targetScore: Number(button.dataset.score),
            }).targetScore;
            if (targetScore === setup.config.targetScore) return;
            setupFocus =
              document.activeElement === button
                ? (button.dataset.score ?? null)
                : null;
            pendingSetup = send({ type: "SET_TARGET_SCORE", targetScore });
            setupMessage =
              pendingSetup === null
                ? "设置暂未送达，请检查连接。"
                : "正在保存设置…";
            renderSetup();
          },
          { signal: listeners.signal },
        );
      });
  }
  const readOnly =
    host?.connectionState !== "connected" || host.readOnly || !setup.canEdit;
  text(
    "setup-permission",
    setup.canEdit
      ? "房主选择本局分数，确认后请双方准备。"
      : "由房主选择分数，你可以查看已确认设置。",
  );
  root.querySelectorAll<HTMLButtonElement>("[data-score]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.score) === setup?.config.targetScore),
    );
    button.disabled = readOnly;
    button.setAttribute(
      "aria-disabled",
      String(readOnly || pendingSetup !== null),
    );
  });
  text(
    "confirmed-setting",
    `已确认：先得 ${setup.config.targetScore} 分获胜 · P1 房主先发球`,
  );
  text("surface-notice", setupMessage);
  drawPreview();
  if (setupFocus !== null && pendingSetup === null && !readOnly) {
    if (
      document.activeElement === document.body ||
      document.activeElement?.matches("[data-score]")
    )
      root
        .querySelector<HTMLButtonElement>(`[data-score="${setupFocus}"]`)
        ?.focus({ preventScroll: true });
    setupFocus = null;
  }
}
function renderAudio(): void {
  const button = document.getElementById("audio-toggle");
  if (button === null) return;
  button.setAttribute("aria-pressed", String(audio.ready));
  button.textContent = audio.ready
    ? "音效开"
    : audio.enabled
      ? "开启音效"
      : "音效关";
}
function ensureGame(): void {
  if (game !== null) return;
  root.innerHTML = `<main class="play-shell">
    <header class="match-header"><div><h1 class="game-title">气垫球</h1><div class="target-label" id="target-score"></div></div>
      <div class="scoreboard" role="group" aria-label="比分"><div class="score-side blue"><span id="blue-label"></span><strong id="score-blue" data-testid="score-blue">0</strong></div><span class="score-separator">:</span><div class="score-side orange"><strong id="score-orange" data-testid="score-orange">0</strong><span id="orange-label"></span></div></div>
      <button class="audio-button" id="audio-toggle" type="button" aria-label="音效" aria-pressed="false">开启音效</button>
    </header>
    <p class="phase-label" id="phase-label" role="status"></p>
    <div class="court-stage"><div class="court-canvas" id="court-canvas" tabindex="0" role="application" aria-label="气垫球球场" aria-describedby="control-help"></div><div class="connection-cover" id="connection-cover" role="status" hidden>正在恢复连接…</div></div>
    <footer class="play-footer"><span id="control-help">移动鼠标／单指拖动 · 你始终在下半场</span><span class="notice" id="surface-notice" role="status"></span></footer>
  </main>`;
  document.getElementById("audio-toggle")?.addEventListener(
    "click",
    () => {
      if (audio.enabled && !audio.ready) void audio.unlock().then(renderAudio);
      else {
        audio.setEnabled(!audio.enabled);
        void audio.unlock().then(renderAudio);
        renderAudio();
      }
    },
    { signal: listeners.signal },
  );
  const parent = document.getElementById("court-canvas");
  if (parent === null) throw new Error("Missing court.");
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: CANVAS.width,
    height: CANVAS.height,
    backgroundColor: "#101827",
    render: { antialias: true, pixelArt: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: CANVAS.width,
      height: CANVAS.height,
    },
    scene: new AirHockeyScene(() =>
      view === null
        ? null
        : {
            current: view,
            previous,
            receivedAt,
            reducedMotion: init?.reducedMotion ?? false,
            impacts: impacts.visuals(performance.now()),
          },
    ),
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false },
  });
  const point = (event: PointerEvent, captured = false) => {
    const rect = game?.canvas.getBoundingClientRect();
    return rect === undefined
      ? null
      : pointerTarget({ x: event.clientX, y: event.clientY }, rect, captured);
  };
  parent.addEventListener(
    "pointermove",
    (event) => {
      if (!canControl()) return;
      if (event.pointerType === "mouse") controls.mouse(point(event));
      else controls.moveTouch(event.pointerId, point(event, true));
    },
    { signal: listeners.signal },
  );
  parent.addEventListener(
    "pointerdown",
    (event) => {
      if (!canControl()) return;
      void audio.unlock().then(renderAudio);
      if (
        event.pointerType !== "mouse" &&
        controls.startTouch(event.pointerId, point(event))
      ) {
        game?.canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    },
    { signal: listeners.signal },
  );
  const end = (event: PointerEvent) => {
    if (event.pointerId !== controls.touchId) return;
    release(true);
  };
  for (const name of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    parent.addEventListener(name, end, { signal: listeners.signal });
  parent.addEventListener(
    "pointerleave",
    (event) => {
      if (event.pointerType === "mouse") release(true);
    },
    { signal: listeners.signal },
  );
  resize = new ResizeObserver(() => game?.scale.refresh());
  resize.observe(parent);
}
function renderPlay(): void {
  if (view === null) return;
  ensureGame();
  text("score-blue", String(view.scores[0]));
  text("score-orange", String(view.scores[1]));
  text("blue-label", view.yourSide === 0 ? "蓝方 · 你" : "蓝方");
  text("orange-label", view.yourSide === 1 ? "你 · 橙方" : "橙方");
  text("target-score", `先到 ${view.targetScore} 分`);
  text("phase-label", phaseLabel(view));
  root.dataset.phase = view.phase;
  root.dataset.tick = String(view.tick);
  root.dataset.rally = String(view.rally);
  root.dataset.side = String(view.yourSide);
  const cover = document.getElementById("connection-cover");
  if (cover !== null) cover.hidden = host?.connectionState === "connected";
}
function handleHost(message: HostSurfaceMessage): void {
  if (disposed || failed) return;
  if (message.type === "host.init") {
    if (
      message.gameId !== "air-hockey" ||
      message.gameVersion !== "1.0.0" ||
      message.mode !== mode ||
      message.bridgeVersion !== 2
    ) {
      fail("SURFACE_TARGET_MISMATCH", "球场与房间版本不一致。");
      return;
    }
    init = message;
    document.documentElement.lang = message.locale;
    return;
  }
  if (message.type === "host.state") {
    if (init === null) {
      fail("STATE_BEFORE_INIT", "球场尚未初始化。");
      return;
    }
    if (host !== null && message.sequence <= host.sequence) return;
    try {
      const newRound =
        host !== null && host.roundNumber !== message.roundNumber;
      const reconnecting =
        host !== null &&
        host.connectionState !== "connected" &&
        message.connectionState === "connected";
      if (newRound || reconnecting) pendingResign = null;
      if (mode === "setup") {
        if (
          newRound ||
          message.connectionState !== "connected" ||
          message.readOnly
        ) {
          setupMessage =
            pendingSetup !== null && message.connectionState !== "connected"
              ? "连接中断，请在重连后检查设置并重试。"
              : "";
          pendingSetup = null;
        }
        setup = setupViewSchema.parse(message.payload);
        host = message;
        renderSetup();
      } else {
        const next = parsePlayView(message.payload, init.gameVersion);
        if (!newRound && view !== null && next.tick < view.tick) return;
        const now = performance.now();
        const reset =
          newRound ||
          reconnecting ||
          message.connectionState !== "connected" ||
          message.readOnly ||
          (view !== null && next.tick - view.tick > 12);
        if (view === null || next.tick !== view.tick || reset) {
          previous = shouldInterpolate(view, next, reset) ? view : null;
          receivedAt = now;
        }
        if (
          reset ||
          next.outcome !== null ||
          (view !== null && next.rally !== view.rally)
        )
          release(false);
        view = next;
        host = message;
        for (const event of impacts.observe(
          next,
          now,
          reset || document.hidden,
        ))
          if (audio.ready) audio.play(event);
        renderPlay();
        const summary = resultSummary(next);
        if (summary !== null)
          bridge.send({
            type: "surface.result-summary",
            stateSequence: message.sequence,
            ...summary,
          });
      }
    } catch {
      fail("INVALID_PROJECTED_VIEW", "收到的球场数据无效，请重新加载。");
    }
    return;
  }
  if (message.type === "host.environment") {
    game?.scale.refresh();
    return;
  }
  if (message.type === "host.intent-result") {
    if (mode === "setup") {
      if (message.clientIntentId !== pendingSetup) return;
      pendingSetup = null;
      setupMessage = setupNotice(message.status, message.code);
      renderSetup();
    } else if (message.status !== "accepted") {
      if (pendingResign === message.clientIntentId) pendingResign = null;
      text("surface-notice", "操作未被接受，请检查连接后重试。");
    }
    return;
  }
  if (message.type === "host.command") {
    if (message.control !== "RESIGN" || !canTransmit()) {
      fail("PLATFORM_CONTROL_NOT_ALLOWED", "当前不能投降。");
      return;
    }
    release(false);
    pendingResign = message.clientIntentId;
    if (send({ type: "RESIGN" }, message.clientIntentId) === null)
      pendingResign = null;
    return;
  }
  release(true);
  disposed = true;
  stop();
  root.innerHTML = '<main class="loading">球场已关闭。</main>';
}

const bridge = new GameSurfaceBridge({
  allowedHostOrigin: document.referrer
    ? new URL(document.referrer).origin
    : "*",
  bridgeVersion: 2,
  onMessage: handleHost,
  onProtocolError: () => fail("BRIDGE_FAILED", "球场连接失败，请重试。"),
});
function poll(): void {
  if (disposed || failed) return;
  if (canControl()) {
    const input = controls.take(performance.now());
    if (input !== null) send(input);
  }
  frame = requestAnimationFrame(poll);
}
window.addEventListener(
  "blur",
  () => {
    release(true);
    impacts.clear();
    previous = null;
  },
  { signal: listeners.signal },
);
document.addEventListener(
  "visibilitychange",
  () => {
    release(true);
    impacts.clear();
    previous = null;
  },
  { signal: listeners.signal },
);
window.addEventListener(
  "pagehide",
  () => {
    release(true);
    disposed = true;
    stop();
    bridge.dispose();
  },
  { signal: listeners.signal },
);
frame = requestAnimationFrame(poll);
bridge.start();
