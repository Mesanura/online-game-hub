# Gomoku Game Surface

独立的五子棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Gomoku Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/gomoku-surface dev`
- `pnpm --filter @online-game-hub/gomoku-surface test`
- `pnpm --filter @online-game-hub/gomoku-surface build`
- `pnpm --filter @online-game-hub/gomoku-surface contract-test`

可通过 Surface Workbench 注入 `gomoku@1.0.0` 或 `1.1.0` 的 Setup/Play/Replay fixture 独立调试。
