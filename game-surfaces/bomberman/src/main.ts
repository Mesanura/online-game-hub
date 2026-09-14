import Phaser from "phaser";
import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";
import { BombermanAudio } from "./audio";
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
  Controls,
  EffectFeed,
  isControlKey,
  phaseLabel,
  resultSummary,
  setupNotice,
  shouldInterpolate,
} from "./model";
import { bombSprite, paintPixels, PLAYER_COLORS, TILE_PIXELS } from "./pixels";
import { drawPreview } from "./preview";
import { BombermanScene } from "./scene";
import "./styles.css";

type HostInit = Extract<HostSurfaceMessage, { type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { type: "host.state" }>;
const element = document.getElementById("root");
if (!element) throw new Error("Missing Surface root.");
const root = element;
const mode = window.location.pathname.includes("/setup/") ? "setup" : "play";
document.documentElement.dataset.mode = mode;
const controls = new Controls();
const effects = new EffectFeed();
const audio = new BombermanAudio();
const listeners = new AbortController();
let init: HostInit | null = null;
let host: HostState | null = null;
let view: PlayView | null = null;
let previous: PlayView | null = null;
let setup: SetupView | null = null;
let receivedAt = 0;
let interval = 50;
let game: Phaser.Game | null = null;
let resize: ResizeObserver | null = null;
let serial = 0;
let animation = 0;
let pendingSetup: string | null = null;
let setupMessage = "";
let pendingResign: string | null = null;
let failed = false;
let disposed = false;
let setupBuilt = false;
const scoreNodes = new Map<string, HTMLElement>();

function text(id: string, content: string): void {
  const node = document.getElementById(id);
  if (node && node.textContent !== content) node.textContent = content;
}
function canSend(): boolean {
  return (
    !failed &&
    !disposed &&
    init !== null &&
    host?.connectionState === "connected" &&
    !host.readOnly
  );
}
function canControl(): boolean {
  const own = view?.players.find(
    (player) => player.slotId === view?.selfSlotId,
  );
  return (
    canSend() &&
    !document.hidden &&
    pendingResign === null &&
    view?.phase === "ACTIVE" &&
    own?.alive === true &&
    !own.resigned
  );
}
function send(intent: SetupIntent | PlayIntent, id?: string): string | null {
  if (!canSend()) return null;
  const clientIntentId = id ?? "bomberman-" + mode + "-" + ++serial;
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
function renderControls(): void {
  const stick = document.getElementById("joystick");
  const knob = document.getElementById("joystick-knob");
  if (stick) {
    stick.dataset.direction = controls.direction;
    stick.setAttribute("aria-disabled", String(!canControl()));
  }
  if (knob)
    knob.style.transform =
      "translate(" + controls.knob.x + "px," + controls.knob.y + "px)";
  const bomb = document.querySelector<HTMLButtonElement>("#bomb-button");
  if (bomb) {
    bomb.dataset.held = String(controls.bombHeld);
    bomb.disabled = !canControl();
  }
}
function flush(): void {
  if (canControl()) {
    const input = controls.take(performance.now());
    if (input) send(input);
  }
  renderControls();
}
function release(sendStop: boolean): void {
  const stick = controls.stickId;
  const bombs = controls.bombPointers;
  const active = controls.clear();
  const stickNode = document.getElementById("joystick");
  const bombNode = document.getElementById("bomb-button");
  if (stick !== null && stickNode?.hasPointerCapture(stick))
    stickNode.releasePointerCapture(stick);
  for (const id of bombs)
    if (bombNode?.hasPointerCapture(id)) bombNode.releasePointerCapture(id);
  if (sendStop && active && canSend() && mode === "play")
    send({ type: "MOVE", direction: "none" });
  renderControls();
}
function stop(): void {
  controls.clear();
  effects.clear();
  listeners.abort();
  cancelAnimationFrame(animation);
  resize?.disconnect();
  game?.destroy(true);
  game = null;
  audio.dispose();
  pendingSetup = null;
  pendingResign = null;
}
function fail(code: string, message: string): void {
  if (failed || disposed) return;
  failed = true;
  stop();
  root.innerHTML =
    '<main class="loading" role="alert"><h1>竞技场暂不可用</h1><p id="failure-message"></p></main>';
  text("failure-message", message);
  bridge.send({ type: "surface.error", code, message });
}
function renderSetup(): void {
  if (!setup) return;
  if (!setupBuilt) {
    setupBuilt = true;
    root.innerHTML =
      '<main class="setup-shell"><header class="setup-heading"><span class="eyebrow">PIXEL ARENA / 01</span><h1>像素炸弹人<span class="title-spark" aria-hidden="true">✦</span></h1><p>炸开出路，和朋友一起留到最后。</p></header>' +
      '<div class="setup-grid"><section class="setup-card settings-card" aria-labelledby="players-heading"><span class="section-number">01 / 集合</span><h2 id="players-heading">几个人一起开炸？</h2><p id="setup-permission"></p><div class="player-options" role="group" aria-label="对战人数">' +
      setup.playerCounts
        .map(
          (count) =>
            '<button type="button" data-count="' +
            count +
            '" aria-pressed="false"><strong>' +
            count +
            "</strong><span>人对战</span></button>",
        )
        .join("") +
      '</div><p class="confirmed-setting" id="confirmed-setting" role="status"></p><div class="setup-roster" id="setup-roster"></div><div class="setup-notice" id="surface-notice" role="status" aria-live="polite"></div></section>' +
      '<section class="setup-card map-card" aria-labelledby="map-heading"><span class="section-number">02 / 战场</span><h2 id="map-heading">经典竞技场</h2><div class="preview-frame"><canvas id="setup-preview" width="208" height="176" role="img" aria-label="经典竞技场示意，玩家从不同角落出生"></canvas></div><p>固定地形 · 砖块每局变化 · 出生点轮换</p></section>' +
      '<section class="setup-card rules-card" aria-labelledby="rules-heading"><span class="section-number">03 / 开炸指南</span><h2 id="rules-heading">先赢三小局，就赢下整场</h2><div class="rules-columns"><ul><li>每小局一条命，最后存活者得 1 分。</li><li>180 秒仍有多人存活，或全员出局，均为平局。</li><li>砖块可以炸毁；石墙会挡住爆炸。</li><li>炸弹会连锁引爆，也会炸到自己。</li></ul><div><div class="item-guide"><span>＋ 炸弹容量</span><span>✦ 爆炸范围</span><span>ϟ 移动速度</span></div><p>炸开砖块寻找道具。出局后观看本小局，下一小局自动复活；所有增强重置。</p><p class="keyboard-help"><kbd>WASD</kbd> / <kbd>方向键</kbd> 移动<br><kbd>空格</kbd> 放炸弹 · 手机摇杆 + 放弹按钮</p></div></div></section></div></main>';
    root.querySelectorAll<HTMLButtonElement>("[data-count]").forEach((button) =>
      button.addEventListener(
        "click",
        () => {
          if (!canSend() || !setup?.canEdit || pendingSetup !== null) return;
          const count = Number(button.dataset.count);
          if (count === setup.config.playerCount) return;
          pendingSetup = send({ type: "SET_PLAYER_COUNT", playerCount: count });
          setupMessage = pendingSetup
            ? "正在保存人数…"
            : "设置暂未送达，请检查连接。";
          renderSetup();
        },
        { signal: listeners.signal },
      ),
    );
  }
  const readOnly = !canSend() || !setup.canEdit;
  text(
    "setup-permission",
    setup.canEdit
      ? "房主选择人数，所有玩家分别准备后开局。"
      : "由房主选择人数；到齐后请分别准备。",
  );
  root.querySelectorAll<HTMLButtonElement>("[data-count]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.count) === setup?.config.playerCount),
    );
    button.disabled = readOnly;
    button.setAttribute(
      "aria-disabled",
      String(readOnly || pendingSetup !== null),
    );
  });
  text(
    "confirmed-setting",
    "已确认：" + setup.config.playerCount + " 人 · 自由混战 · 抢 3 胜",
  );
  text(
    "surface-notice",
    setupMessage ||
      (setup.players.length !== setup.config.playerCount
        ? "当前 " + setup.players.length + " 人，需与所选人数一致才能开局。"
        : "人数已到齐，请所有玩家准备。"),
  );
  const roster = document.getElementById("setup-roster");
  if (roster) {
    const signature = setup.players.map((player) => player.slotId).join(",");
    if (roster.dataset.roster !== signature) {
      roster.replaceChildren();
      for (const player of setup.players) {
        const chip = document.createElement("span");
        chip.className = "player-chip";
        chip.style.setProperty(
          "--player-color",
          PLAYER_COLORS[player.index % PLAYER_COLORS.length] ??
            PLAYER_COLORS[0],
        );
        chip.textContent =
          "P" +
          (player.index + 1) +
          (player.slotId === setup.selfSlotId ? " · 你" : "");
        roster.append(chip);
      }
      roster.dataset.roster = signature;
    }
  }
  const canvas = document.querySelector<HTMLCanvasElement>("#setup-preview");
  if (canvas) drawPreview(canvas, setup.config.playerCount);
}
function renderAudio(): void {
  const button = document.getElementById("audio-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(audio.ready));
    button.textContent = audio.ready
      ? "音效开"
      : audio.enabled
        ? "开启音效"
        : "音效关";
  }
}
function unlock(): void {
  void audio.unlock().then(renderAudio);
}
function ensureGame(): void {
  if (game || !view) return;
  root.innerHTML =
    '<main class="play-shell"><header class="match-header"><div class="brand"><span class="eyebrow">PIXEL ARENA</span><h1>像素炸弹人</h1></div><div class="match-clock"><span id="bout-label"></span><strong id="match-timer" aria-label="小局剩余时间"></strong></div><button id="audio-toggle" class="audio-button" type="button" aria-label="音效" aria-pressed="false">开启音效</button></header>' +
    '<div class="scoreboard" id="scoreboard" role="group" aria-label="小局胜场"></div><p class="phase-label" id="phase-label" role="status"></p>' +
    '<div class="battlefield"><div class="touch-control movement-control"><div class="joystick" id="joystick" data-testid="joystick" tabindex="0" role="group" aria-label="四向移动摇杆，支持方向键" aria-describedby="control-help"><span class="joy-arrow up" aria-hidden="true">▲</span><span class="joy-arrow right" aria-hidden="true">▶</span><span class="joy-arrow down" aria-hidden="true">▼</span><span class="joy-arrow left" aria-hidden="true">◀</span><span class="joystick-knob" id="joystick-knob" aria-hidden="true"><i></i></span></div><span class="control-caption">移动</span></div>' +
    '<div class="arena-wrap"><div id="arena-canvas" tabindex="0" role="application" aria-label="像素炸弹人竞技场" aria-describedby="control-help"></div><div id="phase-banner" class="phase-banner" aria-hidden="true"><span id="banner-kicker"></span><strong id="banner-value"></strong><span id="banner-detail"></span></div><div id="connection-cover" class="connection-cover" role="status" hidden>正在恢复连接…</div></div>' +
    '<div class="touch-control bomb-control"><button id="bomb-button" class="bomb-button" data-testid="bomb-button" type="button" aria-label="放炸弹（空格）"><canvas id="bomb-icon" width="32" height="32" aria-hidden="true"></canvas><span>放炸弹</span></button><span class="control-caption">点按放置</span></div></div>' +
    '<footer class="play-footer"><div id="inventory" class="inventory" aria-label="你的能力"></div><p id="control-help">WASD / 方向键移动 · 空格放弹</p><p id="surface-notice" class="play-notice" role="status"></p></footer></main>';
  const audioButton = document.getElementById("audio-toggle");
  audioButton?.addEventListener(
    "click",
    () => {
      if (audio.enabled && !audio.ready) unlock();
      else {
        audio.setEnabled(!audio.enabled);
        unlock();
        renderAudio();
      }
    },
    { signal: listeners.signal },
  );
  const parent = document.getElementById("arena-canvas");
  if (!parent) throw new Error("Missing arena canvas.");
  game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: view.arena.cols * TILE_PIXELS,
    height: view.arena.rows * TILE_PIXELS,
    backgroundColor: "#bcd297",
    render: { antialias: false, pixelArt: true, roundPixels: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: view.arena.cols * TILE_PIXELS,
      height: view.arena.rows * TILE_PIXELS,
    },
    scene: new BombermanScene(() =>
      view
        ? {
            current: view,
            previous,
            receivedAt,
            interval,
            reducedMotion: init?.reducedMotion ?? false,
          }
        : null,
    ),
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false },
    banner: false,
  });
  parent.addEventListener(
    "pointerdown",
    () => {
      parent.focus({ preventScroll: true });
      unlock();
    },
    { signal: listeners.signal },
  );
  const stick = document.getElementById("joystick");
  const bomb = document.querySelector<HTMLButtonElement>("#bomb-button");
  const icon = document
    .querySelector<HTMLCanvasElement>("#bomb-icon")
    ?.getContext("2d");
  if (icon) paintPixels(icon, bombSprite(), 2);
  if (!stick || !bomb) throw new Error("Missing touch controls.");
  const point = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect();
    controls.moveStick(
      event.pointerId,
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
      rect.width * 0.36,
    );
  };
  stick.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !canControl() ||
        event.button !== 0 ||
        !controls.startStick(event.pointerId)
      )
        return;
      event.preventDefault();
      unlock();
      stick.setPointerCapture(event.pointerId);
      point(event);
      flush();
    },
    { signal: listeners.signal },
  );
  stick.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerId !== controls.stickId) return;
      event.preventDefault();
      point(event);
      flush();
    },
    { signal: listeners.signal },
  );
  const endStick = (event: PointerEvent) => {
    controls.endStick(event.pointerId);
    flush();
  };
  for (const name of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    stick.addEventListener(name, endStick, { signal: listeners.signal });
  bomb.addEventListener(
    "pointerdown",
    (event) => {
      if (
        !canControl() ||
        event.button !== 0 ||
        !controls.pressBomb(event.pointerId)
      )
        return;
      event.preventDefault();
      unlock();
      bomb.setPointerCapture(event.pointerId);
      send({ type: "PLACE_BOMB" });
      renderControls();
    },
    { signal: listeners.signal },
  );
  const endBomb = (event: PointerEvent) => {
    controls.releaseBomb(event.pointerId);
    renderControls();
  };
  for (const name of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ] as const)
    bomb.addEventListener(name, endBomb, { signal: listeners.signal });
  bomb.addEventListener(
    "click",
    (event) => {
      if (event.detail === 0 && canControl()) {
        unlock();
        send({ type: "PLACE_BOMB" });
      }
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isControlKey(event.code) || !canControl()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input,textarea,select") ||
        (event.code === "Space" &&
          target?.closest("button") &&
          !target.closest("#bomb-button"))
      )
        return;
      event.preventDefault();
      unlock();
      if (controls.keyDown(event.code, event.repeat))
        send({ type: "PLACE_BOMB" });
      flush();
    },
    { signal: listeners.signal },
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (!isControlKey(event.code)) return;
      controls.keyUp(event.code);
      flush();
    },
    { signal: listeners.signal },
  );
  resize = new ResizeObserver(() => game?.scale.refresh());
  resize.observe(parent);
  parent.focus({ preventScroll: true });
}
function renderPlay(): void {
  if (!view) return;
  ensureGame();
  root.dataset.phase = view.phase;
  root.dataset.bout = String(view.bout);
  root.dataset.tick = String(host?.tick ?? 0);
  const board = document.getElementById("scoreboard");
  for (const player of view.players) {
    let card = scoreNodes.get(player.slotId);
    if (!card) {
      card = document.createElement("div");
      card.className = "score-card";
      card.dataset.player = player.slotId;
      card.dataset.testid = "player-score-" + player.index;
      card.innerHTML =
        '<span class="player-dot" aria-hidden="true"></span><span class="player-name"></span><strong class="player-score"></strong><span class="player-state"></span>';
      card.style.setProperty(
        "--player-color",
        PLAYER_COLORS[player.index % PLAYER_COLORS.length] ?? PLAYER_COLORS[0],
      );
      board?.append(card);
      scoreNodes.set(player.slotId, card);
    }
    const name = card.querySelector(".player-name");
    if (name)
      name.textContent =
        "P" +
        (player.index + 1) +
        (player.slotId === view.selfSlotId ? " · 你" : "");
    const score = card.querySelector(".player-score");
    if (score) score.textContent = String(player.score);
    const status = card.querySelector(".player-state");
    if (status)
      status.textContent = player.resigned
        ? "已投降"
        : player.alive
          ? "存活"
          : "出局";
    card.dataset.alive = String(player.alive);
    card.dataset.x = String(player.x);
    card.dataset.y = String(player.y);
    card.dataset.walking = String(player.walking);
    card.setAttribute(
      "aria-label",
      "P" +
        (player.index + 1) +
        (player.slotId === view.selfSlotId ? " 你，" : "，") +
        player.score +
        " 胜，" +
        (player.resigned ? "已投降" : player.alive ? "存活" : "出局"),
    );
  }
  for (const [slot, card] of scoreNodes)
    if (!view.players.some((player) => player.slotId === slot)) {
      card.remove();
      scoreNodes.delete(slot);
    }
  const seconds = Math.ceil(view.remainingTicks / 60);
  text(
    "match-timer",
    String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" +
      String(seconds % 60).padStart(2, "0"),
  );
  text("bout-label", "第 " + view.bout + " 小局 / 抢 3 胜");
  text("phase-label", phaseLabel(view));
  const own = view.players.find((player) => player.slotId === view?.selfSlotId);
  text(
    "inventory",
    own
      ? "炸弹 " +
          own.activeBombs +
          "/" +
          own.capacity +
          "　 火力 " +
          own.range +
          "　 速度 " +
          own.speed.toFixed(1)
      : "",
  );
  const banner = document.getElementById("phase-banner");
  if (banner) {
    banner.hidden = view.phase === "ACTIVE";
    if (view.phase === "PREPARE") {
      text("banner-kicker", "READY?");
      text(
        "banner-value",
        String(Math.max(1, Math.ceil(view.phaseTicks / 60))),
      );
      text("banner-detail", "第 " + view.bout + " 小局");
    } else if (view.phase === "RESULT") {
      const winner = view.players.find(
        (player) => player.slotId === view?.roundResult?.winnerSlotId,
      );
      text("banner-kicker", winner ? "ROUND WIN" : "DRAW");
      text("banner-value", winner ? "P" + (winner.index + 1) + " +1" : "平局");
      text("banner-detail", "下一小局即将开始");
    } else {
      text("banner-kicker", "MATCH OVER");
      text(
        "banner-value",
        view.outcome?.winnerSlotId === view.selfSlotId
          ? "胜利！"
          : view.outcome?.type === "DRAW"
            ? "平局"
            : "本场结束",
      );
      text("banner-detail", resultSummary(view)?.headline ?? "");
    }
  }
  const cover = document.getElementById("connection-cover");
  if (cover) cover.hidden = host?.connectionState === "connected";
  renderControls();
  renderAudio();
}
function handleHost(message: HostSurfaceMessage): void {
  if (failed || disposed) return;
  if (message.type === "host.init") {
    if (
      message.gameId !== "bomberman" ||
      message.gameVersion !== "1.0.0" ||
      message.mode !== mode ||
      message.bridgeVersion !== 2
    ) {
      fail("SURFACE_TARGET_MISMATCH", "竞技场与房间版本不一致。");
      return;
    }
    init = message;
    document.documentElement.lang = message.locale;
    return;
  }
  if (message.type === "host.state") {
    if (!init) {
      fail("STATE_BEFORE_INIT", "竞技场尚未初始化。");
      return;
    }
    if (host && message.sequence <= host.sequence) return;
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
            pendingSetup && message.connectionState !== "connected"
              ? "连接中断，请重连后检查设置并重试。"
              : "";
          pendingSetup = null;
        }
        setup = setupViewSchema.parse(message.payload);
        host = message;
        renderSetup();
      } else {
        const next = parsePlayView(message.payload, init.gameVersion);
        if (message.tick === undefined)
          throw new Error("Missing realtime tick.");
        if (!newRound && host?.tick !== undefined && message.tick < host.tick)
          return;
        const reset =
          !view ||
          newRound ||
          reconnecting ||
          message.connectionState !== "connected" ||
          message.readOnly ||
          (host?.tick !== undefined && message.tick - host.tick > 12);
        const newBout = view !== null && next.bout !== view.bout;
        const phaseChanged =
          view !== null && (newBout || next.phase !== view.phase);
        const audioReset =
          !view ||
          newRound ||
          newBout ||
          reconnecting ||
          message.connectionState !== "connected" ||
          document.hidden ||
          (host?.tick !== undefined && message.tick - host.tick > 12);
        if (!view || host?.tick !== message.tick || reset) {
          previous = shouldInterpolate(
            view,
            next,
            reset || Boolean(init.reducedMotion),
          )
            ? view
            : null;
          interval = Math.min(
            100,
            Math.max(
              1000 / 60,
              ((message.tick - (host?.tick ?? message.tick - 3)) * 1000) / 60,
            ),
          );
          receivedAt = performance.now();
        }
        if (
          reset ||
          phaseChanged ||
          !next.players.find((player) => player.slotId === next.selfSlotId)
            ?.alive
        )
          release(false);
        if (
          next.outcome ||
          next.players.find((player) => player.slotId === next.selfSlotId)
            ?.resigned
        )
          pendingResign = null;
        const dimensionsChanged =
          view !== null &&
          (view.arena.cols !== next.arena.cols ||
            view.arena.rows !== next.arena.rows);
        view = next;
        host = message;
        if (dimensionsChanged)
          game?.scale.setGameSize(
            next.arena.cols * TILE_PIXELS,
            next.arena.rows * TILE_PIXELS,
          );
        for (const event of effects.observe(next.events, audioReset))
          if (audio.ready) audio.play(event);
        renderPlay();
        const summary = resultSummary(next);
        if (summary)
          bridge.send({
            type: "surface.result-summary",
            stateSequence: message.sequence,
            ...summary,
          });
      }
    } catch {
      fail("INVALID_PROJECTED_VIEW", "收到的竞技场数据无效，请重新加载。");
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
      if (message.clientIntentId === pendingResign) pendingResign = null;
      text("surface-notice", "操作未被接受，请检查连接后重试。");
    }
    return;
  }
  if (message.type === "host.command") {
    if (
      message.control !== "RESIGN" ||
      !canSend() ||
      !view ||
      view.outcome ||
      pendingResign
    ) {
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
  root.innerHTML = '<main class="loading">竞技场已关闭。</main>';
}
const bridge = new GameSurfaceBridge({
  allowedHostOrigin: document.referrer
    ? new URL(document.referrer).origin
    : "*",
  bridgeVersion: 2,
  onMessage: handleHost,
  onProtocolError: () => fail("BRIDGE_FAILED", "竞技场连接失败，请重试。"),
});
function poll(): void {
  if (failed || disposed) return;
  if (canControl()) flush();
  animation = requestAnimationFrame(poll);
}
window.addEventListener(
  "blur",
  () => {
    release(true);
    effects.clear();
    previous = null;
  },
  { signal: listeners.signal },
);
document.addEventListener(
  "visibilitychange",
  () => {
    release(true);
    effects.clear();
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
animation = requestAnimationFrame(poll);
bridge.start();
