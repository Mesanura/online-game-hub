export function setupPreview(): string {
  const cells = Array.from({ length: 64 }, (_, cell) => {
    const row = Math.floor(cell / 8);
    const column = cell % 8;
    const color =
      cell === 27 || cell === 36
        ? "#fffaf0"
        : cell === 28 || cell === 35
          ? "#292e28"
          : null;
    return `<rect x="${12 + column * 22}" y="${12 + row * 22}" width="22" height="22" fill="none" stroke="#a0b8a2" stroke-width="0.8"/>${color === null ? "" : `<circle cx="${23 + column * 22}" cy="${23 + row * 22}" r="8.5" fill="${color}"/>`}`;
  }).join("");
  return `<figure class="setup-preview" data-testid="setup-preview">
    <svg viewBox="0 0 200 200" role="img" aria-label="八乘八初始布局，D4和E5为白棋，E4和D5为黑棋">
      <rect width="200" height="200" rx="12" fill="#467453"/>${cells}
    </svg>
    <figcaption><strong>黑棋先手 · 中央四子开局</strong><p>落子必须与己方棋子夹住一条直线上的对方棋子，被夹的棋子全部翻转。无合法落点时自动跳过；双方都无合法落点时，棋子多者胜，同数平局。</p><p class="capture-example" aria-label="黑棋夹住白棋后，白棋翻为黑棋">● ○ ● → ● ● ●</p></figcaption>
  </figure>`;
}
