# 四子棋规则规范

> 状态：`gameVersion 1.0.0`
> 展示名：四子棋
> 本文是四子棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`，按初始化数组顺序解释。
- `players[0]` 使用 RED 并先手，`players[1]` 使用 YELLOW。
- 棋盘固定为 7 列 × 6 行；42 个 cell 使用 row-major 整数索引，row `0` 在顶部、row `5` 在底部。
- 玩家只能在自己的回合提交 `{ type: "DROP_DISC", column }`；column 为整数 `0..6`。
- Core 将棋子放入所选列的最低空位；满列拒绝且不改变 State。
- 同一玩家横向、纵向或任一对角线连续占据 4 个 cell 时立即获胜。
- 42 格填满且无人获胜时平局；获胜或平局后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝。

## JSON 契约

- Config 为 `null`，1.0.0 没有棋盘尺寸或连子数变体。
- State 保存固定顺序的 players、42 项 board 和 `nextPlayerIndex`；只存在服务器。
- Action 只包含所选 column，不含 actor、State、落点 row、Outcome、revision 或随机结果。
- View 包含 slot/disc 对应关系、42 项 board、可行动 slot 与 Outcome；公开棋盘仍只通过 `projectView` 产生。
- Outcome 为 `WIN`（winner slot 与四个 row-major winning cells）或 `DRAW`。

State、Action、View 和 Outcome 都由 strict Zod schema 验证；board 中的非空 slot 必须属于本局 players。

## 领域拒绝码

- `NOT_A_PLAYER`
- `NOT_YOUR_TURN`
- `COLUMN_OUT_OF_BOUNDS`
- `COLUMN_FULL`
- `MATCH_ALREADY_FINISHED`

四子棋不消费 RNG；初始化、accepted transition 和 rejected transition 都保留输入 RNG cursor。任何改变重力、扫描顺序、slot/disc 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
