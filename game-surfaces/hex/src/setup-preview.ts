export function setupPreview(): string {
  return `<figure class="setup-preview" data-testid="setup-preview">
    <svg viewBox="0 0 240 176" role="img" aria-label="蓝方连接右上与左下蓝边，红方连接左上与右下红边">
      <path d="M24 88 120 20 216 88 120 156Z" fill="#f8ead6"/>
      <path d="M24 88 120 20M216 88 120 156" fill="none" stroke="#b94542" stroke-width="8"/>
      <path d="M120 20 216 88M120 156 24 88" fill="none" stroke="#376ea8" stroke-width="8"/>
      <path d="M165 54 75 122" stroke="#376ea8" stroke-width="3" stroke-dasharray="5 4"/>
      <path d="M75 54 165 122" stroke="#b94542" stroke-width="3" stroke-dasharray="5 4"/>
      <text x="158" y="30" fill="#245580">蓝</text><text x="63" y="158" fill="#245580">蓝</text>
      <text x="54" y="30" fill="#943430">红</text><text x="174" y="158" fill="#943430">红</text>
    </svg>
    <figcaption><strong>11×11 · 蓝方先手</strong><p>用相邻的同色棋子连通自己的两条目标边即获胜：蓝方连接右上与左下，红方连接左上与右下。六贯棋不会平局。</p></figcaption>
  </figure>`;
}
