# 四子棋规则规范

> 状态：当前 `gameVersion 1.1.0`；历史 `1.0.0` 继续支持 exact replay
> 展示名：四子棋
> 本文是四子棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`，按初始化数组顺序解释。
- `players[0]` 使用 RED 并先手，`players[1]` 使用 YELLOW。
- 棋盘固定为 7 列 × 6 行；42 个 cell 使用 row-major 整数索引，row `0` 在顶部、row `5` 在底部。
- 玩家只能在自己的回合提交 `{ type: "DROP_DISC", column }`；column 为整数 `0..6`。
- 任一玩家可在比赛活跃时提交 strict `{ type: "RESIGN" }`，不受当前回合限制；对手立即以 `RESIGNATION` 获胜。
- Core 将棋子放入所选列的最低空位；满列拒绝且不改变 State。
- 同一玩家横向、纵向或任一对角线连续占据 4 个 cell 时立即获胜。
- 42 格填满且无人获胜时平局；四连、平局或投降后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝。

## JSON 契约

- Config 为 `null`，当前版本没有棋盘尺寸或连子数变体。
- State 保存固定顺序的 players、42 项 board、`nextPlayerIndex` 和可空 `resignedSlotId`；只存在服务器。
- Action 是 strict `DROP_DISC(column) | RESIGN`，不含 actor、State、落点 row、Outcome、revision 或随机结果。
- View 包含 slot/disc 对应关系、42 项 board、可行动 slot 与 Outcome；公开棋盘仍只通过 `projectView` 产生。
- Outcome 为普通四连 `WIN`（winner slot 与四个 row-major winning cells）、`RESIGNATION` `WIN`（winner 与 resigned slot）或 `DRAW`。

State、Action、View 和 Outcome 都由 strict Zod schema 验证；board 中的非空 slot 必须属于本局 players。

## Round Setup 与表现层

- `connect-four@1.1.0` 新房使用游戏自有 Setup V6。房主必须选择 OWNER、NON_OWNER 或 RANDOM 先手；finalize 后 `playerOrder[0]` 使用 RED，`playerOrder[1]` 使用 YELLOW。
- RANDOM 只消费独立 setup RNG，不改变 gameplay RNG。重新对局从上一局 `FinalizedRoundSetup` 恢复实际顺序并显示为 FIXED；双方仍须分别重新准备，任何 accepted 设置变更都会清空 ready。
- 独立 `connect-four@surfaceVersion 1.0.2` Bridge V2 artifact 同时支持 `1.0.0` 与 `1.1.0` 的 Play/Replay projected View；Setup entrypoint 只由 V6 房间使用。Surface 不导入 Core，也不接触 actor、State、seed、ticket、session 或 canonical replay。

## 领域拒绝码

- `NOT_A_PLAYER`
- `NOT_YOUR_TURN`
- `COLUMN_OUT_OF_BOUNDS`
- `COLUMN_FULL`
- `MATCH_ALREADY_FINISHED`

`MATCH_ALREADY_FINISHED` 与 `NOT_A_PLAYER` 在 `RESIGN` 分支前判断；合法玩家的投降不检查 `NOT_YOUR_TURN`。四子棋不消费 RNG；初始化、accepted transition 和 rejected transition 都保留输入 RNG cursor。

## 版本兼容

- `1.0.0` 只接受 `DROP_DISC`，State 不含 `resignedSlotId`；其独立 frozen definition 和原 golden fixture 保留不变。
- `1.1.0` 增加 off-turn `RESIGN`、`state.resignedSlotId` 和 `RESIGNATION` WIN；重力、扫描、四连与平局规则不变。
- Replay Format 仍为 V1。任何进一步改变重力、扫描顺序、slot/disc 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
