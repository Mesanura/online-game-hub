import {
  CHINESE_CHECKERS_CAMPS,
  type ChineseCheckersSetupView,
} from "./contracts";
import { campLabels, type ChineseCheckersCamp } from "./model";

// Six diagram anchors only; the playable board always uses projected geometry.
const anchors = {
  N: [140, 30],
  NE: [232, 84],
  SE: [232, 190],
  S: [140, 244],
  SW: [48, 190],
  NW: [48, 84],
} as const;
export const oppositeCamp = {
  N: "S",
  NE: "SW",
  SE: "NW",
  S: "N",
  SW: "NE",
  NW: "SE",
} as const;

export function confirmedStarterCamp(
  view: Readonly<ChineseCheckersSetupView>,
): ChineseCheckersCamp | null {
  if (view.starter === "CAMP") return view.starterCamp;
  if (view.starter === "FIXED")
    return (
      view.participants.find((p) => p.slotId === view.fixedStarterSlotId)
        ?.camp ?? null
    );
  if (view.starter === "OWNER" || view.starter === "NON_OWNER")
    return (
      view.participants.find((p) => p.isOwner === (view.starter === "OWNER"))
        ?.camp ?? null
    );
  return null;
}

export function setupSummary(view: Readonly<ChineseCheckersSetupView>): string {
  const first = confirmedStarterCamp(view);
  const firstLabel =
    view.starter === "RANDOM"
      ? "开局随机"
      : first === null
        ? "未选择"
        : campLabels[first];
  return `${view.targetPlayerCount} 人 · 你的营地：${view.yourCamp === null ? "未选择" : campLabels[view.yourCamp]} · 首位：${firstLabel}`;
}

export function setupHints(
  view: Readonly<ChineseCheckersSetupView>,
): readonly string[] {
  const hints: string[] = [];
  if (view.participants.length !== view.targetPlayerCount)
    hints.push(
      `已加入 ${view.participants.length}/${view.targetPlayerCount} 人，请等待玩家到齐或请房主调整人数。`,
    );
  if (view.yourCamp === null && view.canSelectCamp)
    hints.push("你还没有选择营地，请选择一个空闲营地。");
  else if (view.participants.some((p) => p.camp === null))
    hints.push("还有玩家未选营地，请等待每位玩家完成选择。");
  if (view.starter === "UNSELECTED")
    hints.push("请房主选择首位营地或随机首位。");
  if (
    view.starter === "CAMP" &&
    !view.participants.some((p) => p.camp === view.starterCamp)
  )
    hints.push(
      "指定首位营地无人参与，请让玩家选择该营地，或由房主重新指定首位。",
    );
  if (view.starter === "FIXED" && confirmedStarterCamp(view) === null)
    hints.push("上一局的首位玩家已离开或清除了营地，请房主重新选择首位。");
  return hints;
}

export function setupPreview(view: Readonly<ChineseCheckersSetupView>): string {
  const target = view.yourCamp === null ? null : oppositeCamp[view.yourCamp];
  const starter = confirmedStarterCamp(view);
  const camps = CHINESE_CHECKERS_CAMPS.map((camp, index) => {
    const [x, y] = anchors[camp];
    const occupied = view.participants.some((p) => p.camp === camp);
    const self = camp === view.yourCamp;
    const label = self
      ? "你"
      : camp === target
        ? "目标"
        : occupied
          ? "已选"
          : "空位";
    return `<g data-preview-camp="${camp}" data-camp="${camp}" data-occupied="${occupied}" data-self="${self}" data-target="${camp === target}" data-starter="${camp === starter}">
      <title>${campLabels[camp]} · ${label}${camp === starter ? " · 首位" : ""}</title>
      <circle cx="${x}" cy="${y}" r="23"/><text x="${x}" y="${y + 5}" text-anchor="middle">${index + 1}</text>
      <text class="camp-state" x="${x}" y="${y + 39}" text-anchor="middle">${label}${camp === starter ? " · 首位" : ""}</text>
    </g>`;
  }).join("");
  const line =
    view.yourCamp === null || target === null
      ? ""
      : `<path class="target-line" d="M${anchors[view.yourCamp].join(" ")} L${anchors[target].join(" ")}"/>`;
  return `<figure class="camp-preview" data-testid="setup-preview">
    <svg viewBox="0 0 280 300" role="img" aria-label="六营地示意：标出你的营地、对角目标、占用状态与首位">
      ${line}<path class="order-arrow" d="M110 69A78 78 0 0 0 80 185m-1-13 1 13-12-5"/>
      <text x="140" y="138" text-anchor="middle" class="order-label">逆时针</text>${camps}
    </svg>
    <figcaption><strong>把棋子全部移入对角营地</strong><p>${target === null ? "选择营地后，这里会标出你的对角目标。" : `你的目标：${campLabels[target]}`}</p><p>从首位营地开始，按逆时针方向依次行动，跳过无人参与的营地。编号从北方开始顺时针排列；编号方向与行棋方向不同。</p></figcaption>
  </figure>`;
}
