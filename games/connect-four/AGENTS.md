# Connect Four 工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- Core 固定为 7 列 × 6 行、两个不同稳定 slot，`players[0]` 使用 RED 并先手。
- Action 只表达 `DROP_DISC(column)` 意图；不得包含 actor、State、落点 row、随机结果或 Outcome。
- 棋盘使用 row-major 索引，row `0` 在顶部、row `5` 在底部；Core 是唯一计算重力落点和四连结果的位置。
- 终局后不可再改变棋盘；任何 rejected transition 都不得改变 State 或 RNG。
- 游戏没有隐藏信息，但任何出站内容仍必须由 `projectView` 生成。
- 会改变已有 replay 重建结果的规则修改必须提升 exact `gameVersion` 并保留旧版 golden fixture。
