# Reversi Game Surface

独立的黑白棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Reversi Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/reversi-surface dev`
- `pnpm --filter @online-game-hub/reversi-surface test`
- `pnpm --filter @online-game-hub/reversi-surface build`
- `pnpm --filter @online-game-hub/reversi-surface contract-test`

可通过 Surface Workbench 注入 `reversi@1.0.0` 或 `1.1.0` 的 Setup/Play/Replay fixture 独立调试。Surface 只呈现服务器投影的 `legalMoves`，不自行计算翻转、跳过或 Outcome。
