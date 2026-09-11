export function setupPreview(): string {
  const cells = Array.from({ length: 42 }, (_, cell) => {
    const row = Math.floor(cell / 7);
    const column = cell % 7;
    const fill =
      row === 5 && column < 4
        ? "#be3939"
        : row === 5 && column === 4
          ? "#dca724"
          : "#fff9e9";
    return `<circle cx="${30 + column * 28}" cy="${38 + row * 28}" r="10" fill="${fill}"/>`;
  }).join("");
  return `<figure class="setup-preview" data-testid="setup-preview">
    <svg viewBox="0 0 228 198" role="img" aria-label="七列六行棋盘，棋子向下落，底行四枚红棋相连">
      <rect x="10" y="18" width="208" height="178" rx="14" fill="#4f7699"/>${cells}
      <path d="M114 24v119m-6-7 6 8 6-8" fill="none" stroke="#be3939" stroke-width="3"/>
      <path d="M30 178h84" stroke="#fff" stroke-width="2"/>
    </svg>
    <figcaption><strong>红棋先手，黄棋后手</strong><p>从列顶投入棋子，会落到该列最低的空位。横、竖或斜向连续四枚同色棋子获胜；棋盘填满且无人四连则平局。</p></figcaption>
  </figure>`;
}
