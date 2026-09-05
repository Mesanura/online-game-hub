# 中国跳棋规则规范

> 状态：`gameVersion 1.0.0`

## 规则

- 房间支持 2–6 名玩家，每位玩家拥有 6 枚棋子和一个六角营地。
- 棋盘共有 73 个棋位：中心六边形边长为 4（37 位），六个角部三角形边长为 3（每个 6 位）。
- 营地按六角顺序标识为 `N`、`NE`、`SE`、`S`、`SW`、`NW`；目标营地为相隔三个位置的对角营地。
- 玩家可将己方棋子相邻移动一步，或连续跳过相邻占用棋位到达空棋位。跳跃路径由 Core 搜索，Action 只携带起点和终点。
- 棋子可以进入或离开任意营地。填满目标营地后锁定排名并跳过该玩家回合。
- 无合法移动的玩家由 accepted transition 自动跳过，不记录 `PASS`；若所有未完成玩家均无路可走，按逆时针轮序完成剩余排名。
- `RESIGN` 不受回合限制；投降玩家退出回合，并在非投降玩家之后计入排名。
- 首位由房主选择的 OWNER/NON_OWNER/RANDOM 决定，其余玩家按已选营地逆时针排列。

## Round Setup

- 新建 `chinese-checkers@1.0.0` 房间使用 Protocol V6 和游戏自有 Setup；默认目标人数为 2，房主可选择 2–6 人与 `OWNER`、`NON_OWNER`、`RANDOM` 首位规则。
- 每位已占用稳定席位只能选择或清除自己的营地，六个营地全局唯一。只有目标人数与已占用席位数一致、每位参与者都有营地、首位已选择且所有参与者在线并分别 ready 时才能开始。
- `NON_OWNER` 选择按营地逆时针排列后的首位非房主；`RANDOM` 只在房主与该首位非房主之间使用独立 Setup RNG 选择。Gameplay Core 不解释房主或 Setup RNG，只接收最终 `playerOrder` 和 assignments。
- 下一局从上一局 `FinalizedRoundSetup` 恢复目标人数、参与席位、实际首位、完整顺序和营地，首位状态固定为 `FIXED`，不会重新随机。State、Outcome、gameplay seed、revision、ready、Match 与 replay 均重新创建，每位参与者必须再次确认。

## Assignment 元数据

`InitialContext.playerAssignments` 与 `players` 等长，保存每个 slot 的营地。所有营地必须唯一且属于六个固定选项；assignment 会进入 replay header 以便精确重建。

## JSON 形状

- Config 为 `null`。
- Action 为严格 `MOVE_PIECE(from,to) | RESIGN`。
- View 包含公开棋盘、玩家营地、当前行动 slot、合法 `(from,to)` 列表、当前 viewer 营地、排名和 Outcome。
- Outcome 为 `RANKING`，每个 slot 有连续 rank 与 `FINISHED`、`RESIGNATION`、`BLOCKED` 或 `LAST_REMAINING` 原因。

## Surface

`chinese-checkers@surfaceVersion 1.0.2` 以独立 Bridge V2 Setup/Play/Replay artifact 精确支持 `gameVersion 1.0.0`。Play/Replay 以正确轴坐标投影显示中央 37 格和六个 `3+2+1` 营地，棋子颜色只取玩家 assignment，不随所在棋位变化；Surface 只消费投影后的 73 格棋盘、服务器 `legalMoves`、排名和 Outcome，不搜索跳跃路径、不推导排名，也不接触 actor、raw State、seed 或 canonical replay。
