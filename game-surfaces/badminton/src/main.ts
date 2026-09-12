import Phaser from "phaser";
import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";

import {
  parsePlayView,
  encodePlayIntent,
  setupViewSchema,
  type PlayIntent,
  type PlayView,
  type SetupIntent,
  type SetupView,
} from "./contracts";
import {
  ControlState,
  ServeRequest,
  KEY_CONTROLS,
  phaseLabel,
  resultSummary,
  type Control,
} from "./model";
import { BadmintonScene } from "./scene";
import { BadmintonAudio } from "./audio";
import { setupNotice, replaceSetupContents } from "./setup-ui";
import { renderSetupView, shuttleIcon } from "./setup-presentation";
import "./styles.css";
import "./setup.css";

type HostInit = Extract<HostSurfaceMessage, { type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { type: "host.state" }>;
const root = document.getElementById("root");
if (root === null) throw new Error("Missing Surface root");
const surfaceRoot = root;
const mode = window.location.pathname.includes("/setup/") ? "setup" : "play";
const controls = new ControlState();
const serveRequest = new ServeRequest();
const audio = new BadmintonAudio();
let renderEpoch = 0;
const events = new AbortController();
let init: HostInit | null = null;
let host: HostState | null = null;
let view: PlayView | null = null;
let previous: PlayView | null = null;
let setup: SetupView | null = null;
let receivedAt = 0;
let game: Phaser.Game | null = null;
let sequence = 0;
let pendingSetup: string | null = null;
let setupMessage = "";
let pendingResign: string | null = null;
let lastControl = "";
let failed = false;
let disposed = false;
const pulses = new Set<ReturnType<typeof setTimeout>>();

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element !== null && element.textContent !== text)
    element.textContent = text;
}

function notice(text: string): void {
  if (mode === "setup") setupMessage = text;
  setText("surface-notice", text);
}

function canControl(): boolean {
  return (
    !failed &&
    !disposed &&
    mode === "play" &&
    host?.connectionState === "connected" &&
    host.readOnly === false &&
    view !== null &&
    view.yourSide !== null &&
    view.outcome === null &&
    pendingResign === null &&
    !document.hidden
  );
}

function sendIntent(
  intent: SetupIntent | PlayIntent,
  requestedId?: string,
): string | null {
  if (
    failed ||
    disposed ||
    init === null ||
    (mode === "setup" &&
      (host?.connectionState !== "connected" || host.readOnly))
  )
    return null;
  const clientIntentId = requestedId ?? `badminton-${mode}-${++sequence}`;
  const payload =
    mode === "play"
      ? encodePlayIntent(intent as PlayIntent, init.gameVersion)
      : intent;
  if (
    !bridge.send({ type: "surface.intent", clientIntentId, intent: payload })
  ) {
    notice("操作暂未送达，请稍后再试。");
    return null;
  }
  return clientIntentId;
}

function sendControl(force = false): void {
  if (!canControl()) return;
  const intent = controls.intent();
  intent.serve ||= serveRequest.pending;
  const serialized = JSON.stringify(intent);
  if (!force && serialized === lastControl) return;
  if (sendIntent(intent) !== null) lastControl = serialized;
}

function resetControls(send = true): void {
  controls.reset();
  serveRequest.reset();
  document
    .querySelectorAll("[data-control]")
    .forEach((button) => button.setAttribute("aria-pressed", "false"));
  if (send) sendControl(true);
  else lastControl = "";
}

function stop(): void {
  pendingSetup = null;
  resetControls(false);
  clearInterval(heartbeat);
  pulses.forEach(clearTimeout);
  pulses.clear();
  events.abort();
  game?.destroy(true);
  audio.dispose();
  game = null;
}

function fail(code: string, message: string): void {
  if (failed || disposed) return;
  failed = true;
  stop();
  surfaceRoot.innerHTML =
    '<main class="center-message" role="alert"><h1>游戏画面暂不可用</h1><p id="failure-message"></p></main>';
  setText("failure-message", message);
  bridge.send({ type: "surface.error", code, message });
}

function renderSetup(): void {
  if (setup === null || init === null) return;
  replaceSetupContents(
    surfaceRoot,
    renderSetupView(
      setup,
      init.gameVersion,
      host?.readOnly !== false || host.connectionState !== "connected",
      pendingSetup !== null,
    ),
  );
  notice(setupMessage);
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-score], [data-starter]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (
          pendingSetup !== null ||
          setup?.canEdit !== true ||
          host?.readOnly !== false ||
          host.connectionState !== "connected"
        )
          return;
        if (button.getAttribute("aria-pressed") === "true") return;
        const score = Number(button.dataset.score);
        const starter = button.dataset.starter;
        const intent: SetupIntent | null =
          score === 7 || score === 11 || score === 21
            ? { type: "SET_TARGET_SCORE", targetScore: score }
            : starter === "OWNER" ||
                starter === "NON_OWNER" ||
                starter === "RANDOM"
              ? { type: "SELECT_STARTER", starter }
              : null;
        if (intent !== null) {
          setupMessage = "";
          pendingSetup = sendIntent(intent);
          renderSetup();
        }
      });
    });
}

function playMarkup(): string {
  return `<main class="play-page"><section class="match-shell" aria-label="火柴人羽毛球对局">
    <header class="match-header"><div class="game-brand"><span class="game-mark">${shuttleIcon}</span><div><p class="eyebrow">晴日球场</p><h1>火柴人羽毛球</h1></div></div><div class="scoreboard" aria-label="比分" aria-live="polite"><div class="score-side blue"><span id="left-label">蓝方</span><strong id="score-left" data-testid="score-left">0</strong></div><span class="score-divider">:</span><div class="score-side coral"><strong id="score-right" data-testid="score-right">0</strong><span id="right-label">橙方</span></div></div><div class="match-format"><strong id="match-target">7 分制</strong><span id="best-rally">最长 0 拍</span></div></header>
    <div class="rally-bar"><span class="live-dot" aria-hidden="true"></span><span id="phase-label" role="status">准备发球</span><span class="rally-number" id="rally-number"></span></div>
    <div class="court-stage"><div id="badminton-canvas" class="court-canvas" tabindex="0" role="application" aria-label="火柴人羽毛球球场" aria-describedby="control-help"></div><button class="audio-toggle" id="audio-enabled" type="button" aria-label="音效" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4Z"/><path class="sound-waves" d="M17 8q5 4 0 8M19 4q9 8 0 16"/></svg><span>音效开</span></button><div class="connection-cover" id="connection-cover" hidden role="status">正在恢复连接…</div></div>
    <div class="controls" role="group" aria-label="球场操作"><div class="movement-controls">
      <button class="jump-button" type="button" data-control="jump" aria-label="起跳" aria-pressed="false"><span class="control-symbol" aria-hidden="true">↑</span><span class="control-caption">起跳 <kbd>W</kbd></span></button><button type="button" data-control="left" aria-label="向左移动" aria-pressed="false"><span class="control-symbol">←</span><kbd>A</kbd></button><button type="button" data-control="right" aria-label="向右移动" aria-pressed="false"><span class="control-symbol">→</span><kbd>D</kbd></button>
    </div><div class="shot-controls"><button type="button" data-control="serve" aria-label="发球" aria-pressed="false"><span>发球</span><kbd>S</kbd></button><button type="button" data-control="clear" aria-label="高远球" aria-pressed="false"><span>高远球</span><kbd>J</kbd></button><button class="smash-button" type="button" data-control="smash" aria-label="扣杀" aria-pressed="false"><span>扣杀</span><kbd>K</kbd></button><button type="button" data-control="drop" aria-label="吊球" aria-pressed="false"><span>吊球</span><kbd>L</kbd></button></div></div>
    <footer class="match-footer"><span id="side-label"></span><span class="sr-only" id="control-help">A/D 移动，W 起跳，${init?.gameVersion === "1.0.0" ? "倒计时结束后自动发球" : "S 发球"}，J 高远球，K 扣杀，L 吊球。</span></footer>
    <p class="notice" id="surface-notice" role="status"></p><span class="sr-only" data-testid="badminton-outcome" id="badminton-outcome"></span>
  </section></main>`;
}

function bindControls(): void {
  const options = { signal: events.signal };
  document.getElementById("audio-enabled")?.addEventListener(
    "click",
    (event) => {
      audio.setEnabled(!audio.enabled);
      const button = event.currentTarget as HTMLButtonElement;
      button.setAttribute("aria-pressed", String(audio.enabled));
      const label = button.querySelector("span");
      if (label !== null)
        label.textContent = audio.enabled ? "音效开" : "音效关";
    },
    options,
  );
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-control]")
    .forEach((button) => {
      const control = button.dataset.control as Control;
      const press = (source: string) => {
        if (!canControl()) return;
        pressControl(source, control);
        button.setAttribute("aria-pressed", "true");
        sendControl();
      };
      const release = (source: string) => {
        controls.release(source);
        button.setAttribute("aria-pressed", "false");
        sendControl();
      };
      button.addEventListener(
        "pointerdown",
        (event) => {
          if (event.button !== 0 || !canControl()) return;
          event.preventDefault();
          void audio.unlock();
          button.focus({ preventScroll: true });
          button.setPointerCapture(event.pointerId);
          press(`pointer-${event.pointerId}`);
        },
        options,
      );
      for (const type of [
        "pointerup",
        "pointercancel",
        "lostpointercapture",
      ] as const)
        button.addEventListener(
          type,
          (event) => release(`pointer-${event.pointerId}`),
          options,
        );
      button.addEventListener(
        "keydown",
        (event) => {
          if (event.code !== "Enter" && event.code !== "Space") return;
          event.preventDefault();
          event.stopPropagation();
          void audio.unlock();
          press(`button-${control}`);
        },
        options,
      );
      button.addEventListener(
        "keyup",
        (event) => {
          if (event.code !== "Enter" && event.code !== "Space") return;
          event.preventDefault();
          event.stopPropagation();
          release(`button-${control}`);
        },
        options,
      );
      button.addEventListener(
        "blur",
        () => release(`button-${control}`),
        options,
      );
      button.addEventListener(
        "click",
        (event) => {
          if (event.detail !== 0 || !canControl()) return;
          const source = `accessible-${control}`;
          press(source);
          const pulse = setTimeout(() => {
            release(source);
            pulses.delete(pulse);
          }, 100);
          pulses.add(pulse);
        },
        options,
      );
    });
  document
    .getElementById("badminton-canvas")
    ?.addEventListener(
      "pointerdown",
      (event) =>
        (event.currentTarget as HTMLElement).focus({ preventScroll: true }),
      options,
    );
}

function ensureGame(): void {
  if (game !== null) return;
  surfaceRoot.innerHTML = playMarkup();
  bindControls();
  const parent = document.getElementById("badminton-canvas");
  if (parent === null) return;
  const scene = new BadmintonScene(() =>
    view === null
      ? null
      : {
          current: view,
          previous,
          receivedAt,
          reducedMotion: init?.reducedMotion ?? false,
          epoch: renderEpoch,
          active:
            host?.connectionState === "connected" &&
            !document.hidden &&
            host.readOnly === false,
          gameVersion: init?.gameVersion ?? "1.1.0",
          audioReady: audio.ready,
          playSound: (cue) => audio.play(cue),
        },
  );
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: 1000,
    height: 600,
    backgroundColor: "#e5f2ec",
    render: { antialias: true, pixelArt: false },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 1000,
      height: 600,
    },
    scene,
    audio: { noAudio: true },
    input: { keyboard: false },
  });
}

function renderPlay(): void {
  if (view === null) return;
  ensureGame();
  setText("score-left", String(view.scores[0]));
  setText("score-right", String(view.scores[1]));
  setText("left-label", view.yourSide === "LEFT" ? "你 · 蓝方" : "蓝方");
  setText("right-label", view.yourSide === "RIGHT" ? "你 · 橙方" : "橙方");
  setText(
    "side-label",
    view.yourSide === "LEFT"
      ? "你在左侧 · 蓝方"
      : view.yourSide === "RIGHT"
        ? "你在右侧 · 橙方"
        : "只读画面",
  );
  setText("match-target", `${view.targetScore} 分制`);
  setText("best-rally", `最长 ${view.bestRally} 拍`);
  setText("phase-label", phaseLabel(view, init?.gameVersion));
  setText("rally-number", `第 ${view.rally} 球`);
  setText("badminton-outcome", view.outcome?.reason ?? "");
  surfaceRoot.dataset.phase = view.phase;
  surfaceRoot.dataset.tick = String(view.tick);
  surfaceRoot.dataset.rallyHits = String(view.rallyHits);
  const cover = document.getElementById("connection-cover");
  if (cover !== null) cover.hidden = host?.connectionState === "connected";
  surfaceRoot
    .querySelectorAll<HTMLButtonElement>("[data-control]")
    .forEach((button) => {
      const serving =
        view?.yourSide === view?.servingSide &&
        ["SERVE", "SERVING"].includes(view?.phase ?? "");
      button.hidden =
        button.dataset.control === "serve" && init?.gameVersion === "1.0.0";
      button.disabled =
        !canControl() ||
        ((init?.gameVersion === "1.1.0" || init?.gameVersion === "1.2.0") &&
          (button.dataset.control === "serve"
            ? !serving || view?.phase !== "SERVE"
            : ["clear", "drop", "smash"].includes(
                button.dataset.control ?? "",
              ) && serving));
    });
}

function handleHost(message: HostSurfaceMessage): void {
  if (disposed || failed) return;
  if (message.type === "host.init") {
    if (
      message.gameId !== "badminton" ||
      !["1.0.0", "1.1.0", "1.2.0"].includes(message.gameVersion) ||
      message.mode !== mode
    ) {
      fail("SURFACE_TARGET_MISMATCH", "游戏画面与房间版本不一致。");
      return;
    }
    init = message;
    document.documentElement.lang = message.locale;
    document.documentElement.dataset.reducedMotion = String(
      message.reducedMotion,
    );
    return;
  }
  if (message.type === "host.state") {
    if (init === null) {
      fail("STATE_BEFORE_INIT", "游戏画面尚未初始化。");
      return;
    }
    try {
      const reconnecting =
        host !== null &&
        host.connectionState !== "connected" &&
        message.connectionState === "connected";
      const newRound =
        host !== null && host.roundNumber !== message.roundNumber;
      if (newRound) pendingResign = null;
      if (mode === "setup") {
        if (
          newRound ||
          message.connectionState !== "connected" ||
          message.readOnly
        ) {
          setupMessage =
            pendingSetup !== null && message.connectionState !== "connected"
              ? "连接已中断，请在重连后检查当前设置。"
              : "";
          pendingSetup = null;
        }
        setup = setupViewSchema.parse(message.payload);
        host = message;
        renderSetup();
      } else {
        const next = parsePlayView(message.payload, init.gameVersion);
        if (
          reconnecting ||
          newRound ||
          (view !== null &&
            (next.tick < view.tick || next.tick - view.tick > 12))
        )
          renderEpoch++;
        const advanced = view === null || next.tick !== view.tick;
        if (advanced || reconnecting || newRound) {
          previous = reconnecting || newRound ? null : view;
          receivedAt = performance.now();
        }
        view = next;
        host = message;
        const requestedServe = serveRequest.pending;
        serveRequest.observe(next);
        if (!canControl() || reconnecting || newRound) resetControls(false);
        if (reconnecting || newRound) sendControl(true);
        else if (requestedServe && !serveRequest.pending) sendControl();
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
      fail("INVALID_PROJECTED_VIEW", "收到的游戏画面数据无效，请重新加载。");
    }
    return;
  }
  if (message.type === "host.environment") {
    game?.scale.refresh();
    return;
  }
  if (message.type === "host.command") {
    if (message.control !== "RESIGN" || !canControl()) {
      fail("PLATFORM_CONTROL_NOT_ALLOWED", "当前无法投降。");
      return;
    }
    resetControls(false);
    pendingResign = message.clientIntentId;
    if (sendIntent({ type: "RESIGN" }, message.clientIntentId) === null)
      pendingResign = null;
    renderPlay();
    return;
  }
  if (message.type === "host.intent-result") {
    if (mode === "setup") {
      if (message.clientIntentId !== pendingSetup) return;
      pendingSetup = null;
      setupMessage = setupNotice(message.status, message.code) ?? "";
      renderSetup();
      return;
    }
    if (
      message.clientIntentId === pendingResign &&
      message.status !== "accepted"
    ) {
      pendingResign = null;
      renderPlay();
    }
    if (message.status !== "accepted")
      notice(
        message.status === "stale"
          ? "房间设置已更新，请再试一次。"
          : "操作未被接受，请再试一次。",
      );
    return;
  }
  disposed = true;
  stop();
  surfaceRoot.innerHTML =
    '<main class="center-message">游戏画面已关闭。</main>';
}

const heartbeat = setInterval(() => {
  if ((controls.active || serveRequest.pending) && canControl())
    sendControl(true);
}, 150);
function pressControl(source: string, control: Control): void {
  const held = controls.has(control);
  controls.press(source, control);
  if (
    control === "serve" &&
    !held &&
    view !== null &&
    (init?.gameVersion === "1.1.0" || init?.gameVersion === "1.2.0")
  )
    serveRequest.press(view);
}

function usesNativeKeyboard(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, select, textarea, button:not([data-control])") ||
      target.isContentEditable)
  );
}

window.addEventListener(
  "keydown",
  (event) => {
    const control = KEY_CONTROLS[event.code];
    if (
      control === undefined ||
      !canControl() ||
      usesNativeKeyboard(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    event.preventDefault();
    void audio.unlock();
    if (event.repeat) return;
    pressControl(`key-${event.code}`, control);
    sendControl();
  },
  { signal: events.signal },
);
window.addEventListener(
  "keyup",
  (event) => {
    if (KEY_CONTROLS[event.code] === undefined) return;
    if (!usesNativeKeyboard(event.target)) event.preventDefault();
    controls.release(`key-${event.code}`);
    sendControl();
  },
  { signal: events.signal },
);
document.addEventListener(
  "focusin",
  (event) => {
    if (
      usesNativeKeyboard(event.target) &&
      (controls.active || serveRequest.pending)
    )
      resetControls();
  },
  { signal: events.signal },
);
window.addEventListener("blur", () => resetControls(), {
  signal: events.signal,
});
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) {
      controls.reset();
      serveRequest.reset();
      renderEpoch++;
      if (
        host?.connectionState === "connected" &&
        host.readOnly === false &&
        view?.outcome === null &&
        pendingResign === null
      )
        sendIntent(controls.intent());
      lastControl = "";
    }
  },
  { signal: events.signal },
);
window.addEventListener(
  "pagehide",
  () => {
    resetControls();
    disposed = true;
    stop();
    bridge.dispose();
  },
  { signal: events.signal },
);
surfaceRoot.innerHTML =
  '<main class="center-message" role="status"><span class="loading-shuttle">🏸</span><p>球场准备中…</p></main>';
const bridge = new GameSurfaceBridge({
  allowedHostOrigin: "*",
  onMessage: handleHost,
  onProtocolError: () =>
    fail("BRIDGE_UNAVAILABLE", "与房间的连接中断，请重新加载游戏画面。"),
});
bridge.start();
