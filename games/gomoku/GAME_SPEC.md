# 五子棋规则规范

## 账户历史结果

以当前账户归档席位与 Outcome 的 winner 比较，显示“胜利”或“失败”；DRAW 显示“平局”，投降按权威 winner 显示胜负。

独立 `/history` 入口覆盖本文全部受支持版本，按 [历史投影契约](../../docs/GAME_PLUGIN_SPEC.md#账户历史结果投影) 校验并投影已保存结算；不改变 Core、规则版本、Surface 或 replay 格式。

> 状态：当前 `gameVersion 1.1.0`；历史 `1.0.0` 继续支持 exact replay
> 展示名：五子棋
> 本文是五子棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`，按初始化数组顺序解释。
- `players[0]` 使用 BLACK 并先手，`players[1]` 使用 WHITE。
- 棋盘由 Config 选择 15×15 或 19×19，默认 15×15；cell 使用 row-major 整数索引 `0..boardSize²-1`。
- 玩家只能在自己的回合向空 cell 提交 `{ type: "PLACE_STONE", cell }`。
- 任一玩家可在比赛活跃时提交 strict `{ type: "RESIGN" }`，不受当前回合限制；对手立即以 `RESIGNATION` 获胜。
- 同一玩家横向、纵向或任一对角线连续占据 5 个或更多 cell 时立即获胜；普通胜局的 Outcome 规范化记录扫描顺序中的首个连续 5-cell 窗口。
- 棋盘填满且无人获胜时平局；连线、平局或投降后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝。
- 当前版本不实现禁手、交换规则、AI、计时或悔棋。

## JSON 契约

- Config 为 strict `{ boardSize: 15 | 19, winLength: 5 }`；manifest 的 `defaultConfig` 固定为 `{ boardSize: 15, winLength: 5 }`。
- State 保存规范化 Config、固定顺序的 players、`boardSize²` 项 board、`nextPlayerIndex` 和可空 `resignedSlotId`；只存在服务器。
- Action 是 strict `PLACE_STONE(cell) | RESIGN`，不含 actor、State、Outcome、revision 或随机结果。
- View 包含 boardSize、固定 winLength、slot/stone 对应关系、board、可行动 slot 与 Outcome；公开棋盘仍只通过 `projectView` 产生。
- Outcome 为普通连线 `WIN`（winner slot 与五个 row-major winning cells）、`RESIGNATION` `WIN`（winner 与 resigned slot）或 `DRAW`。

State、Action、View、Outcome 和 Config 都由 strict Zod schema 验证；board 中的非空 slot 必须属于本局 players。

## 领域拒绝码

- `NOT_A_PLAYER`
- `NOT_YOUR_TURN`
- `CELL_OUT_OF_BOUNDS`
- `CELL_OCCUPIED`
- `MATCH_ALREADY_FINISHED`

`MATCH_ALREADY_FINISHED` 与 `NOT_A_PLAYER` 在 `RESIGN` 分支前判断；合法玩家的投降不检查 `NOT_YOUR_TURN`。五子棋不消费 RNG；初始化、accepted transition 和 rejected transition 都保留输入 RNG cursor。

## Round Setup 与 Surface

- current `1.1.0` 新房间使用游戏自有 Setup V6。Setup 保存规范化 Config，由房主选择 OWNER、NON_OWNER 或服务端 RANDOM 先手，并把最终 `playerOrder[0]` 解释为 BLACK。
- 房主可提交 strict `{ type: "SET_BOARD_SIZE", boardSize: 15 | 19 }`；默认仍为 15，修改只替换棋盘尺寸，保留 `winLength: 5` 与先手选择。同值返回 `SETUP_UNCHANGED`，非房主返回 `NOT_OWNER`。两项拒绝均不改变 revision、ready 或 Setup RNG。
- completed 后的下一局 Setup 从上一局 `FinalizedRoundSetup` 复用完整 Config 与实际 player order；不重新随机棋色，双方仍必须分别重新 ready。任何 accepted 设置变更由平台清空全部 ready。
- 独立 Surface 承载 Setup、Play 和 Replay，按 exact 规则版本解析 View；Play 提交 `PLACE_STONE` 或支持版本的 `RESIGN`，Setup 提交 `SELECT_STARTER` 或 `SET_BOARD_SIZE`。画面和 artifact 说明见 [Surface README](../../game-surfaces/gomoku/README.md)。
- 历史 `1.0.0` 已登记 V6 Setup，复用相同的 15/19 棋盘 Config 与参与者顺序契约。同一 exact-version Surface 渲染 Setup/Play/Replay。Surface 视觉升级不改变 `gameVersion` 或 Replay Format。

## 版本兼容

- `1.0.0` 只接受 `PLACE_STONE`，State 不含 `resignedSlotId`；其独立 frozen definition 和原 golden fixture 保留不变。
- `1.1.0` 增加 off-turn `RESIGN`、`state.resignedSlotId` 和 `RESIGNATION` WIN；Config、连线扫描、长连与平局规则不变。
- Replay Format 仍为 V1。任何进一步改变连线扫描顺序、长连解释、slot/stone 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
