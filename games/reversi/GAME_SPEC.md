# 黑白棋规则规范

> 状态：当前 `gameVersion 1.1.0`；历史 `1.0.0` 继续支持 exact replay
> 展示名：黑白棋
> 本文是黑白棋 Core 规则与 JSON 数据形状的权威来源；通用契约见 [Game Plugin 规范](../../docs/GAME_PLUGIN_SPEC.md)。

## 规则

- 比赛恰好包含两个不同的稳定 `PlayerSlotId`。`players[0]` 使用 BLACK 并先手，`players[1]` 使用 WHITE。Platform 为每轮传入独立的有序 players；同房间 stable slots 不变，但房主选择相反先手时，哪个 slot 获得 BLACK/WHITE 可以跨轮交换，不改变黑白棋规则。
- 棋盘固定为 8×8，cell 使用 row-major `row * 8 + column`，范围为 `0..63`。
- 初始 D4/E5 为 WHITE（27、36），E4/D5 为 BLACK（28、35）。
- 玩家只在自己的回合向空格提交 `{ type: "PLACE_DISC", cell }`。该落子必须在八个方向至少一个方向上夹住一段连续的对方棋子，并同时翻转所有合法夹线。
- 任一玩家可在比赛活跃时提交 strict `{ type: "RESIGN" }`，不受当前回合限制；对手立即以 `RESIGNATION` 获胜。
- 八方向按 row/column 邻接解释；越界候选终止该方向，首尾行不会相连。
- 落子后若对方有合法行动则换手；若对方没有、当前玩家仍有合法行动，则当前玩家继续行动；若双方都没有合法行动则立即终局。强制跳过是一次 accepted transition 内的规则推进，不是 Action。
- 棋盘填满同样终局。终局按 BLACK/WHITE 棋子数量产生 `WIN` 或 `DRAW`；投降或棋盘终局后所有 Action 均被拒绝。

## JSON 契约

- Config 与 manifest `defaultConfig` 固定为 `null`。
- State 只在服务器保存固定 slots、64 项 board、`nextPlayerIndex` 和可空 `resignedSlotId`。
- Action 是 strict `PLACE_DISC(cell) | RESIGN`，不含 actor、State、翻转列表、Outcome、revision、PASS 或随机结果。
- View 包含 BLACK/WHITE slot 对应关系、完整公开 board、服务器计算的 `legalMoves`、当前行动 slot、棋子数、Outcome 与 viewer 颜色；公开棋盘仍只通过 `projectView` 产生。
- 普通 `WIN` Outcome 保存 winner stable slot 与最终棋子数；`RESIGNATION` `WIN` 保存 winner 与 resigned stable slot；`DRAW` 保存相等的最终棋子数。

## 领域拒绝码

按顺序判断：`MATCH_ALREADY_FINISHED`、`NOT_A_PLAYER`；`RESIGN` 在这两项之后立即接受，落子再判断 `NOT_YOUR_TURN`、`CELL_OUT_OF_BOUNDS`、`CELL_OCCUPIED`、`NO_DISC_CAPTURED`。

黑白棋不使用 RNG；初始化、accepted transition 和 rejected transition 都保持 cursor 为 `0`。Canonical replay 只记录规范化且 accepted 的 `PLACE_DISC | RESIGN`；自动跳过不增加平台 revision，也不产生伪造 `PASS` replay Action。

## Round Setup 与 Surface

- current `1.1.0` 新房间使用游戏自有 Setup V6。房主选择 OWNER、NON_OWNER 或服务端 RANDOM 先手，最终 `playerOrder[0]` 直接成为 BLACK；Setup 不自行解释落子、翻转或跳过。
- completed 后的下一局 Setup 从上一局 `FinalizedRoundSetup` 复用实际 player order，因此默认保留 BLACK/WHITE；双方必须分别重新 ready，accepted 设置变更由平台清空全部 ready。
- 独立 `reversi@surfaceVersion 1.0.0` artifact 承载 Setup、Play 与 Replay，并同时解析历史 `1.0.0` 和 current `1.1.0` projected View。Surface 只启用服务器给出的 `legalMoves`，提交最小 `PLACE_DISC` intent，不自行扫描夹线或计算 Outcome。
- 历史 `1.0.0` live room 仍使用 Protocol V5 Setup；同一 exact-version Surface 可渲染其 Play/Replay。Surface 视觉升级不改变 `gameVersion` 或 Replay Format。

## 版本兼容

- `1.0.0` 只接受 `PLACE_DISC`，State 不含 `resignedSlotId`；其独立 frozen definition 和原 golden fixture 保留不变。
- `1.1.0` 增加 off-turn `RESIGN`、`state.resignedSlotId` 和 `RESIGNATION` WIN；普通落子、翻转、跳过与棋子计分规则不变。
- Replay Format 仍为 V1。任何进一步改变规则结果、slot 解释、Action/Config schema 或 RNG 消费的修改都必须评估新的 `gameVersion`。
