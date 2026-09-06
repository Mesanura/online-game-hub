# 中国跳棋规则规范

> 状态：current `gameVersion 1.1.0`；保留 frozen `1.0.0` 历史规则

## 规则

- 房间支持 2–6 名玩家，每位玩家拥有 6 枚棋子和一个六角营地。
- 棋盘共有 73 个棋位：中心六边形边长为 4（37 位），六个角部三角形边长为 3（每个 6 位）。
- 营地按六角顺序标识为 `N`、`NE`、`SE`、`S`、`SW`、`NW`；目标营地为相隔三个位置的对角营地。
- 玩家可将己方棋子相邻移动一步，或连续跳过相邻占用棋位到达空棋位。跳跃路径由 Core 搜索，Action 只携带起点和终点。
- 棋子可以进入或离开任意营地。填满目标营地后锁定排名并跳过该玩家回合。
- 无合法移动的玩家由 accepted transition 自动跳过，不记录 `PASS`；若所有未完成玩家均无路可走，按逆时针轮序完成剩余排名。
- `RESIGN` 不受回合限制；投降玩家退出回合，并在非投降玩家之后计入排名。
- 首位由房主选择的 OWNER/NON_OWNER/RANDOM 决定，其余玩家按已选营地逆时针排列。

## 棋盘几何与版本

`1.1.0` 棋位编号按下图逐行、从左到右从 0 开始排列。每行棋位数固定为 `1,2,3,10,9,8,7,8,9,10,3,2,1`，不能用旋转或拉伸旧棋盘代替。

```text
         o
        o o
       o o o
o o o o o o o o o o
 o o o o o o o o o
  o o o o o o o o
   o o o o o o o
  o o o o o o o o
 o o o o o o o o o
o o o o o o o o o o
       o o o
        o o
         o
```

- Core 统一拥有轴坐标 `(q,r)` 与营地映射，中心满足 `max(|q|,|r|,|q+r|) <= 3`；六个营地均为填满的边长 3 正三角形。
- 平面投影为 `x = q + r/2`、`y = sqrt(3)*r/2`。六个邻接方向等距，共 180 条无向连线，每个营地与中心有 6 条连接。
- `projectView` 输出与 `board[cell]` 同序的只读 `geometry[cell] = { q, r, camp }`。Surface 仅从这份公开投影生成棋位、连线与区域底色，不维护另一套新版棋盘生成器。
- 旧 `1.0.0` 的编号、营地及 162 条连线拓扑与本版不同；相同起终点会产生不同移动结果，因此提升 `gameVersion`，而非仅修改 CSS。独立 frozen Core、类型、几何和兼容 Client 保留旧行为，旧 replay fixture 不改写。
- 新房间选择 `1.1.0`，已有房间与历史回放仍按 exact version 解析。Action、Setup V6、Bridge V2、Protocol envelope 与 Replay Format V1 不变；不把旧 replay 重新标为新版本。

## Round Setup

- 新建 `chinese-checkers@1.1.0` 房间使用 Protocol V6 和游戏自有 Setup；历史 `1.0.0` 的 V6 部署继续支持。默认目标人数为 2，房主可选择 2–6 人与 `OWNER`、`NON_OWNER`、`RANDOM` 首位规则。
- 每位已占用稳定席位只能选择或清除自己的营地，六个营地全局唯一。只有目标人数与已占用席位数一致、每位参与者都有营地、首位已选择且所有参与者在线并分别 ready 时才能开始。
- `NON_OWNER` 选择按营地逆时针排列后的首位非房主；`RANDOM` 只在房主与该首位非房主之间使用独立 Setup RNG 选择。Gameplay Core 不解释房主或 Setup RNG，只接收最终 `playerOrder` 和 assignments。
- 下一局从上一局 `FinalizedRoundSetup` 恢复目标人数、参与席位、实际首位、完整顺序和营地，首位状态固定为 `FIXED`，不会重新随机。State、Outcome、gameplay seed、revision、ready、Match 与 replay 均重新创建，每位参与者必须再次确认。

## Assignment 元数据

`InitialContext.playerAssignments` 与 `players` 等长，保存每个 slot 的营地。所有营地必须唯一且属于六个固定选项；assignment 会进入 replay header 以便精确重建。

## JSON 形状

- Config 为 `null`。
- Action 为严格 `MOVE_PIECE(from,to) | RESIGN`。
- View 包含公开棋盘、逐格 geometry、玩家营地、当前行动 slot、合法 `(from,to)` 列表、当前 viewer 营地、排名和 Outcome；历史 `1.0.0` View 没有 geometry 字段。
- Outcome 为 `RANKING`，每个 slot 有连续 rank 与 `FINISHED`、`RESIGNATION`、`BLOCKED` 或 `LAST_REMAINING` 原因。

## Surface

`chinese-checkers@surfaceVersion 1.1.0` 以独立 Bridge V2 Setup/Play/Replay artifact 精确支持 `gameVersion 1.0.0` 与 `1.1.0`。新版 Play/Replay 使用服务器逐格 geometry 绘制 73 格、180 条等距连线和七个区域底色；旧版使用冻结的旧编号坐标表，不能回退到新版几何。两种 View schema 严格分派并互相拒绝，缺少新版 geometry 时 fail closed。

棋子颜色只取玩家 assignment，不随所在棋位变化。Surface 只消费服务器 `legalMoves`、排名和 Outcome，不搜索跳跃路径、不推导排名，也不接触 actor、raw State、seed 或 canonical replay。棋盘在桌面保持等比例适配；触屏棋位至少 44px，超出视口时只在棋盘容器内滚动，所有六个角都必须可达。
