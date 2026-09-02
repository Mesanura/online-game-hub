# 中国跳棋工作规则

修改本游戏前先阅读 [GAME_SPEC.md](./GAME_SPEC.md)，并继续遵守仓库根 `AGENTS.md` 与权威架构文档。

- 棋盘固定 73 个棋位：中心边长 4 的六边形和六个边长 3 的六子营地。
- 每轮 2–6 名玩家各占一个唯一营地，目标为其对角营地。
- Action 只表达 `MOVE_PIECE(from,to)` 或 `RESIGN` 意图，不包含 actor、State、Outcome、revision 或路径。
- Core 必须确定性、纯函数、JSON-safe；移动合法性和排名由服务器裁定。
- 营地 assignment 通过 InitialContext 元数据传入并写入 canonical replay；客户端只使用 View。
