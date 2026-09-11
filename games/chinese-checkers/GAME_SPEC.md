# 中国跳棋规则规范

## 账户历史结果

使用 Outcome 中当前席位的最终 rank，显示“第 N 名”；保留完成、投降、阻塞和最后剩余玩家的权威排名，不重新排序。

独立 `/history` 入口覆盖本文全部受支持版本，按 [历史投影契约](../../docs/GAME_PLUGIN_SPEC.md#账户历史结果投影) 校验并投影已保存结算；不改变 Core、规则版本、Surface 或 replay 格式。

> 状态：current `gameVersion 1.1.0`；保留 frozen `1.0.0` 历史规则

## 规则

- 房间支持 2–6 名玩家，每位玩家拥有 6 枚棋子和一个六角营地。
- 棋盘共有 73 个棋位：中心六边形边长为 4（37 位），六个角部三角形边长为 3（每个 6 位）。
- 营地从北开始顺时针编号为 1–6 号，依次显示为“北营地（1号）”“东北营地（2号）”“东南营地（3号）”“南营地（4号）”“西南营地（5号）”“西北营地（6号）”，内部标识仍为 `N`、`NE`、`SE`、`S`、`SW`、`NW`；目标营地为相隔三个位置的对角营地。编号不改变逆时针轮序。
- 玩家可将己方棋子相邻移动一步，或连续跳过相邻占用棋位到达空棋位。跳跃路径由 Core 搜索，Action 只携带起点和终点。
- 棋子可以进入或离开任意营地。填满目标营地后锁定排名并跳过该玩家回合。
- 无合法移动的玩家由 accepted transition 自动跳过，不记录 `PASS`；若所有未完成玩家均无路可走，按逆时针轮序完成剩余排名。
- `RESIGN` 不受回合限制；投降玩家退出回合，并在非投降玩家之后计入排名。
- 首位由房主选择“指定首位”或“随机首位”决定，其余玩家按已选营地逆时针排列。

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
- 旧 `1.0.0` 的编号、营地及 162 条连线拓扑与本版不同；相同起终点会产生不同移动结果，因此提升 `gameVersion`，而非仅修改 CSS。独立 frozen Core、类型、几何与 Surface 的 exact 版本解析保留旧行为，旧 replay fixture 不改写。
- 新房间选择 `1.1.0`，已有房间与历史回放仍按 exact version 解析。Action、Setup V6、Bridge V2、Protocol envelope 与 Replay Format V1 不变；不把旧 replay 重新标为新版本。

## Round Setup

- 新建 `chinese-checkers@1.1.0` 房间使用 Protocol V6 和游戏自有 Setup；历史 `1.0.0` 的 V6 部署继续支持。默认目标人数为 2，房主可选择 2–6 人，首位 UI 只提供“指定首位”和“随机首位”。
- “指定首位”提供按 1–6 号排列的营地下拉框；`SELECT_STARTER_CAMP(camp)` 把 Setup 设为 `CAMP` 并保存 `starterCamp`。允许在玩家加入或选择营地前预选，但指定营地必须由本局参与者占用才能开局；玩家改变营地不会把指定首位转移到别的营地。
- 每位已占用稳定席位只能选择或清除自己的营地，六个营地全局唯一。只有目标人数与已占用席位数一致、每位参与者都有营地、首位有效且所有参与者在线并分别 ready 时才能开始。改变首位清空全部 ready；重复指定相同营地不改变设置或 ready。非房主不能修改首位模式或首位营地。
- `RANDOM` 使用独立 Setup RNG，在全部实际参赛营地中等概率选择首位，而非仅在房主与一名非房主之间选择。Gameplay Core 不解释房主或 Setup RNG，只接收最终 `playerOrder` 和 assignments。
- 下一局从上一局 `FinalizedRoundSetup` 恢复目标人数、参与席位、实际首位、完整顺序和营地，首位状态固定为 `FIXED`，不会重新随机。State、Outcome、gameplay seed、revision、ready、Match 与 replay 均重新创建，每位参与者必须再次确认。
- 既有 Setup State 缺少 `starterCamp` 时规范化为 `null`；`OWNER`、`NON_OWNER` 与 `FIXED` 仍可读取，并由服务端投影对应的首位营地，不再作为独立 UI 选项。此变更只调整开局前设置与表现，最终 config/order/assignments 仍写入原 replay header，不改变 Gameplay Core、历史回放、`gameVersion`、Protocol V6、Bridge V2 或 Replay Format V1。

## Assignment 元数据

`InitialContext.playerAssignments` 与 `players` 等长，保存每个 slot 的营地。所有营地必须唯一且属于六个固定选项；assignment 会进入 replay header 以便精确重建。

## JSON 形状

- Config 为 `null`。
- Action 为严格 `MOVE_PIECE(from,to) | RESIGN`。
- View 包含公开棋盘、逐格 geometry、玩家营地、当前行动 slot、合法 `(from,to)` 列表、当前 viewer 营地、排名和 Outcome；历史 `1.0.0` View 没有 geometry 字段。
- Outcome 为 `RANKING`，每个 slot 有连续 rank 与 `FINISHED`、`RESIGNATION`、`BLOCKED` 或 `LAST_REMAINING` 原因。

## Surface

`chinese-checkers@surfaceVersion 1.1.1` 以独立 Bridge V2 Setup/Play/Replay artifact 精确支持 `gameVersion 1.0.0` 与 `1.1.0`。Setup 提供指定营地与随机首位，所有画面的营地名称统一显示顺时针编号。新版 Play/Replay 使用服务器逐格 geometry 绘制 73 格、180 条等距连线和七个区域底色；旧版使用冻结的旧编号坐标表，不能回退到新版几何。两种 View schema 严格分派并互相拒绝，缺少新版 geometry 时 fail closed。

棋子颜色只取玩家 assignment，不随所在棋位变化。Surface 只消费服务器 `legalMoves`、排名和 Outcome，不搜索跳跃路径、不推导排名，也不接触 actor、raw State、seed 或 canonical replay。棋盘在桌面保持等比例适配；触屏棋位至少 44px，超出视口时只在棋盘容器内滚动，所有六个角都必须可达。
