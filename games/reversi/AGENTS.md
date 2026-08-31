# 黑白棋工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- 棋盘固定为 8×8；两个不同 stable slots 中 `players[0]` 使用 BLACK 并先手，`players[1]` 使用 WHITE。
- Action 只表达 `{ type: "PLACE_DISC", cell }`；不得包含 actor、State、翻转列表、Outcome、revision、PASS 或随机结果。
- 每次落子必须翻转八方向中全部合法夹线。方向边界按 row/column 判断，禁止 row wrap。
- 对方无合法行动而当前玩家仍有合法行动时，由 Core 保持当前行动方；双方都无合法行动时立即终局，不生成伪造 Action。
- 黑白棋不消费 RNG；任何 rejected transition 都不得改变 State 或 RNG。
- 游戏没有隐藏信息，但所有出站内容仍由 `projectView` 生成；Client Module 不得导入 Core、扫描夹线或自行判断跳过与 Outcome。
- 会改变旧 replay 的初始化、翻转、跳过或终局结果的修改必须提升 exact `gameVersion` 并保留旧版 golden fixture。
