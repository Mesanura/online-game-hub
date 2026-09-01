# 井字棋规则规范

> 状态：当前 `gameVersion 1.1.0`；历史 `1.0.0` 继续支持 exact replay
> 展示名：井字棋
> 本文是井字棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`，按初始化数组顺序解释。
- `players[0]` 使用 X 并先手，`players[1]` 使用 O。
- 棋盘固定为 3×3；cell 使用 row-major 的整数 `0..8`。
- 玩家只能在自己的回合向空 cell 提交 `{ type: "PLACE_MARK", cell }`。
- 任一玩家可在比赛活跃时提交 strict `{ type: "RESIGN" }`，不受当前回合限制；对手立即以 `RESIGNATION` 获胜。
- 任一玩家占据完整横线、竖线或对角线时立即获胜；九格填满且无人获胜时平局。
- 连线、平局或投降后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝。

## JSON 契约

- Config 为 `null`，当前版本没有规则选项。
- State 保存固定顺序的 players、九格 board、`nextPlayerIndex` 和可空 `resignedSlotId`；只存在服务器。
- Action 是 strict `PLACE_MARK(cell) | RESIGN`，不含 actor、State、Outcome、revision 或随机结果。
- View 包含 slot/mark 对应关系、board、可行动 slot 与 Outcome；公开棋盘仍只通过 `projectView` 产生。
- Outcome 为普通连线 `WIN`（winner slot 与 winning cells）、`RESIGNATION` `WIN`（winner 与 resigned slot）或 `DRAW`。

## 领域拒绝码

- `NOT_A_PLAYER`
- `NOT_YOUR_TURN`
- `CELL_OUT_OF_BOUNDS`
- `CELL_OCCUPIED`
- `MATCH_ALREADY_FINISHED`

`MATCH_ALREADY_FINISHED` 与 `NOT_A_PLAYER` 在 `RESIGN` 分支前判断；合法玩家的投降不检查 `NOT_YOUR_TURN`。井字棋不消费 RNG；初始化、accepted transition 和 rejected transition 都原样返回或保留输入 RNG cursor。

## 版本兼容

- `1.0.0` 只接受 `PLACE_MARK`，State 不含 `resignedSlotId`；其独立 frozen definition 和原 golden fixture 保留不变。
- `1.1.0` 增加 off-turn `RESIGN`、`state.resignedSlotId` 和 `RESIGNATION` WIN；普通落子、连线与平局规则不变。
- Replay Format 仍为 V1。任何进一步改变规则结果、slot 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
