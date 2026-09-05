# Hex Game Surface

独立的六贯棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Hex Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/hex-surface dev`
- `pnpm --filter @online-game-hub/hex-surface test`
- `pnpm --filter @online-game-hub/hex-surface build`
- `pnpm --filter @online-game-hub/hex-surface contract-test`

可通过 Surface Workbench 注入 `hex@1.0.0` 的 Setup/Play/Replay fixture 独立调试。Surface 只呈现服务器投影的 BLUE/RED 角色与 canonical winning path，不自行判断连接或 Outcome。
