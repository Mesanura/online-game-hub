# Gomoku Game Surface

独立的五子棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Gomoku Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/gomoku-surface dev`
- `pnpm --filter @online-game-hub/gomoku-surface test`
- `pnpm --filter @online-game-hub/gomoku-surface build`
- `pnpm --filter @online-game-hub/gomoku-surface contract-test`

可通过 Surface Workbench 注入 `gomoku@1.0.0` 或 `1.1.0` 的 Setup/Play/Replay fixture 独立调试。

棋盘使用暖木 Clay 风格和容器自适应尺寸，可落子位显示当前棋色的 hover/focus 预览。Play 只发送 `PLACE_STONE` 或支持版本的 `RESIGN`，Setup 发送 `SELECT_STARTER`。历史 View 与投降能力按 exact 版本区分。

Play/Replay 严格校验 15×15 与 19×19 公开棋盘，以及棋盘、轮次和结果中的玩家引用。

共享开发、Workbench 与 artifact 更新步骤见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。
