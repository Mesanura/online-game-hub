# 五子棋工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- Core 支持 15×15 与 19×19 棋盘，`winLength` 固定为 5；两个不同稳定 slot 中 `players[0]` 使用 BLACK 并先手。
- 当前 Action 只表达 `PLACE_STONE(cell)` 或 strict `RESIGN` 意图；不得包含 actor、State、Outcome、revision 或随机结果。
- `RESIGN` 在活跃比赛中不受回合限制；`gomoku@1.0.0` definition 必须保持独立冻结且继续拒绝该 Action。
- cell 使用 row-major 索引；Core 是唯一判断回合、占用、连续五子或以上和终局结果的位置。
- 不实现禁手、交换规则、AI、计时或悔棋；任何 rejected transition 都不得改变 State 或 RNG。
- 游戏没有隐藏信息，但任何出站内容仍必须由 `projectView` 生成；客户端不得导入 Core 或重建 authoritative State。
- 会改变已有 replay 重建结果的规则修改必须提升 exact `gameVersion` 并保留旧版 golden fixture。
