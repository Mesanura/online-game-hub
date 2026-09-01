# Design QA: remove upper-left outer glow

## Comparison target

- Source visual truth:
  - User-supplied catalog-card screenshot, 447 × 505 pixels (session-local; not committed).
  - User-supplied game-entry screenshot, 376 × 1001 pixels (session-local; not committed).
- Browser-rendered implementation:
  - `artifacts/design-qa/shadow-catalog-focused-447x505.png`
  - `artifacts/design-qa/shadow-entry-376x1001.png`
- Routes: `/games` and `/games/tic-tac-toe`
- State: default catalog and game-entry states
- Targeted change: remove the white outer glow above and to the left of raised components while preserving the inset highlight along their upper-left interior edges. Existing layout and content are not recreation targets.

## Viewport and normalization

- Catalog source and implementation: 447 × 505 pixels; implementation CSS viewport 447 × 505; device pixel ratio approximately 1; compared at native 1:1 density.
- Game-entry source and implementation: 376 × 1001 pixels; implementation CSS viewport 376 × 1001; device pixel ratio approximately 1; compared at native 1:1 density.
- The current responsive game-entry composition differs from the older supplied capture, so the comparison is limited to the explicitly marked shadow treatment on raised surfaces, icons, navigation, and buttons.

## Full-view comparison evidence

- The source captures show a bright white halo extending outside the upper and left edges of the marked surfaces.
- The implementation captures show only the warm lower-right elevation shadow outside each raised surface.
- The upper-left interior highlight remains visible on catalog cards, icons, the return control, action cards, and pill buttons.
- Computed browser styles confirm that raised components have one positive-offset outer shadow plus the two existing inset convex layers; no negative-offset white outer shadow remains.

## Focused-region comparison evidence

- `shadow-catalog-focused-447x505.png` keeps the first card and icon boundaries legible at native density, so a separate enlarged crop was unnecessary.
- The focused catalog comparison confirms a clean upper-left exterior edge and an intact upper-left inset highlight on both the card and its icon.

## Required fidelity surfaces

- Fonts and typography: unchanged; family, sizes, weights, line heights, wrapping, and copy remain the existing implementation.
- Spacing and layout rhythm: unchanged; the only affected elevation layers are the shared raised-surface shadows and the console shell's explicit outer shadow.
- Colors and visual tokens: warm lower-right elevation colors are unchanged; only the negative-offset white outer glow layers were removed.
- Image quality and asset fidelity: no raster, icon, or illustration assets were changed; existing icon-library rendering remains intact.
- Copy and content: unchanged.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested shadow treatment.
- No P3 follow-up is required for this scoped change.

## Interaction and runtime evidence

- The catalog's first “创建或加入房间” path reached `/games/tic-tac-toe` during visual verification.
- The “返回游戏目录” control navigated from `/games/tic-tac-toe` to `/games`, and browser back restored the entry route.
- Browser console errors checked: none.

## Comparison history

1. Initial finding: shared raised-surface tokens and the console shell contained negative horizontal and vertical white shadows, producing the reported upper-left outer glow.
2. Fix: removed those three negative-offset outer layers while leaving `--shadow-convex` unchanged.
3. Post-fix evidence: both browser captures show the upper-left exterior glow removed, and computed styles retain the inset white highlight.

## Implementation checklist

- [x] Remove upper-left outer glow from standard raised surfaces.
- [x] Remove upper-left outer glow from softly lifted icons and controls.
- [x] Remove the console shell's standalone upper-left outer glow.
- [x] Preserve the upper-left inset highlight.
- [x] Verify catalog and game-entry views at the supplied pixel sizes.

final result: passed
