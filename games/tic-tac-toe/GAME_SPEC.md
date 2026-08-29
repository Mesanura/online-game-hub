# Tic-Tac-Toe 规则规范

> 状态：`gameVersion 1.0.0`
> 本文是 Tic-Tac-Toe Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`，按初始化数组顺序解释。
- `players[0]` 使用 X 并先手，`players[1]` 使用 O。
- 棋盘固定为 3×3；cell 使用 row-major 的整数 `0..8`。
- 玩家只能在自己的回合向空 cell 提交 `{ type: "PLACE_MARK", cell }`。
- 任一玩家占据完整横线、竖线或对角线时立即获胜；九格填满且无人获胜时平局。
- 获胜或平局后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝。

## JSON 契约

- Config 为 `null`，V1 没有规则选项。
- State 保存固定顺序的 players、九格 board 和 `nextPlayerIndex`；只存在服务器。
- Action 不含 actor、State、Outcome、revision 或随机结果。
- View 包含 slot/mark 对应关系、board、可行动 slot 与 Outcome；公开棋盘仍只通过 `projectView` 产生。
- Outcome 为 `WIN`（winner slot 与 winning cells）或 `DRAW`。

## 领域拒绝码

- `NOT_A_PLAYER`
- `NOT_YOUR_TURN`
- `CELL_OUT_OF_BOUNDS`
- `CELL_OCCUPIED`
- `MATCH_ALREADY_FINISHED`

Tic-Tac-Toe 不消费 RNG；初始化、accepted transition 和 rejected transition 都原样返回或保留输入 RNG cursor。任何改变规则结果、slot 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
