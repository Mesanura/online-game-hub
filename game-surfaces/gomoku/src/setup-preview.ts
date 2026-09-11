import type { GomokuSetupView } from "./contracts";

export function setupPreview(view: Readonly<GomokuSetupView>): string {
  const size = view.config.boardSize;
  const step = 168 / (size - 1);
  const lines = Array.from({ length: size }, (_, index) => {
    const coordinate = 16 + index * step;
    return `<path data-preview-line d="M16 ${coordinate}H184M${coordinate} 16V184"/>`;
  }).join("");
  const stones = Array.from(
    { length: 5 },
    (_, index) =>
      `<circle cx="${16 + (index + Math.floor(size / 2) - 2) * step}" cy="100" r="${step * 0.42}" fill="#30332e"/>`,
  ).join("");
  return `<figure class="setup-preview" data-testid="setup-preview" data-board-size="${size}">
    <svg viewBox="0 0 200 200" role="img" aria-label="${size}乘${size}棋盘和黑棋五连示意">
      <rect width="200" height="200" rx="12" fill="#ead2a5"/>
      <g fill="none" stroke="#95734e" stroke-width="0.7">${lines}</g>${stones}
    </svg>
    <figcaption><strong>${size}×${size} · 黑棋先手</strong><p>黑白交替在空交点落子。横、竖或斜向连续五子及以上获胜；棋盘填满且无人连成五子则平局。没有禁手。</p></figcaption>
  </figure>`;
}
