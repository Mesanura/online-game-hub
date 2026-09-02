# Games

每个 `games/<game-id>` 是独立 workspace package。当前注册：

- `games/tic-tac-toe`：展示名“井字棋”，current exact `gameVersion 1.1.0`（投降），并保留 frozen `1.0.0` Core 与原 golden replay；
- `games/connect-four`：展示名“四子棋”，current exact `gameVersion 1.1.0`（重力落子与投降），并保留 frozen `1.0.0` Core 与原 golden replay；
- `games/gomoku`：展示名“五子棋”，current exact `gameVersion 1.1.0`（15×15/19×19 Config 与投降），并保留 frozen `1.0.0` Core 与原 golden replay；
- `games/hex`：展示名“六贯棋”，exact `gameVersion 1.0.0`，11×11 连接规则、投降、canonical path、Client Module 与 golden replay；
- `games/reversi`：展示名“黑白棋”，current exact `gameVersion 1.1.0`（8×8 翻转/跳过与投降），并保留 frozen `1.0.0` Core 与原 golden replay。
- `games/chinese-checkers`：展示名“中国跳棋”，exact `gameVersion 1.0.0`，73 位六芒星棋盘、2–6 人六子营地分配、排名、投降与 golden replay；

五款双人 current Client Module 与中国跳棋 Client Module 都向共用 HUD 暴露可选 `createResignAction`；投降确认属于平台 UX，off-turn 合法性、胜负/排名 Outcome 与 canonical replay 仍由 exact Game Core 裁定。

游戏 package 的结构与公开子路径以 [Game Plugin 规范](../docs/GAME_PLUGIN_SPEC.md) 为准。

从 workspace root 运行 `pnpm create-game --game-id <id>` 只会创建 package/config/export 骨架并完成显式 registry、Next transpile 和 pnpm lockfile 登记；它不生成规则、样式或测试语义，也不代表新游戏达到 Plugin Definition of Done。完整边界和人工后续清单见 [Tools](../tools/README.md)。
