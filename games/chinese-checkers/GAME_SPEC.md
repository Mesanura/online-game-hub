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

## Assignment 元数据

`InitialContext.playerAssignments` 与 `players` 等长，保存每个 slot 的营地。所有营地必须唯一且属于六个固定选项；assignment 会进入 replay header 以便精确重建。

## JSON 形状

- Config 为 `null`。
- Action 为严格 `MOVE_PIECE(from,to) | RESIGN`。
- View 包含公开棋盘、玩家营地、当前行动 slot、合法 `(from,to)` 列表、当前 viewer 营地、排名和 Outcome。
- Outcome 为 `RANKING`，每个 slot 有连续 rank 与 `FINISHED`、`RESIGNATION`、`BLOCKED` 或 `LAST_REMAINING` 原因。
