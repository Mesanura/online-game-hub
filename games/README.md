# Games

每个 `games/<game-id>` 是独立 workspace package。当前注册：

- `games/tic-tac-toe`：展示名“井字棋”，exact `gameVersion 1.0.0`，3×3 Core、Client Module 与 golden replay；
- `games/connect-four`：展示名“四子棋”，exact `gameVersion 1.0.0`，7×6 重力落子 Core、Client Module 与 golden replay；
- `games/gomoku`：展示名“五子棋”，exact `gameVersion 1.0.0`，15×15/19×19 Config、Core、Client Module 与 golden replay；
- `games/hex`：展示名“六贯棋”，exact `gameVersion 1.0.0`，11×11 连接规则、投降、canonical path、Client Module 与 golden replay。

游戏 package 的结构与公开子路径以 [Game Plugin 规范](../docs/GAME_PLUGIN_SPEC.md) 为准。
