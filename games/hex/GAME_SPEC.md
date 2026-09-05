# 六贯棋规则规范

> 状态：`gameVersion 1.0.0`
> 展示名：六贯棋
> 本文是六贯棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`。`players[0]` 使用 BLUE 并先手，`players[1]` 使用 RED。Platform 为每轮传入独立的有序 players；同房间 stable slots 不变，但房主选择相反先手时，哪个 slot 获得 BLUE/RED 可以跨轮交换。这不是六贯棋的交换规则。
- 棋盘固定为 11×11，共 121 个六边形格；cell 使用 row-major 整数索引 `row * 11 + column`。
- 玩家在自己的回合向一个空格提交 `{ type: "PLACE_STONE", cell }`，随后轮到另一方；没有移动、移除、跳过、悔棋或交换规则。
- BLUE 连接 `row = 0`（上右边）与 `row = 10`（下左边）获胜；RED 连接 `column = 0`（上左边）与 `column = 10`（下右边）获胜。
- `(row, column)` 的六个候选邻格按 `(-1,0)`、`(-1,+1)`、`(0,-1)`、`(0,+1)`、`(+1,-1)`、`(+1,0)` 解释；越界候选不构成邻接。
- 玩家可在任一活跃时刻提交 `{ type: "RESIGN" }`，不受当前回合限制；对手立即以 `RESIGNATION` 获胜。客户端必须二次确认，但取消确认不产生 Action。
- Hex 不存在规则平局。连接胜局或投降后所有 Action 以 `MATCH_ALREADY_FINISHED` 拒绝；平台断线、离开和关闭房间继续产生 `abandoned`，不伪造游戏 Outcome。

## Canonical 获胜路径

连接判定使用 multi-source BFS。BLUE 的 source 是 row 0、target 是 row 10；RED 的 source 是 column 0、target 是 column 10。source 按 cell 升序入队，每个格的合法邻格按 cell 升序访问，首次发现的 parent 保留；第一个从队列到达 target 的节点产生从 source 到 target 排列的最短 `winningPath`。改变 source、邻接、访问或 tie-break 顺序会改变 replay 结果，必须评估新 `gameVersion`。

## JSON 契约

- Config 固定为 `null`，manifest 的 `defaultConfig` 也是 `null`。
- State 保存固定顺序的 players、121 项 board、`nextPlayerIndex` 和可空 `resignedSlotId`，只存在服务器。
- Action 是 strict `PLACE_STONE(cell) | RESIGN`，不含 actor、State、Outcome、revision 或随机结果。
- View 包含 BLUE/RED slot 对应关系、完整公开 board、可行动 slot、Outcome 与当前 viewer 的颜色；公开棋盘仍只通过 `projectView` 产生。
- Outcome 始终为 `WIN`：连接胜局记录 `reason: "CONNECTION"`、winner 与 canonical `winningPath`；投降胜局记录 `reason: "RESIGNATION"`、winner 与 resigned slot。

## 领域拒绝码

按顺序判断：`MATCH_ALREADY_FINISHED`、`NOT_A_PLAYER`、不受回合限制的 `RESIGN`、`NOT_YOUR_TURN`、`CELL_OUT_OF_BOUNDS`、`CELL_OCCUPIED`。

六贯棋不消费 RNG；初始化、accepted transition 和 rejected transition 都保留输入 RNG cursor。双方同时连通、连接与投降同时存在，或满盘却没有连接方都视为服务器内部不变量损坏，不转换为平局。

## Setup 与独立 Surface

- current `hex@1.0.0` 使用 Protocol V6 的游戏自有 Setup。首局由房主选择 OWNER、NON_OWNER 或服务端 setup RNG 的 RANDOM；finalized `playerOrder[0]` 获得 BLUE。上一局完成后默认固定复用上一局实际 BLUE/RED 顺序、null Config、参与席位和 null assignments，双方仍需分别重新确认准备。
- `hex@surfaceVersion 1.0.2` 是独立构建的 Bridge V2 Setup/Play/Replay Surface。它只消费按 viewer 投影的 Setup View 或 Hex View，只发送 `SELECT_STARTER` / `PLACE_STONE` intent；平台继续拥有 ready、投降确认、关闭/离开、连接和 replay 生命周期。
- Surface 只显示服务器给出的 `winningPath`，不得导入 Core、重跑 BFS、推断连接胜者或构造 Outcome。Core 与 Replay Format V1 未改变，因此本次表现层迁移不提升 `gameVersion`。
