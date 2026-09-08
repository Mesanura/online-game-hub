import {
  GameSurfaceBridge,
  type HostSurfaceMessage,
} from "@online-game-hub/game-surface-bridge";
import { viewSchema, setupSchema, type View, type Setup } from "./contracts";
import {
  COLORS,
  COLOR_NAMES,
  WEAPONS,
  KEYS,
  Controls,
  summary,
  interpolate,
} from "./model";
import { TankAudio } from "./audio";
import "./styles.css";
const root = required(document.getElementById("root"));
const mode = location.pathname.includes("/setup/") ? "setup" : "play";
const controls = new Controls(),
  audio = new TankAudio(),
  listeners = new AbortController();
let init: Extract<
  HostSurfaceMessage,
  {
    type: "host.init";
  }
> | null = null;
let host: Extract<
  HostSurfaceMessage,
  {
    type: "host.state";
  }
> | null = null;
let view: View | null = null,
  previous: View | null = null,
  setup: Setup | null = null;
let failed = false,
  disposed = false,
  sequence = 0,
  received = 0,
  lastEvent = 0;
let pendingSetup: string | null = null;
let arenaKey = "";
const trails = new Map<string, { x: number; y: number }[]>();
const explosions = new Map<string, { x: number; y: number; until: number }>();
const p = (n: number) => n / 1000;
function notice(text: string) {
  const el = document.getElementById("notice");
  if (el) el.textContent = text;
}
function connected() {
  return (
    !failed &&
    !disposed &&
    init !== null &&
    host?.connectionState === "connected" &&
    !host.readOnly
  );
}
function canMove() {
  return (
    connected() &&
    view !== null &&
    view.outcome === null &&
    view.phase !== "PREPARE" &&
    view.tanks.some((t) => t.slotId === view?.selfSlotId && t.alive) &&
    !document.hidden
  );
}
function send(intent: Record<string, string | number>, id?: string) {
  if (!connected()) return null;
  const clientIntentId = id ?? "tank-" + mode + "-" + ++sequence;
  if (!bridge.send({ type: "surface.intent", clientIntentId, intent })) {
    notice("操作暂未送达，请重试。");
    return null;
  }
  return clientIntentId;
}
function release() {
  const held = controls.held.size > 0;
  controls.reset();
  if (held && connected() && mode === "play") send(controls.intent());
}
function fail(code: string, message: string) {
  failed = true;
  controls.reset();
  root.textContent = message;
  bridge.send({ type: "surface.error", code, message });
}
function renderSetup() {
  const s = setup;
  if (s === null) return;
  const selected = s.selfSlotId === null ? undefined : s.colors[s.selfSlotId];
  root.innerHTML =
    '<main class="setup"><div class="eyebrow">TANK MAZE · 2–8 PLAYERS</div><h1>坦克迷战</h1><p class="intro">拐角之后，谁会成为最后的幸存者？</p><div class="settings"><label>本场人数<select data-setting="count" ' +
    (!s.canEdit || pendingSetup ? "disabled" : "") +
    ">" +
    [2, 3, 4, 5, 6, 7, 8]
      .map(
        (n) =>
          "<option " +
          (n === s.config.playerCount ? "selected" : "") +
          ' value="' +
          n +
          '">' +
          n +
          " 人</option>",
      )
      .join("") +
    '</select></label><label>获胜分数<select data-setting="score" ' +
    (!s.canEdit || pendingSetup ? "disabled" : "") +
    ">" +
    [5, 10, 15, 20]
      .map(
        (n) =>
          "<option " +
          (n === s.config.targetScore ? "selected" : "") +
          ' value="' +
          n +
          '">' +
          n +
          " 分</option>",
      )
      .join("") +
    '</select></label></div><h2>选择你的颜色</h2><div class="palette">' +
    COLORS.map((c, i) => {
      const occupied = s.players.some(
        (t) => t.color === i && t.slotId !== s.selfSlotId,
      );
      return (
        '<button data-color="' +
        i +
        '" aria-pressed="' +
        (i === selected) +
        '" style="--tank:' +
        c +
        '" ' +
        (occupied || pendingSetup ? "disabled" : "") +
        '><span class="mini-tank"></span>' +
        COLOR_NAMES[i] +
        (i === selected ? " · 你" : occupied ? " · 已选" : "") +
        "</button>"
      );
    }).join("") +
    '</div><p class="roster">' +
    s.players.length +
    " / " +
    s.config.playerCount +
    " 人已加入。" +
    (s.players.length > s.config.playerCount
      ? "请房主增加人数，或让多余玩家离开后准备。"
      : "在房间中全部准备后开始。") +
    '</p><div class="rules"><h2>操作与规则</h2><p><kbd>W</kbd><kbd>S</kbd> 前进 / 后退　<kbd>A</kbd><kbd>D</kbd> 旋转　<kbd>空格</kbd> 按次开火<br>也支持方向键与触屏多指按钮。</p><p>普通炮最多 5 颗，13 秒后消失。所有攻击都能伤到自己！最后一辆坦克坚持 4 秒得 1 分；全灭无人得分。</p><div class="weapon-list">' +
    Object.entries(WEAPONS)
      .filter(([k]) => k !== "normal")
      .map(
        ([k, n]) =>
          "<span>" +
          { laser: "⌁", missile: "➤", machine: "⋮", shotgun: "⁙", shield: "◇" }[
            k
          ] +
          " " +
          n +
          "</span>",
      )
      .join("") +
    '</div><p>一把特殊武器＋独立护盾；新武器替换旧武器。每小局换图复活，120 秒僵持则平局。</p></div><p id="notice" role="status"></p></main>';
}
function mountPlay() {
  root.innerHTML =
    '<main class="play"><header><div><span class="eyebrow">TANK MAZE</span><strong>坦克迷战</strong></div><div id="phase" role="status"></div><button id="sound" aria-pressed="false">声音 开</button></header><div id="scores" class="scores"></div><div class="arena-wrap"><div id="countdown" aria-live="polite"></div><svg id="arena" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="坦克迷战实时战场"></svg></div><footer><span id="ammo"></span><span id="notice" role="status"></span><span class="keyboard-help">WASD / 方向键 · 空格按次开火</span></footer><div class="touch"><div class="drive"><button data-control="left" aria-label="向左旋转">↶</button><div><button data-control="up" aria-label="前进">▲</button><button data-control="down" aria-label="后退">▼</button></div><button data-control="right" aria-label="向右旋转">↷</button></div><button class="fire" data-control="fire" aria-label="发射炮弹">开火</button></div></main>';
}
function renderHud() {
  if (view === null) return;
  required(document.getElementById("scores")).innerHTML = view.tanks
    .map(
      (t, i) =>
        '<div class="score ' +
        (t.slotId === view?.selfSlotId ? "self" : "") +
        " " +
        (!t.alive ? "dead" : "") +
        '" style="--tank:' +
        COLORS[t.color] +
        '"><span class="dot"></span><span>' +
        COLOR_NAMES[t.color] +
        " " +
        (i + 1) +
        (t.slotId === view?.selfSlotId ? " · 你" : "") +
        "</span><b>" +
        t.score +
        "</b><small>" +
        (t.resigned ? "已投降" : !t.alive ? "已淘汰" : "") +
        "</small></div>",
    )
    .join("");
  required(document.getElementById("phase")).textContent =
    summary(view) ??
    "第 " +
      view.bout +
      " 小局 · " +
      (view.phase === "PREPARE"
        ? "准备 " + Math.ceil(view.phaseTicks / 60)
        : view.phase === "LAST"
          ? "最后生存 " + Math.ceil(view.phaseTicks / 60) + " 秒"
          : Math.max(0, 120 - Math.floor(view.elapsed / 60)) + " 秒") +
      " · 先到 " +
      view.config.targetScore +
      " 分";
  const self = view.tanks.find((t) => t.slotId === view?.selfSlotId);
  required(document.getElementById("ammo")).textContent =
    self === undefined
      ? ""
      : !self.alive
        ? self.resigned
          ? "已投降，等待本场结束"
          : "已淘汰，下小局复活"
        : WEAPONS[self.weapon] +
          " · " +
          (self.weapon === "normal" ? 5 - self.normalCount : self.ammo) +
          " 发" +
          (self.shield > 0
            ? " · 护盾 " + Math.ceil(self.shield / 60) + " 秒"
            : "");
  root.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((b) => {
    b.disabled = !canMove();
  });
}
function draw(now: number) {
  if (disposed) return;
  const v = view;
  if (v !== null && !failed && mode === "play") {
    const svg = required(document.getElementById("arena"));
    const countdown = document.getElementById("countdown");
    if (countdown) countdown.textContent = v.phase === "PREPARE" && v.phaseTicks <= 180 ? String(Math.ceil(v.phaseTicks / 60)) : "";
    const alpha = init?.reducedMotion
      ? 1
      : Math.min(
          1,
          (now - received) /
            Math.max(
              16.67,
              ((v.tick - (previous?.tick ?? v.tick - 1)) * 1000) / 60,
            ),
        );
    svg.setAttribute(
      "viewBox",
      "0 0 " + p(v.arena.width) + " " + p(v.arena.height),
    );
    const key = String(host?.roundNumber) + ":" + v.bout;
    if (key !== arenaKey) {
      arenaKey = key;
      svg.innerHTML =
        '<defs><pattern id="floor" width="200" height="200" patternUnits="userSpaceOnUse"><rect width="200" height="200" fill="#e8e8e5"/><path d="M0 0H100V100H0ZM100 100H200V200H100Z" fill="#dededb"/></pattern></defs><rect width="100%" height="100%" fill="url(#floor)"/>' +
        v.arena.walls
          .map(
            (w) =>
              '<rect x="' +
              p(w.x) +
              '" y="' +
              p(w.y) +
              '" width="' +
              p(w.w) +
              '" height="' +
              p(w.h) +
              '" fill="#656b68"/>',
          )
          .join("") +
        '<g id="dynamic"></g>';
    }
    let html = "";
    const nowTick = v.tick;
    for (const [id, fx] of explosions) if (fx.until <= nowTick) explosions.delete(id);
    html += Array.from(explosions.values()).map((fx) => '<g class="explosion" transform="translate(' + p(fx.x) + ' ' + p(fx.y) + ')"><circle r="22" fill="#f39c4a" opacity=".75"/><circle r="11" fill="#4b4b4b" opacity=".8"/></g>').join("");
    html += v.aims
      .map(
        (a) =>
          '<polyline points="' +
          a.points.map((q) => p(q.x) + "," + p(q.y)).join(" ") +
          '" fill="none" stroke="' +
          COLORS[required(v.tanks.find((t) => t.slotId === a.slotId)).color] +
          '" stroke-width="1.8" stroke-dasharray="3 8" opacity=".65"/>',
      )
      .join("");
    html += v.pickups
      .map(
        (q) =>
          '<g transform="translate(' +
          p(q.x) +
          " " +
          p(q.y) +
          ')"><rect x="-13" y="-13" width="40" height="40" rx="5" fill="#faf8eb" stroke="#626960" stroke-width="2"/><text text-anchor="middle" y="5" font-size="28" fill="#3c4940">' +
          { laser: "⌁", missile: "➤", machine: "⋮", shotgun: "⁙", shield: "◇" }[
            q.kind
          ] +
          "</text></g>",
      )
      .join("");
    for (const b of v.bullets) {
      const old = previous?.bullets.find((q) => q.id === b.id);
      const x = p(old ? interpolate(old.x, b.x, alpha) : b.x),
        y = p(old ? interpolate(old.y, b.y, alpha) : b.y);
      if (b.kind === "missile") {
        const color =
          b.target === null
            ? "#656565"
            : COLORS[
                required(v.tanks.find((t) => t.slotId === b.target)).color
              ];
        if (!init?.reducedMotion)
          html += (trails.get(b.id) ?? [])
            .map(
              (q, i, a) =>
                '<circle cx="' +
                p(q.x) +
                '" cy="' +
                p(q.y) +
                '" r="' +
                (2 + (i / a.length) * 3) +
                '" fill="' +
                color +
                '" opacity="' +
                (0.08 + (0.3 * i) / a.length) +
                '"/>',
            )
            .join("");
        html +=
          '<path d="M8 0L-6 -4L-3 0L-6 4Z" transform="translate(' +
          x +
          " " +
          y +
          ") rotate(" +
          (Math.atan2(b.vy, b.vx) * 180) / Math.PI +
          ')" fill="#454d48" stroke="#202823"/>';
      } else if (b.kind === "laser") {
        html +=
          '<polyline points="' +
          b.trail.map((point) => p(point.x) + "," + p(point.y)).join(" ") +
          '" fill="none" stroke="' +
          COLORS[required(v.tanks.find((t) => t.slotId === b.owner)).color] +
          '" stroke-width="4" stroke-linecap="round"/>';
      } else
        html +=
          '<circle cx="' +
          x +
          '" cy="' +
          y +
          '" r="' +
          p(b.radius) +
          '" fill="#242a26"/>';
    }
    for (const t of v.tanks) {
      if (!t.alive) continue;
      const old = previous?.tanks.find((q) => q.slotId === t.slotId && q.alive);
      const x = p(old ? interpolate(old.x, t.x, alpha) : t.x),
        y = p(old ? interpolate(old.y, t.y, alpha) : t.y);
      const angle = old
        ? (old.angle + (((t.angle - old.angle + 1080) % 720) - 360) * alpha) / 2
        : t.angle / 2;
      html += '<g transform="translate(' + x + " " + y + ')">';
      if (t.shield > 0)
        html +=
          '<circle r="30" fill="#75e5ec" fill-opacity=".23" stroke="#50d6e4" stroke-opacity=".7" stroke-width="2"/>';
      if (t.slotId === v.selfSlotId)
        html +=
          '<circle r="24" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 4"/>';
      html +=
        '<g transform="rotate(' +
        angle +
        ')"><rect x="-19" y="-15" width="38" height="30" rx="3" fill="' +
        COLORS[t.color] +
        '" stroke="#263a2d" stroke-width="1.7"/><path d="M-17 -12H17M-17 12H17" stroke="#213a2c" stroke-width="4" opacity=".45"/><circle r="10" fill="' +
        COLORS[t.color] +
        '" stroke="#263a2d" stroke-width="1.5"/><rect x="5" y="-4" width="24" height="8" rx="1" fill="' +
        COLORS[t.color] +
        '" stroke="#263a2d" stroke-width="1.5"/></g><text y="4" text-anchor="middle" fill="#fff" font-size="9" font-weight="700" pointer-events="none">' +
        (v.tanks.indexOf(t) + 1) +
        "</text></g>";
    }
    const fragment = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    fragment.innerHTML = html;
    reconcile(required(document.getElementById("dynamic")), fragment);
  }
  requestAnimationFrame(draw);
}
function reconcile(current: Element, next: Element) {
  const oldNodes = Array.from(current.childNodes),
    newNodes = Array.from(next.childNodes);
  for (let i = 0; i < newNodes.length; i++) {
    const old = oldNodes[i],
      fresh = required(newNodes[i]);
    if (old === undefined) {
      current.appendChild(fresh);
      continue;
    }
    if (old.nodeName !== fresh.nodeName) {
      current.replaceChild(fresh, old);
      continue;
    }
    if (old instanceof Element && fresh instanceof Element) {
      for (const attribute of Array.from(old.attributes))
        if (!fresh.hasAttribute(attribute.name))
          old.removeAttribute(attribute.name);
      for (const attribute of Array.from(fresh.attributes))
        if (old.getAttribute(attribute.name) !== attribute.value)
          old.setAttribute(attribute.name, attribute.value);
      reconcile(old, fresh);
    } else if (old.textContent !== fresh.textContent)
      old.textContent = fresh.textContent;
  }
  for (let i = newNodes.length; i < oldNodes.length; i++)
    required(oldNodes[i]).remove();
}
function handle(message: HostSurfaceMessage) {
  if (disposed || failed) return;
  if (message.type === "host.init") {
    if (
      message.gameId !== "tank-maze" ||
      message.gameVersion !== "1.0.0" ||
      message.mode !== mode
    ) {
      fail("SURFACE_TARGET_MISMATCH", "游戏版本不匹配。");
      return;
    }
    init = message;
    return;
  }
  if (message.type === "host.state") {
    if (init === null) {
      fail("STATE_BEFORE_INIT", "游戏尚未初始化。");
      return;
    }
    try {
      const oldHost = host;
      host = message;
      if (
        oldHost?.roundNumber !== message.roundNumber ||
        oldHost?.connectionState !== message.connectionState
      )
        pendingSetup = null;
      if (mode === "setup") {
        setup = setupSchema.parse(message.payload);
        renderSetup();
      } else {
        const next = viewSchema.parse(message.payload);
        const reset =
          oldHost?.roundNumber !== message.roundNumber ||
          oldHost.connectionState !== "connected" ||
          view?.bout !== next.bout ||
          next.tick < (view?.tick ?? 0);
        if (reset) {
          previous = null;
          trails.clear();
          lastEvent = 0;
          controls.reset();
        } else if (next.tick !== view?.tick) previous = view;
        if (next.tick !== view?.tick || reset) received = performance.now();
        view = next;
        if (!document.getElementById("arena")) mountPlay();
        if (!canMove()) release();
        for (const b of next.bullets.filter((b) => b.kind === "missile")) {
          const track = trails.get(b.id) ?? [];
          track.push({ x: b.x, y: b.y });
          if (track.length > 15) track.shift();
          trails.set(b.id, track);
        }
        for (const id of trails.keys())
          if (!next.bullets.some((b) => b.id === id)) trails.delete(id);
        for (const e of next.events)
          if (e.id > lastEvent) {
            audio.play(e.kind);
            if (e.kind === "hit") explosions.set(e.id, { x: e.x, y: e.y, until: next.tick + 24 });
            lastEvent = e.id;
          }
        renderHud();
        const headline = summary(next);
        if (headline !== null)
          bridge.send({
            type: "surface.result-summary",
            stateSequence: message.sequence,
            tone:
              next.outcome?.winnerSlotId === next.selfSlotId
                ? "win"
                : next.outcome?.type === "DRAW"
                  ? "draw"
                  : "loss",
            headline,
          });
      }
    } catch {
      fail("INVALID_PROJECTED_VIEW", "收到的游戏数据无效，请重新加载。");
    }
    return;
  }
  if (message.type === "host.command") {
    if (message.control === "RESIGN" && connected() && view?.outcome === null) {
      release();
      send({ type: "RESIGN" }, message.clientIntentId);
    }
    return;
  }
  if (message.type === "host.intent-result") {
    if (message.clientIntentId === pendingSetup) pendingSetup = null;
    if (mode === "setup") renderSetup();
    if (message.status !== "accepted")
      notice(
        message.status === "stale"
          ? "设置已更新，请重试。"
          : "操作未被接受，请重试。",
      );
    return;
  }
  if (message.type === "host.environment") return;
  disposed = true;
  controls.reset();
  audio.close();
  clearInterval(heartbeat);
  listeners.abort();
  root.textContent = "游戏画面已关闭。";
}
root.innerHTML = '<main class="loading" role="status">正在展开迷宫…</main>';
const bridge = new GameSurfaceBridge({
  allowedHostOrigin: "*",
  onMessage: handle,
  onProtocolError: () =>
    fail("BRIDGE_UNAVAILABLE", "与房间的连接中断，请重新加载。"),
});
bridge.start();
root.addEventListener(
  "change",
  (e) => {
    const target = e.target;
    if (
      !(target instanceof HTMLSelectElement) ||
      setup?.canEdit !== true ||
      pendingSetup
    )
      return;
    pendingSetup = send(
      target.dataset.setting === "count"
        ? { type: "SET_PLAYER_COUNT", playerCount: Number(target.value) }
        : { type: "SET_TARGET_SCORE", targetScore: Number(target.value) },
    );
  },
  { signal: listeners.signal },
);
root.addEventListener(
  "click",
  (e) => {
    const target =
      e.target instanceof Element
        ? e.target.closest<HTMLButtonElement>("button")
        : null;
    if (target === null) return;
    if (target.id === "sound") {
      audio.unlock();
      audio.muted = !audio.muted;
      target.textContent = audio.muted ? "声音 关" : "声音 开";
      target.setAttribute("aria-pressed", String(audio.muted));
    }
    if (target.dataset.color !== undefined && !pendingSetup)
      pendingSetup = send({
        type: "SELECT_COLOR",
        color: Number(target.dataset.color),
      });
  },
  { signal: listeners.signal },
);
root.addEventListener(
  "pointerdown",
  (e) => {
    const target =
      e.target instanceof Element
        ? e.target.closest<HTMLButtonElement>("[data-control]")
        : null;
    if (target === null || !canMove()) return;
    e.preventDefault();
    audio.unlock();
    target.setPointerCapture(e.pointerId);
    const control = required(target.dataset.control);
    if (control === "fire") send({ type: "FIRE" });
    else {
      controls.press("touch-" + e.pointerId, control);
      send(controls.intent());
    }
  },
  { signal: listeners.signal },
);
for (const name of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
] as const)
  root.addEventListener(
    name,
    (e) => {
      controls.release("touch-" + e.pointerId);
      if (canMove()) send(controls.intent());
    },
    { signal: listeners.signal },
  );
window.addEventListener(
  "keydown",
  (e) => {
    const c = KEYS[e.code];
    if (
      c === undefined ||
      !canMove() ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      e.target instanceof HTMLSelectElement
    )
      return;
    e.preventDefault();
    if (e.repeat) return;
    audio.unlock();
    if (c === "fire") send({ type: "FIRE" });
    else {
      controls.press(e.code, c);
      send(controls.intent());
    }
  },
  { signal: listeners.signal },
);
window.addEventListener(
  "keyup",
  (e) => {
    if (KEYS[e.code] !== undefined) {
      e.preventDefault();
      controls.release(e.code);
      if (canMove()) send(controls.intent());
    }
  },
  { signal: listeners.signal },
);
window.addEventListener("blur", release, { signal: listeners.signal });
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) release();
  },
  { signal: listeners.signal },
);
window.addEventListener(
  "pagehide",
  () => {
    release();
    disposed = true;
    clearInterval(heartbeat);
    audio.close();
    bridge.dispose();
    listeners.abort();
  },
  { signal: listeners.signal },
);
const heartbeat = setInterval(() => {
  if (canMove() && controls.held.size > 0) send(controls.intent());
}, 150);
requestAnimationFrame(draw);

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required tank value is missing.");
  return value;
}
