import type { SetupView } from "./contracts";

export const shuttleIcon =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M20 32 7 14l10-7 16 20-13 5Z" fill="#fcfbeb" stroke="currentColor" stroke-width="2.5"/><path d="m11 12 15 18M18 9l11 19M7 14l24 14" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="29" cy="32" r="8" fill="#edc879" stroke="currentColor" stroke-width="2.5"/></svg>';

export function usesManualServe(gameVersion: string): boolean {
  if (gameVersion === "1.0.0") return false;
  if (gameVersion === "1.1.0" || gameVersion === "1.2.0") return true;
  throw new Error("Unsupported badminton version.");
}

export function serveRuleLabel(gameVersion: string): string {
  return usesManualServe(gameVersion)
    ? "发球方按 S 或点击发球按钮开始；等待时不会自动发球，也不会超时失分。"
    : "本局使用自动发球，准备倒计时结束后开球，无需按发球键。";
}

export function scoreCap(score: SetupView["config"]["targetScore"]): number {
  return { 7: 11, 11: 15, 21: 30 }[score];
}

function starterLabel(view: Readonly<SetupView>): string {
  if (view.starter === "OWNER") return "房主首发（左侧）";
  if (view.starter === "NON_OWNER") return "对手首发（左侧）";
  if (view.starter === "RANDOM") return "开局时随机决定首发方";
  if (view.starter === "FIXED") return "沿用上一局的实际首发方与场地";
  return "请房主选择首发方";
}

export function setupSummary(view: Readonly<SetupView>): string {
  const score = view.config.targetScore;
  return `${score} 分制 · 领先 2 分 · ${scoreCap(score)} 分封顶 · ${starterLabel(view)}`;
}

export function renderSetupView(
  current: Readonly<SetupView>,
  gameVersion: string,
  unavailable: boolean,
  pending: boolean,
): string {
  const disabled = unavailable || !current.canEdit;
  const score = current.config.targetScore;
  const cap = scoreCap(score);
  const manualServe = usesManualServe(gameVersion);
  return `<main class="setup-page"><section class="setup-card" aria-labelledby="setup-title">
    <div class="setup-heading"><span class="game-mark">${shuttleIcon}</span><div><p class="eyebrow">一起挥拍，快乐开场</p><h1 id="setup-title">火柴人羽毛球</h1></div><span class="two-player">双人对战</span></div>
    <p class="setup-summary" data-testid="setup-summary" aria-live="polite">${setupSummary(current)}</p>
    <figure class="setup-rule-preview" data-testid="setup-preview" data-target-score="${score}" data-score-cap="${cap}" data-serve-mode="${manualServe ? "manual" : "automatic"}">
      <div class="setup-preview" role="img" aria-label="羽毛球场示意：左侧首发，右侧接发球"><span class="preview-player blue">左侧首发</span><span class="preview-flight" aria-hidden="true">⌁</span><span class="preview-net" aria-hidden="true"></span><span class="preview-player coral">右侧接球</span><div class="preview-line" aria-hidden="true"></div></div>
      <figcaption><p class="rule-note">至少得到 ${score} 分并领先 2 分获胜；${cap} 分封顶，达到封顶即获胜。比赛为单局，每球得分者接着发球。</p><p class="serve-rule" data-testid="serve-rule">${serveRuleLabel(gameVersion)}</p></figcaption>
    </figure>
    <div class="setup-fields"><section aria-labelledby="score-choice"><div class="field-heading"><h2 id="score-choice">这一局，打几分？</h2><span>领先 2 分获胜</span></div><div class="choice-grid" role="group" aria-label="目标比分">
      ${(
        [
          [7, "轻快短局"],
          [11, "再战一会"],
          [21, "标准长局"],
        ] as const
      )
        .map(
          ([value, label]) =>
            `<button type="button" data-score="${value}" data-setup-focus="score-${value}" aria-pressed="${score === value}" aria-disabled="${disabled || pending}" ${disabled ? "disabled" : ""}><strong>${value}<small>分</small></strong><span>${label}</span><span>${scoreCap(value)} 分封顶</span></button>`,
        )
        .join("")}
    </div></section><section aria-labelledby="serve-choice"><div class="field-heading"><h2 id="serve-choice">谁先发球？</h2><span>首发方在左侧</span></div><div class="starter-grid" role="group" aria-label="首发选择">
      ${(
        [
          ["OWNER", "房主首发"],
          ["NON_OWNER", "对手首发"],
          ["RANDOM", "随机首发"],
        ] as const
      )
        .map(
          ([starter, label]) =>
            `<button type="button" data-starter="${starter}" data-setup-focus="starter-${starter}" aria-pressed="${current.starter === starter}" aria-disabled="${disabled || pending}" ${disabled ? "disabled" : ""}>${label}</button>`,
        )
        .join("")}
    </div>${current.starter === "FIXED" && !current.participantSlotIds.includes(current.fixedStarterSlotId ?? "") ? '<p class="muted">上一局首发玩家已离开，请重新选择首发方。</p>' : ""}</section></div>
    <div class="how-to"><span><kbd>A</kbd><kbd>D</kbd> 移动</span><span><kbd>W</kbd> 起跳</span>${manualServe ? "<span><kbd>S</kbd> 发球</span>" : ""}<span><kbd>J</kbd> 高远球</span><span><kbd>K</kbd> 扣杀</span><span><kbd>L</kbd> 吊球</span></div>
    <p class="setup-bottom">${current.canEdit ? "你是房主，可以修改目标比分和首发方。" : "目标比分和首发方由房主修改。"}${current.participantSlotIds.length < 2 ? "等待另一位玩家加入。" : ""}确认规则后，两位玩家分别点击房间中的准备按钮。手机可使用屏幕按钮。</p>
    <p class="notice" id="surface-notice" role="status"></p>
  </section></main>`;
}
