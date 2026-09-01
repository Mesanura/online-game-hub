# 六贯棋棋盘设计 QA

## 对比目标

- Source visual truth: `C:\Users\Zohar\AppData\Local\Temp\codex-clipboard-c192c6ab-6237-450a-a595-5d22a5cbfff5.png`
- Implementation screenshot: `C:\Users\Zohar\.codex\visualizations\2026\09\01\01a05cba-aa99-7250-a55d-320c78eb1935\hex-board-qa\implementation-hex-1280x720-text-inset.png`
- Full-view comparison: `C:\Users\Zohar\.codex\visualizations\2026\09\01\01a05cba-aa99-7250-a55d-320c78eb1935\hex-board-qa\reference-and-implementation-1280x720-text-inset.png`
- State: real local two-player Hex match after one BLUE and one RED placement; BLUE to move.
- Viewport: `1280 x 720` CSS px. The browser screenshot is `1280 x 720` px; browser device scale factor was `1.5`, and the comparison normalizes both screenshots to `520` px tall without changing aspect ratios.
- Source image: `878 x 402` px. The side-by-side comparison image is `2060 x 520` px.

## Full-View Evidence

The implementation keeps the reference's horizontal flat-top Hex rhombus, with BLUE boundaries on the lower-left and upper-right edges and RED boundaries on the upper-left and lower-right edges. The colored boundaries follow the exterior hex segments rather than forming straight diagonals. Edge labels sit beyond the bands. The implementation intentionally retains the product's existing clay surface, palette, HUD, and Chinese game copy rather than copying the photograph's paper texture. The two status lines now have a small inline inset so their text no longer sits against the panel's upper-left highlight.

At the `1280 x 720` verification viewport, the board scroll container measured `916 x 509` CSS px and its `scrollWidth`/`scrollHeight` equaled its client size. The board itself measured `774 x 490` CSS px, so the full board is visible without scrolling. A cell measured `44 x 38.10` CSS px and a placed piece measured the same `44 x 38.10` CSS px.

## Focused Region Evidence

The four corners and the first two placed pieces are readable in the implementation screenshot, so no separate crop is needed. They confirm the colored boundary assignment, the label placement beyond each line, and the equal cell/piece silhouette.

## Required Fidelity Surfaces

- Fonts and typography: existing Noto Sans SC/PingFang stack, weights, and small-label hierarchy remain consistent with the product; exterior labels retain sufficient contrast against the clay board.
- Spacing and layout rhythm: desktop board padding, board status spacing, and panel padding are reduced; the full board fits the common `1280 x 720` desktop viewport without a board-container scrollbar.
- Colors and visual tokens: BLUE uses the existing teal token and RED uses the existing coral token; bands are visually heavier than internal grid outlines and retain their semantic distinction.
- Image quality and asset fidelity: the target contains a photographed reference board rather than a required product asset. The implementation uses the existing functional board UI and does not substitute any logo, illustration, or non-standard icon.
- Copy and content: live Chinese player, turn, room, and coordinate text remain intact; coordinates are now oriented `A-K` / `1-11` for the rotated board.

## Findings

No actionable P0, P1, or P2 findings.

- [P3] The reference's physical-board gray grid and the product's warm clay grid are intentionally different visual materials. This is consistent with the existing application design system and does not affect the requested geometry or edge semantics.

## Comparison History

1. Initial implementation comparison found the board was visually correct at large desktop sizes but could require container scrolling at shorter desktop heights. The board cell sizing, board padding, status spacing, and Hex panel padding were reduced.
2. Follow-up review found the upper-left status text too close to the panel highlight. A small `padding-inline-start` was added to both Hex status paragraphs without changing their vertical rhythm.
3. Post-fix evidence is the `1280 x 720` screenshot and the measurements above: both scroll axes fit without overflow, the status text starts 5.76px inside its paragraph box, and the piece remains equal in size to its cell.

## Implementation Checklist

1. Horizontal flat-top 11 x 11 layout implemented.
2. BLUE and RED exterior bands mapped to the requested opposing sides.
3. Exterior coordinates positioned outside the colored bands.
4. Regular-hex proportions and equal-size pieces verified.
5. Desktop compactness verified at `1280 x 720`.

final result: passed
