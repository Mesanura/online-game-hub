# Design QA

## Evidence

- Source visual truth: `C:\Users\Zohar\.codex\generated_images\01a05841-6034-7f22-a884-9477c7c5313f\exec-6adc5a8a-dd8c-4b92-9d72-25ac1d0ffb34.png`
- Source pixels: 1536 × 1024. The source is a four-state board containing two desktop states, one desktop play/completed state, and one 390 × 844 mobile state.
- Desktop implementation captures (CSS viewport 1440 × 900, device pixel ratio 1):
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\implemented-entry-desktop-convex-final.png`
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\implemented-room-waiting-desktop-convex-final.png`
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\implemented-gomoku-active-desktop-final.png`
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\implemented-gomoku-completed-desktop-final.png`
- Mobile implementation capture (CSS viewport and pixels 390 × 844, device pixel ratio 1): `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\implemented-waiting-mobile-convex-final.png`
- Full-view comparison evidence:
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\design-qa-entry-convex-comparison.png`
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\design-qa-waiting-convex-comparison.png`
  - `C:\Users\Zohar\.codex\visualizations\2026\08\31\01a05841-6034-7f22-a884-9477c7c5313f\design-qa-mobile-convex-comparison.png`
- Focused comparison was not needed after the final pass: all named problem surfaces—outer shell, action cards, player cards, setup dock, input groove, and mobile controls—are large and readable in the normalized full-view comparisons.

## State And Interaction Coverage

- Entry, waiting, active, reconnect, completed, next-round setup, and closed-room routing were exercised in the browser flow and PostgreSQL-backed E2E flow.
- Clipboard success and failure fallback, starter selection, ready/cancel-ready, active-room confirmation, and final-board preservation were exercised.
- Desktop entry and waiting pages had `scrollHeight === clientHeight` at 1440 × 900. The 390 × 844 waiting view retained all primary controls without overlap or page-owned horizontal overflow.
- Five-in-a-row used an internally scrollable board surface with 44 × 44 CSS pixel interaction targets on mobile; tic-tac-toe verified the small-board layout.
- Browser console check on the final entry capture reported no warnings or errors.

## Required Fidelity Surfaces

- Fonts and typography: the implementation uses a Chinese system sans stack with heavy display weights and compact UI weights. Heading hierarchy, line height, wrapping, and small status labels remain readable at desktop and mobile sizes. The reference's exact generated font is not an identifiable distributable face; the system stack is an acceptable product constraint.
- Spacing and layout rhythm: desktop uses a persistent left rail and a single raised outer shell; mobile collapses the rail into a compact raised header. Radii, padding, section gaps, and control density preserve the source hierarchy without introducing browser-page scrolling in the tested key states.
- Colors and visual tokens: warm cream, peach, coral, and muted teal map to the selected direction. Convex surfaces now combine a darker lower-right cast shadow, a lighter upper-left ambient shadow, an upper-left inner highlight, and a lower-right inner shade. Recessed shadow tokens are limited to room-code inputs, manual-copy fields, and the starter-selection groove.
- Image quality and asset fidelity: the selected direction does not require photographic or custom raster assets. All functional icons come from Phosphor rather than emoji, text glyphs, handcrafted SVG, or CSS art. Game boards remain the real existing game Client Modules.
- Copy and content: UI copy describes only implemented room, invite, readiness, lifecycle, reconnect, and round behavior. No ecommerce, matchmaking, nickname, spectator, timer, or unsupported rule controls appear.
- Accessibility and responsive behavior: focus-visible outlines, labeled controls, `aria-live` copy status, keyboard operation, reduced-motion handling, non-color status cues, 44-pixel mobile targets, safe-area spacing, and board-contained overflow are present.

## Comparison History

### Iteration 1 — blocked

- [P1] The outer shell and several clay cards read as recessed rather than inflated. The light and dark inset shadows used one ambiguous shared treatment, so the frame edge did not clearly rise above the cream background.
- [P2] The mobile waiting player cards compressed status content horizontally, and the lower waiting notice competed with the dangerous room action.

### Fixes Applied

- Split the material system into `--shadow-convex`, `--shadow-recessed`, and `--shadow-lift-soft`.
- Gave the desktop outer shell a solid warm-cream face, stronger lower-right cast shadow, upper-left ambient highlight, and rounded convex bevel.
- Applied convex elevation consistently to cards, buttons, icons, player pods, board surfaces, and result panels; kept the recessed token only on fields and selection grooves.
- Stacked mobile player cards, tightened vertical rhythm, and separated the dangerous action from the transient waiting notice.

### Iteration 2 — passed

- Post-fix evidence: the three `design-qa-*-convex-comparison.png` files listed above.
- The outer frame, action bays, player pods, and setup dock visibly sit above the background. The room-code field and starter groove remain intentionally carved into their parent surfaces, so the material hierarchy is unambiguous.
- No actionable P0, P1, or P2 fidelity differences remain. The implementation intentionally uses denser product copy and real platform states instead of reproducing the mock's decorative or unavailable controls.

## Follow-up Polish

- [P3] A future art pass could add game-specific illustration assets to the homepage, but no placeholder imagery was added because the selected workflow prioritizes the real game modules and the request forbids decorative non-functional controls.

final result: passed
