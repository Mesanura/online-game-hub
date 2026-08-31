# 六贯棋工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- 棋盘固定为 11×11；两个不同稳定 slot 中 `players[0]` 使用 BLUE 并先手，`players[1]` 使用 RED。
- BLUE 连接 `row = 0` 与 `row = 10`，RED 连接 `column = 0` 与 `column = 10`；邻接与 canonical BFS 顺序不得隐式改变。
- Action 只表达 `PLACE_STONE(cell)` 或 `RESIGN` 意图；不得包含 actor、State、Outcome、revision 或随机结果。
- `RESIGN` 在活跃比赛中不受回合限制；连接胜局的 `winningPath` 必须来自规范化 BFS，投降胜局没有获胜路径。
- 不实现交换规则、平局、AI、计时或悔棋；任何 rejected transition 都不得改变 State 或 RNG。
- 游戏没有隐藏信息，但任何出站内容仍必须由 `projectView` 生成；客户端不得导入 Core 或重建 authoritative State。
- 会改变已有 replay 重建结果的规则、邻接顺序或路径 tie-break 修改必须提升 exact `gameVersion` 并保留旧版 golden fixture。
