# 井字棋工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- Core 固定为 3×3、两个不同稳定 slot，`players[0]` 使用 X 并先手。
- 当前 Action 只表达 `PLACE_MARK(cell)` 或 strict `RESIGN` 意图；不得包含 actor、State、随机结果或 Outcome。
- `RESIGN` 在活跃比赛中不受回合限制；`tic-tac-toe@1.0.0` definition 必须保持独立冻结且继续拒绝该 Action。
- 终局后不可再改变棋盘；任何 rejected transition 都不得改变 State 或 RNG。
- 游戏没有隐藏信息，但任何出站内容仍必须由 `projectView` 生成。
- 会改变已有 replay 重建结果的规则修改必须提升 exact `gameVersion` 并保留旧版 golden fixture。
