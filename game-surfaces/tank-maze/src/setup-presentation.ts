import type { Setup } from "./contracts";
import { COLORS, COLOR_NAMES, WEAPONS } from "./model";

export function setupSummary(s: Readonly<Setup>): string {
  const color = s.selfSlotId === null ? undefined : s.colors[s.selfSlotId];
  return `${s.config.playerCount} 人 · 先到 ${s.config.targetScore} 分获胜 · 你的颜色：${color === undefined ? "等待分配" : COLOR_NAMES[color]}`;
}

export function participantHint(s: Readonly<Setup>): string {
  if (s.players.length > s.config.playerCount)
    return `已加入 ${s.players.length}/${s.config.playerCount} 人，人数超出设置。请房主增加人数，或让多余玩家离开后准备；不会自动踢出玩家。`;
  if (s.players.length < s.config.playerCount)
    return `已加入 ${s.players.length}/${s.config.playerCount} 人，请等待玩家到齐或由房主调整人数。`;
  return `已加入 ${s.players.length}/${s.config.playerCount} 人，在房间中全部准备后开始。`;
}

export function renderSetupView(
  s: Readonly<Setup>,
  disabled: boolean,
  pending: boolean,
): string {
  const selected = s.selfSlotId === null ? undefined : s.colors[s.selfSlotId];
  const ruleDisabled = disabled || !s.canEdit;
  const select = (
    kind: string,
    current: number,
    values: readonly number[],
    unit: string,
  ) =>
    `<select data-setting="${kind}" data-setup-focus="${kind}" aria-disabled="${ruleDisabled || pending}" ${ruleDisabled ? "disabled" : ""}>${values.map((n) => `<option value="${n}" ${current === n ? "selected" : ""}>${n} ${unit}</option>`).join("")}</select>`;
  const palette = COLORS.map((color, index) => {
    const occupied = s.players.some(
      (p) => p.color === index && p.slotId !== s.selfSlotId,
    );
    const unavailable = disabled || occupied || s.selfSlotId === null;
    return `<button type="button" data-color="${index}" data-setup-focus="color-${index}" aria-pressed="${selected === index}" aria-disabled="${unavailable || pending}" style="--tank:${color}" ${unavailable ? "disabled" : ""}><span class="mini-tank" aria-hidden="true"></span>${COLOR_NAMES[index]}${selected === index ? " · 你" : occupied ? " · 已选" : ""}</button>`;
  }).join("");
  const roster = s.players
    .map(
      (player, index) =>
        `<li data-participant-color="${player.color}" style="--tank:${COLORS[player.color]}"><span class="mini-tank" aria-hidden="true"></span><span>玩家 ${index + 1}${player.slotId === s.selfSlotId ? " · 你" : ""}</span><strong>${COLOR_NAMES[player.color]}色</strong></li>`,
    )
    .join("");
  return `<main class="setup setup-card"><div class="eyebrow">TANK MAZE · 2–8 PLAYERS</div><h1>坦克迷战</h1><p class="intro">拐角之后，谁会成为最后的幸存者？</p>
    <p data-testid="setup-summary" aria-live="polite">${setupSummary(s)}</p>
    <div class="settings"><label>本场人数${select("count", s.config.playerCount, [2, 3, 4, 5, 6, 7, 8], "人")}</label><label>获胜分数${select("score", s.config.targetScore, [5, 10, 15, 20], "分")}</label></div>
    <p class="roster">${s.canEdit ? "房主可调整人数与目标分数。" : "人数与目标分数由房主修改，你可以选择自己的颜色。"}</p>
    <h2>选择你的颜色</h2><div class="palette">${palette}</div>
    <p class="roster" data-testid="setup-status">${participantHint(s)}</p>
    <ul class="setup-roster" aria-label="参与者颜色">${roster}</ul>
    <figure class="bout-preview" data-testid="setup-preview">
      <svg viewBox="0 0 240 88" role="img" aria-label="多人开战，最后一辆坦克坚持四秒获得一分，小局换图复活">
        <rect x="4" y="4" width="232" height="80" rx="12" fill="#e5e9df"/>
        <g fill="${selected === undefined ? COLORS[0] : COLORS[selected]}" stroke="#364838" stroke-width="2">
          <rect x="20" y="25" width="40" height="30" rx="5"/><circle cx="40" cy="40" r="10"/><path d="M42 36h29v8H42Z"/>
        </g>
        <text x="91" y="47" fill="#364838" font-size="17">生存 4 秒 → +1</text>
      </svg>
      <figcaption>每场包含多个小局，先累计到 ${s.config.targetScore} 分的玩家获胜。最后一辆坦克坚持 4 秒得 1 分；全灭或 120 秒僵持无人得分。每小局换图复活。</figcaption>
    </figure>
    <div class="rules"><h2>操作与规则</h2><p><kbd>W</kbd><kbd>S</kbd> 前进 / 后退\u3000<kbd>A</kbd><kbd>D</kbd> 旋转\u3000<kbd>空格</kbd> 按次开火<br>也支持方向键与触屏多指按钮。</p><p>普通炮最多 5 颗，13 秒后消失。所有攻击都能伤到自己！</p>
    <div class="weapon-list">${Object.entries(WEAPONS)
      .filter(([key]) => key !== "normal")
      .map(
        ([key, name]) =>
          `<span>${({ laser: "⌁", missile: "➤", machine: "⋮", shotgun: "⁙", shield: "◇" } as Record<string, string>)[key]} ${name}</span>`,
      )
      .join("")}</div><p>一把特殊武器＋独立护盾；新武器替换旧武器。</p></div>
    <p role="status">${disabled ? "连接尚未就绪，请等待重连。" : pending ? "正在确认设置…" : "已连接"}</p><p id="notice" role="status"></p></main>`;
}
