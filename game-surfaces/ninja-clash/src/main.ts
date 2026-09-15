import Phaser from "phaser";
import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";
import {
  playViewSchema,
  setupViewSchema,
  playIntentSchema,
  setupIntentSchema,
  type PlayView,
  type SetupView,
  type PlayIntent,
  type SetupIntent,
} from "./contracts";
import { actionKey, movement, colors, summary, EffectFeed } from "./model";
import { NinjaScene, backgroundUrl } from "./scene";
import { NinjaAudio } from "./audio";
import "./styles.css";
type HostInit = Extract<HostSurfaceMessage, { type: "host.init" }>;
type HostState = Extract<HostSurfaceMessage, { type: "host.state" }>;
const root = required(document.getElementById("root"));
const mode = location.pathname.includes("/setup/") ? "setup" : "play";
document.documentElement.dataset.mode = mode;
let init: HostInit | null = null,
  host: HostState | null = null,
  view: PlayView | null = null,
  previous: PlayView | null = null,
  setup: SetupView | null = null;
let game: Phaser.Game | null = null,
  observer: ResizeObserver | null = null,
  serial = 0,
  receivedAt = 0,
  interval = 50,
  disposed = false,
  built = false,
  pending: string | null = null,
  pendingResign: string | null = null,
  notice = "",
  lastDirection = 0,
  lastSend = 0;
const keys = new Set<string>(),
  touch = new Map<number, -1 | 1>(),
  actions = new Map<number, string>();
const audio = new NinjaAudio(),
  feed = new EffectFeed(),
  listeners = new AbortController();
const text = (id: string, value: string) => {
  const node = document.getElementById(id);
  if (node && node.textContent !== value) node.textContent = value;
};
function canSend() {
  return (
    !disposed &&
    init !== null &&
    host?.connectionState === "connected" &&
    !host.readOnly
  );
}
function canControl() {
  return (
    canSend() &&
    !document.hidden &&
    !pendingResign &&
    view?.phase === "ACTIVE" &&
    view.players.some(
      (p) => p.slotId === view?.selfSlotId && p.alive && !p.resigned,
    )
  );
}
function send(intent: PlayIntent | SetupIntent, id?: string) {
  if (!canSend()) return null;
  const clientIntentId = id ?? "ninja-" + mode + "-" + ++serial;
  const parsed = (mode === "play" ? playIntentSchema : setupIntentSchema).parse(
    intent,
  );
  if (!bridge.send({ type: "surface.intent", clientIntentId, intent: parsed }))
    return null;
  return clientIntentId;
}
function flush(force = false) {
  if (!canControl()) return;
  const direction = movement(keys, touch),
    now = performance.now();
  if (
    force ||
    direction !== lastDirection ||
    (direction !== 0 && now - lastSend >= 150)
  ) {
    send({ type: "MOVE", direction });
    lastDirection = direction;
    lastSend = now;
  }
  renderHeld();
}
function clear(sendStop: boolean) {
  const active = lastDirection !== 0 || keys.size > 0 || touch.size > 0;
  keys.clear();
  touch.clear();
  actions.clear();
  lastDirection = 0;
  if (sendStop && active && canSend() && mode === "play")
    send({ type: "MOVE", direction: 0 });
  document
    .querySelectorAll<HTMLElement>("[data-held]")
    .forEach((node) => (node.dataset.held = "false"));
  audio.silence();
  previous = null;
}
function renderHeld() {
  for (const node of document.querySelectorAll<HTMLElement>("[data-direction]"))
    node.dataset.held = String(
      [...touch.values()].includes(Number(node.dataset.direction) as -1 | 1),
    );
  for (const node of document.querySelectorAll<HTMLElement>("[data-action]"))
    node.dataset.held = String(
      [...actions.values()].includes(required(node.dataset.action)),
    );
}
function stop() {
  clear(true);
  disposed = true;
  listeners.abort();
  window.clearInterval(timer);
  observer?.disconnect();
  game?.destroy(true);
  audio.dispose();
}
function fail(code: string, message: string) {
  if (disposed) return;
  bridge.send({ type: "surface.error", code, message });
  stop();
  root.innerHTML =
    '<main class="loading" role="alert"><h1>竞技场暂不可用</h1><p id="error"></p></main>';
  text("error", message);
}
function renderSetup() {
  if (!setup) return;
  if (!built) {
    built = true;
    root.innerHTML =
      '<main class="setup"><header><span class="eyebrow">NEON DOJO / MULTIPLAYER</span><h1>像素<span>忍战</span></h1><p>一刀定胜负。下一回合，再来。</p></header><div class="setup-grid"><section class="card settings"><span class="eyebrow">01 / 集合</span><h2>召集你的对手</h2><p id="permission"></p><label>对战人数</label><div class="choices" id="counts"></div><label>获胜分数</label><div class="choices" id="targets"></div><p id="confirmed" class="confirmed"></p><div id="roster" class="roster"></div><p id="notice" role="status" aria-live="polite"></p></section><section class="card map-card"><span class="eyebrow">02 / 训练设施</span><h2>霓虹道场</h2><div class="map-preview" role="img" aria-label="对称平台竞技场，左右阶梯通往中央高台"><span class="preview-title">NEON DOJO</span><i style="left:12.5%;top:75.5%;width:17.5%"></i><i style="left:70%;top:75.5%;width:17.5%"></i><i style="left:27.5%;top:57.7%;width:15%"></i><i style="left:57.5%;top:57.7%;width:15%"></i><i style="left:42.5%;top:40%;width:15%"></i><b class="spawn one">P1</b><b class="spawn two">P2</b></div><p>固定全场视野 · 自由混战 · 无回合限时</p></section><section class="card rules"><span class="eyebrow">03 / 刀锋指南</span><h2>进攻，闪避，再反击。</h2><div class="rule-grid"><p><strong>最后存活者 +1</strong>一击毙命，阵亡后旁观；全灭不计分。每回合倒数三秒，达到目标分获胜。</p><p><strong>滑行全程无敌</strong>仅地面可用。攻击可截断滑行；前摇后滑行可取消攻击冷却。</p><p><strong>拼刀接反击</strong>刀刃相交抵消，约 50ms 后可再斩。空中能攻击，也能连续蹬墙跳。</p></div><div class="key-guide"><span><kbd>A D</kbd> 移动</span><span><kbd>Space</kbd> 跳跃</span><span><kbd>J</kbd> 攻击</span><span><kbd>K / Shift</kbd> 滑行</span></div><p>手机使用左侧方向区与右侧三个动作按钮。设置确认后，在房间中准备。</p></section></div></main>';
    required(
      document.querySelector<HTMLElement>(".map-preview"),
    ).style.backgroundImage =
      'linear-gradient(#11162455,#111624aa),url("' + backgroundUrl + '")';
    for (const [id, values] of [
      ["counts", [2, 3, 4]],
      ["targets", [3, 5, 7, 10]],
    ] as const) {
      const container = required(document.getElementById(id));
      for (const value of values) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = value + (id === "counts" ? " 人" : " 分");
        button.dataset.value = String(value);
        button.addEventListener(
          "click",
          () => {
            if (pending || !setup?.canEdit) return;
            pending = send(
              id === "counts"
                ? { type: "SET_PLAYER_COUNT", playerCount: value }
                : {
                    type: "SET_TARGET_SCORE",
                    targetScore: value as 3 | 5 | 7 | 10,
                  },
            );
            notice = pending ? "正在确认设置…" : "设置未送达，请重试。";
            renderSetup();
          },
          { signal: listeners.signal },
        );
        container.append(button);
      }
    }
  }
  text(
    "permission",
    setup.canEdit
      ? "你是房主，可以设置人数与目标分。"
      : "由房主设置，全员准备后开始。",
  );
  text(
    "confirmed",
    setup.config.playerCount +
      " 人对战 · 先得 " +
      setup.config.targetScore +
      " 分获胜",
  );
  text("notice", notice || (!canSend() ? "正在恢复连接…" : ""));
  for (const [id, value] of [
    ["counts", setup.config.playerCount],
    ["targets", setup.config.targetScore],
  ] as const)
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "#" + id + " button",
    )) {
      button.disabled = !canSend() || !setup.canEdit || pending !== null;
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.value) === value),
      );
    }
  const roster = required(document.getElementById("roster"));
  roster.replaceChildren();
  for (const p of setup.players) {
    const badge = document.createElement("span");
    badge.style.setProperty("--player", required(colors[p.index]));
    badge.textContent =
      "P" + (p.index + 1) + (p.slotId === setup.selfSlotId ? " · 你" : "");
    roster.append(badge);
  }
}
function buildPlay() {
  if (built) return;
  built = true;
  root.innerHTML =
    '<main class="play"><header class="hud"><div><span class="eyebrow">NEON DOJO</span><h1>像素忍战</h1></div><div id="scores" class="scores"></div><button id="sound" type="button" aria-pressed="false" aria-label="开启音效">音效关</button></header><div class="stage-wrap"><div id="stage" role="img" aria-label="忍者对战竞技场"></div><div id="banner" class="banner" aria-live="polite"><span id="banner-kicker"></span><strong id="banner-title"></strong><span id="banner-detail"></span></div><div id="connection" class="connection" hidden>正在恢复连接…</div></div><div class="statusbar"><span id="round-status"></span><span id="own-status"></span><span id="notice" role="status"></span></div><div class="control-deck"><div class="direction-pad" role="group" aria-label="移动方向"><button type="button" data-direction="-1" aria-label="向左移动">◀<small>A</small></button><button type="button" data-direction="1" aria-label="向右移动">▶<small>D</small></button></div><div class="keyboard-note">Space 跳跃 · J 攻击<br>K / Shift 滑行</div><div class="action-pad"><button type="button" data-action="JUMP" aria-label="跳跃">跳跃<small>SPACE</small></button><button type="button" data-action="SLIDE" aria-label="滑行">滑行<small id="slide-cd">K / SHIFT</small></button><button type="button" data-action="ATTACK" class="attack" aria-label="攻击">斩击<small id="attack-cd">J</small></button></div></div></main>';
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "stage",
    width: 640,
    height: 360,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: "#141725",
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: new NinjaScene(() => ({
      view,
      previous,
      receivedAt,
      interval,
      reduced: init?.reducedMotion ?? false,
    })),
  });
  observer = new ResizeObserver(() => game?.scale.refresh());
  observer.observe(required(document.getElementById("stage")));
  required(document.getElementById("sound")).addEventListener(
    "click",
    () => {
      void audio.toggle().then(() => {
        text("sound", audio.muted ? "音效关" : "音效开");
        required(document.getElementById("sound")).setAttribute(
          "aria-pressed",
          String(!audio.muted),
        );
        required(document.getElementById("sound")).setAttribute(
          "aria-label",
          audio.muted ? "开启音效" : "关闭音效",
        );
      });
    },
    { signal: listeners.signal },
  );
  for (const node of document.querySelectorAll<HTMLButtonElement>(
    "[data-direction],[data-action]",
  )) {
    node.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        if (!canControl()) return;
        void audio.unlock();
        node.setPointerCapture(e.pointerId);
        if (node.dataset.direction) {
          touch.set(e.pointerId, Number(node.dataset.direction) as -1 | 1);
          flush(true);
        } else {
          const type = node.dataset.action as "JUMP" | "SLIDE" | "ATTACK";
          const held = [...actions.values()].includes(type);
          actions.set(e.pointerId, type);
          if (!held) send({ type });
        }
        renderHeld();
      },
      { signal: listeners.signal },
    );
    const release = (e: PointerEvent) => {
      touch.delete(e.pointerId);
      actions.delete(e.pointerId);
      if (node.hasPointerCapture(e.pointerId))
        node.releasePointerCapture(e.pointerId);
      flush(true);
      renderHeld();
    };
    for (const name of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      node.addEventListener(name, release, { signal: listeners.signal });
  }
}
function renderPlay() {
  if (!view) return;
  root.dataset.phase = view.phase;
  buildPlay();
  const scores = required(document.getElementById("scores"));
  for (const p of view.players) {
    let node = document.getElementById("score-" + p.index);
    if (!node) {
      node = document.createElement("div");
      node.id = "score-" + p.index;
      node.style.setProperty("--player", required(colors[p.index]));
      scores.append(node);
    }
    node.className =
      "score" +
      (!p.alive ? " eliminated" : "") +
      (p.slotId === view.selfSlotId ? " self" : "");
    node.dataset.x = String(p.x);
    node.dataset.y = String(p.y);
    node.dataset.alive = String(p.alive);
    node.textContent =
      "P" +
      (p.index + 1) +
      (p.slotId === view.selfSlotId ? " 你" : "") +
      "  " +
      p.score +
      " / " +
      view.targetScore;
  }
  const own = view.players.find((p) => p.slotId === view?.selfSlotId);
  text(
    "round-status",
    "第 " +
      view.round +
      " 回合 · " +
      view.players.filter((p) => p.alive).length +
      " 人存活",
  );
  text(
    "own-status",
    own?.resigned
      ? "已投降"
      : !own?.alive
        ? "已阵亡 · 正在旁观"
        : own.invulnerable
          ? "滑行无敌"
          : view.phase === "ACTIVE"
            ? "刀锋就绪"
            : "准备对决",
  );
  text(
    "attack-cd",
    own && own.attackCooldown > 0
      ? (own.attackCooldown / 60).toFixed(2) + "s"
      : "J",
  );
  text(
    "slide-cd",
    own && own.slideCooldown > 0
      ? (own.slideCooldown / 60).toFixed(2) + "s"
      : "K / SHIFT",
  );
  const banner = required(document.getElementById("banner"));
  banner.hidden = view.phase === "ACTIVE";
  if (view.phase === "COUNTDOWN") {
    text("banner-kicker", "ROUND " + String(view.round).padStart(2, "0"));
    text("banner-title", String(Math.max(1, Math.ceil(view.countdown / 60))));
    const winner = view.players.find((p) => p.slotId === view?.lastWinner);
    text(
      "banner-detail",
      winner
        ? "P" + (winner.index + 1) + " 拿下上一回合 · 下一刀见"
        : "一击毙命 · 最后存活者得分",
    );
  } else if (view.phase === "FINISHED") {
    text("banner-kicker", "MATCH COMPLETE");
    text("banner-title", summary(view)?.headline ?? "本场结束");
    text("banner-detail", "在房间中开始下一场对决");
  }
  required(document.getElementById("connection")).hidden =
    host?.connectionState === "connected";
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-direction],[data-action]",
  ))
    button.disabled = !canControl();
}
function receive(message: HostSurfaceMessage) {
  if (disposed) return;
  if (message.type === "host.init") {
    if (
      message.gameId !== "ninja-clash" ||
      message.gameVersion !== "1.0.0" ||
      message.mode !== mode ||
      message.bridgeVersion !== 2
    ) {
      fail("SURFACE_TARGET_MISMATCH", "房间与画面版本不一致。");
      return;
    }
    init = message;
    document.documentElement.lang = message.locale;
    return;
  }
  if (message.type === "host.state") {
    if (!init) {
      fail("STATE_BEFORE_INIT", "尚未初始化。");
      return;
    }
    if (host && message.sequence <= host.sequence) return;
    try {
      const reset =
        !host ||
        host.roundNumber !== message.roundNumber ||
        host.connectionState !== "connected" ||
        message.connectionState !== "connected" ||
        message.readOnly;
      if (mode === "setup") {
        setup = setupViewSchema.parse(message.payload);
        if (reset) {
          pending = null;
          notice = "";
        }
        host = message;
        renderSetup();
      } else {
        const next = playViewSchema.parse(message.payload);
        if (message.tick === undefined) throw new Error("Missing tick");
        if (!reset && host?.tick !== undefined && message.tick < host.tick)
          return;
        const changed =
          reset ||
          !view ||
          view.round !== next.round ||
          view.phase !== next.phase ||
          next.tick - (view?.tick ?? next.tick) > 12;
        if (
          changed ||
          !next.players.find((p) => p.slotId === next.selfSlotId)?.alive
        )
          clear(false);
        previous = changed ? null : view;
        receivedAt = performance.now();
        interval = Math.min(
          100,
          Math.max(
            1000 / 60,
            ((next.tick - (view?.tick ?? next.tick - 3)) * 1000) / 60,
          ),
        );
        view = next;
        host = message;
        if (reset || view.outcome) pendingResign = null;
        for (const effect of feed.observe(view, changed || document.hidden))
          audio.play(effect.kind);
        renderPlay();
        const result = summary(view);
        if (result)
          bridge.send({
            type: "surface.result-summary",
            stateSequence: message.sequence,
            ...result,
          });
      }
    } catch {
      fail("INVALID_PROJECTED_VIEW", "收到的游戏数据无效，请重新加载。");
    }
    return;
  }
  if (message.type === "host.intent-result") {
    if (message.clientIntentId === pending) {
      pending = null;
      notice =
        message.status === "accepted"
          ? "设置已确认。"
          : message.status === "stale"
            ? "设置已变化，请查看最新设置后重试。"
            : "设置未被接受，请检查权限后重试。";
      renderSetup();
    }
    if (
      message.clientIntentId === pendingResign &&
      message.status !== "accepted"
    )
      pendingResign = null;
    return;
  }
  if (message.type === "host.environment") {
    game?.scale.refresh();
    return;
  }
  if (message.type === "host.command") {
    if (
      message.control === "RESIGN" &&
      canSend() &&
      view &&
      !view.outcome &&
      !pendingResign
    ) {
      clear(false);
      pendingResign = send({ type: "RESIGN" }, message.clientIntentId);
    }
    return;
  }
  stop();
  root.innerHTML = '<main class="loading">竞技场已关闭。</main>';
}
const bridge = new GameSurfaceBridge({
  allowedHostOrigin: document.referrer
    ? new URL(document.referrer).origin
    : "*",
  bridgeVersion: 2,
  onMessage: receive,
  onProtocolError: () => fail("BRIDGE_FAILED", "竞技场连接失败，请重试。"),
});
window.addEventListener(
  "keydown",
  (e) => {
    if (mode !== "play") return;
    const action = actionKey(e.code),
      isMove = ["KeyA", "KeyD", "ArrowLeft", "ArrowRight"].includes(e.code);
    if (!action && !isMove) return;
    if ((e.target as HTMLElement)?.closest("input,select,textarea")) return;
    e.preventDefault();
    if (e.repeat || !canControl()) return;
    void audio.unlock();
    if (isMove) {
      keys.add(e.code);
      flush(true);
    } else if (action) send(action);
  },
  { signal: listeners.signal },
);
window.addEventListener(
  "keyup",
  (e) => {
    if (keys.delete(e.code)) {
      e.preventDefault();
      flush(true);
    }
  },
  { signal: listeners.signal },
);
window.addEventListener("blur", () => clear(true), {
  signal: listeners.signal,
});
document.addEventListener("visibilitychange", () => clear(true), {
  signal: listeners.signal,
});
window.addEventListener(
  "pagehide",
  () => {
    stop();
    bridge.dispose();
  },
  { signal: listeners.signal },
);
const timer = window.setInterval(() => flush(), 50);
bridge.start();

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Expected value to be present");
  return value;
}
