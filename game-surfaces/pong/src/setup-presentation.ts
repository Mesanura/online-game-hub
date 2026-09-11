import type { PongSetupView } from "./contracts";
import { setupStatusLabel } from "./model";

export function setupSummary(view: Readonly<PongSetupView>): string {
  return `先到 ${view.config.targetScore} 分获胜 · ${setupStatusLabel(view)}`;
}

export function setupPreview(view: Readonly<PongSetupView>): string {
  const left =
    view.starter === "OWNER"
      ? "房主"
      : view.starter === "NON_OWNER"
        ? "对手"
        : view.starter === "FIXED"
          ? "沿用上一局"
          : "开局前确定";
  const right =
    view.starter === "OWNER"
      ? "对手"
      : view.starter === "NON_OWNER"
        ? "房主"
        : view.starter === "FIXED"
          ? "沿用上一局"
          : "开局前确定";
  return `<figure class="setup-preview" data-testid="setup-preview" data-target-score="${view.config.targetScore}">
    <svg viewBox="0 0 360 164" role="img" aria-label="左右球拍站位示意，球位于场地中心">
      <rect x="5" y="5" width="350" height="124" rx="16" fill="#142827" stroke="#83aaa4"/>
      <path d="M180 6V128" stroke="#83aaa4" stroke-dasharray="5 6"/>
      <rect x="24" y="42" width="10" height="50" rx="5" fill="#f3b29f"/>
      <rect x="326" y="42" width="10" height="50" rx="5" fill="#7fd0c4"/>
      <circle data-preview-ball cx="180" cy="67" r="6" fill="#fff4c7"/>
      <text x="88" y="69" text-anchor="middle" fill="#f7f1e4">${left}</text>
      <text x="272" y="69" text-anchor="middle" fill="#f7f1e4">${right}</text>
      <text x="88" y="151" text-anchor="middle" fill="#f3b29f">左侧球拍</text>
      <text x="272" y="151" text-anchor="middle" fill="#7fd0c4">右侧球拍</text>
    </svg>
    <figcaption>上下移动球拍接球；球越过对方底线，你得 1 分。先到 ${view.config.targetScore} 分获胜。开局及每次发球方向由游戏随机决定。</figcaption>
  </figure>`;
}

export function renderSetupView(
  view: Readonly<PongSetupView>,
  unavailable: boolean,
  pending: boolean,
  status: string,
): string {
  const disabled = unavailable || !view.canEdit;
  const options = [
    ["OWNER", "房主在左", "对手使用右侧球拍"],
    ["NON_OWNER", "房主在右", "对手使用左侧球拍"],
    ["RANDOM", "随机站位", "开局时决定，下一局沿用"],
  ] as const;
  const hints = [
    view.canEdit
      ? "你是房主，可以修改目标分数和左右站位。"
      : "目标分数与站位由房主修改。",
    view.participantSlotIds.length < 2
      ? "等待另一位玩家加入；选好设置后，两位玩家仍需分别准备。"
      : "确认本局规则后，两位玩家分别准备。",
    view.starter === "FIXED" &&
    !view.participantSlotIds.includes(view.fixedStarterSlotId ?? "")
      ? "上一局左侧玩家已离开，请重新选择站位。"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<main class="setup-surface"><section class="setup-card" aria-labelledby="setup-title">
    <div class="eyebrow">下一局设置</div><h1 id="setup-title">目标分数与站位</h1>
    <p class="setup-summary" data-testid="setup-summary" aria-live="polite">${setupSummary(view)}</p>
    ${setupPreview(view)}
    <label class="target-score">获胜分数<select data-target-score data-setup-focus="target-score" aria-disabled="${disabled || pending}" ${disabled ? "disabled" : ""}>${Array.from(
      { length: 9 },
      (_, index) => index + 1,
    )
      .map(
        (score) =>
          `<option value="${score}" ${score === view.config.targetScore ? "selected" : ""}>${score} 分</option>`,
      )
      .join("")}</select></label>
    <div class="setup-options" role="group" aria-label="左右站位">
      ${options.map(([value, label, description]) => `<button aria-pressed="${view.starter === value}" aria-disabled="${disabled || pending}" data-setup-focus="starter-${value}" class="setup-option" data-starter="${value}" ${disabled ? "disabled" : ""} type="button"><strong>${label}</strong><span>${description}</span></button>`).join("")}
    </div>
    <p class="setup-footnote">${hints}</p>
    <div class="surface-meta" aria-live="polite">${status}</div>
  </section></main>`;
}
