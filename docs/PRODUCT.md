# 产品目标与范围

> 状态：产品基线（M1–M6 已完成，当前使用 Protocol V3）
> 本文是产品目标、范围和非目标的权威来源。技术实现边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. 产品愿景

本项目是一个多人在线网页小游戏平台。用户从统一主页发现游戏，通过房间码或邀请链接与他人实时对战；长期可扩展至账号、比赛历史、排行榜、观战、断线重连和更多游戏类型。

平台参考“多个经典桌游与小游戏汇集在同一产品”的产品形态，但不复制任天堂《世界游戏大全 51》或其他产品的名称、界面、美术、音乐、图标、文案及其他受保护素材。游戏规则可以基于公共领域或合法授权内容，产品表达必须原创或具备明确授权。

## 2. 产品原则

1. **统一入口**：所有游戏通过同一网站发现、创建房间和加入对局。
2. **平台能力复用**：房间、连接、玩家席位、重连、比赛生命周期和 replay 不在每个游戏中重复实现。
3. **游戏独立演进**：一个 Agent 应能以单个游戏目录为主要上下文完成规则或表现层修改。
4. **公平且可复现**：客户端只提交意图，服务器裁定结果；一场比赛可由版本、配置、seed 和 accepted actions 重建。
5. **先验证架构**：井字棋打通最小纵向链路，四子棋、五子棋、额外六贯棋与黑白棋已依次验证不同规则类型的扩展成本。

## 3. 目标用户流程

### 3.1 发现与开始游戏

1. 用户打开统一主页并查看已上线游戏。
2. 用户进入某个游戏详情或房间入口。
3. 用户创建私人房间，获得房间码和邀请链接。
4. 房主为下一局选择“我方先手”、“对方先手”或“随机先手”；该选择可以在另一位用户加入前完成。
5. 另一位用户通过房间码或邀请链接加入。
6. 双方都在线并准备后，平台按房主选择创建新一局并开始比赛。

每款游戏使用三个可刷新、可深链接的页面阶段：`/games/{gameId}` 只负责创建或加入；`/games/{gameId}/rooms/{roomCode}` 负责 stable slots、先手和 ready/cancel；`/games/{gameId}/rooms/{roomCode}/play` 负责 active/completed 对局。旧 `?roomCode=` 邀请入口必须兼容并规范化到房间路由。页面阶段只根据服务器 `room.lifecycle` 导航，客户端本地路由状态不能创建 Round、伪造身份或覆盖服务器 State/Outcome。

### 3.2 在线对局

1. 客户端显示当前用户可见的权威游戏视图。
2. 当前玩家提交一个游戏 Action。
3. 服务器接受或拒绝该 Action，并同步新的权威视图。
4. 比赛结束后平台产生结构化 Outcome 和 canonical replay。
5. 一局结束后，任一在线原玩家可立即以本局相同先手顺序重开；也可回到统一的下一局设置，由房主重新选择先手方，两名原玩家分别准备或取消；双方都准备且仍在线时，在同一房间和 stable slots 下开始下一局。
6. 每轮都是独立的 Match、canonical replay 和私有 history 记录，不把多轮合并成一场比赛。
7. 五款游戏都可从共用 HUD 发起投降；取消确认不产生 Action，确认后由服务器 exact rules 判定并让对手以 `RESIGNATION` 获胜。
8. 房主可以关闭房间，非房主可以主动离开；终止 active 对局前界面必须要求确认。

等待页以复制按钮提供不含身份凭据的邀请 URL，不长期暴露原始 URL；复制需要 loading/success/failure 与可手动选择的后备。实际对局在桌面优先保持浏览器页面本身不滚动；左侧 HUD 底部始终显示房间码、共用投降入口，以及按房主身份选择的关闭或离开操作。投降与终止 active 对局分别确认；投降按钮只生成游戏 Action，不取代服务器合法性判断。大型棋盘只允许在自己的容器中缩放或滚动，并在移动端保留至少 44px 的有效操作目标。

### 3.3 断线恢复

1. 临时网络中断或页面刷新不会立即释放玩家席位。
2. 同一匿名 session 在默认 60 秒宽限期内可重新连接。
3. 重连后客户端收到完整的当前视图，而不是依赖本地状态猜测恢复。
4. 超过宽限期后，由平台比赛生命周期策略终止当前比赛并关闭 live room。

详细通信语义见 [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md)。

## 4. 首个纵向切片

井字棋是架构验证游戏，不以内容丰富度为目标。首个可运行切片必须验证：

- 统一游戏目录可以发现井字棋；
- 匿名访客 session 和短期 Game Server 连接票据；
- 创建房间、房间码/邀请链接加入及两个玩家席位；
- 浏览器直接连接独立的 Colyseus Game Server；
- server-authoritative 的回合、合法落子、胜负和平局判断；
- 完整的按玩家 View snapshot 同步；
- 60 秒席位保留和重连后的完整同步；
- canonical replay 记录、确定性重建和自动化验证；
- 首局及后续局统一选择先手、ready/cancel，同一 live room 多轮、房主关闭、非房主离开和有界回收；
- 每轮独立 PostgreSQL Match/Replay archive，以及当前 guest 私有的最小 history metadata。

当前生产 composition 使用内存 live `RoomStore` 和 PostgreSQL `ReplayStore`/`MatchArchive`。创建房间只产生 room code、Config 与 stable slots；首局尚未开始的房间没有 Core State、Replay 或 Match，也不进入历史。已开始/完成轮次可持久化读取，但进程重启仍不会恢复 live room、socket、timer 或 authoritative State；启动协调只会把旧 schema 中遗留的 `waiting` 和当前 `active` archive 诚实标记为 `abandoned`。

井字棋 current `1.1.0` 在原 3×3 落子规则上增加 strict off-turn `RESIGN` 与 `RESIGNATION` WIN；独立 frozen `1.0.0` 只接受 `PLACE_MARK` 并继续读取原 replay。

### 4.1 第二游戏扩展验证

四子棋 current `1.1.0` 从同一目录和通用游戏页提供标准 7 列 × 6 行、两人轮流重力落子、横/纵/双对角四连胜、满盘平局与 strict off-turn `RESIGN`。它复用与井字棋相同的 create/join/reconnect、逐局先手选择、stable slots、多轮 ready/cancel、close/leave、canonical replay、PostgreSQL archive 和私有 history 行为；浏览器只提交 column 或投降 intent，服务端决定落点和 Outcome。frozen `1.0.0` 继续只接受落子并读取原 replay。

该阶段没有新增平台产品能力，不包含 AI、计时、悔棋、公开房间、Matchmaking、观战或公开 replay。

### 4.2 第三游戏与 Config 扩展验证

五子棋 current `1.1.0` 从同一目录和通用游戏页提供默认 15×15 棋盘，并由 strict Config 支持 19×19；`winLength` 固定为 5，连续五子或以上获胜。两名玩家按本轮 `playerOrder` 轮流在 row-major cell 落子；房间内 stable slot 不变，但房主可逐局指定自己或对方获得标准先手角色。浏览器只提交 `PLACE_STONE(cell) | RESIGN` intent，服务端决定回合、占用、长连、平局与 Outcome；frozen `1.0.0` 继续只接受落子并读取原 replay。

五子棋复用既有 create/join/reconnect、多轮、close/leave、per-viewer `projectView`、canonical replay、PostgreSQL archive/history 和真实双浏览器链路。通用 Web 从 manifest 的 JSON-safe `defaultConfig` 创建默认房间，不在平台代码中加入五子棋规则分支。该阶段不包含 AI、禁手、交换规则、计时、悔棋、观战、公开 replay 或 Matchmaking。

### 4.3 额外游戏：六贯棋

六贯棋 1.0.0 作为用户确认的额外游戏提供固定 11×11 菱形六边格棋盘。本轮 `players[0]` 为蓝方并先手、连接上右/下左两边，`players[1]` 为红方并连接上左/下右两边；房主选择谁先手，就由谁在该局获得蓝方，不改变 stable slot 或规则，也不启用交换规则。玩家每回合只提交 `PLACE_STONE(cell)`，也可在任一活跃时刻提交不受回合限制的 `RESIGN`，由 Core 产生连接或投降 WIN Outcome；不存在 DRAW。

连接 Outcome 使用确定性的 multi-source BFS 保存 canonical 最短 `winningPath`，客户端只按服务器 View 对该路径显示白色模糊发光边框。六贯棋通过 Client Module Action factory 接入共用 HUD 的二次确认投降，取消不产生 Action；断线、关闭、主动离开和 reconnect timeout 仍由平台 lifecycle 产生 `abandoned`。六贯棋复用既有双人房间、stable slots、多轮、reconnect、Replay V1、PostgreSQL archive/history 和通用 Web 页面，不新增观战连接、交换、AI、计时、悔棋或公开 replay；其 Core 与 `gameVersion 1.0.0` 保持不变。

### 4.4 黑白棋与 M6 收尾

黑白棋 current `1.1.0` 提供固定 8×8 标准双人规则。本轮 `players[0]` 对应 BLACK 并先手、`players[1]` 对应 WHITE；房主选择谁先手，就由谁在该局获得 BLACK，不改变 stable slot 或黑白棋规则。初始四子固定，玩家提交 `PLACE_DISC(cell) | RESIGN` intent。服务器在全部八方向计算夹线并同时翻转；若下一方没有合法行动则由 Core 自动保持当前行动方，双方均无合法行动时即使棋盘未满也立即按棋子数产生 WIN/DRAW。投降不受回合限制；frozen `1.0.0` 继续只接受落子并读取原 replay。

Web View 明确提供合法落点、当前行动 slot、BLACK/WHITE 棋子数和 Outcome；客户端不扫描夹线、不判断跳过或终局。强制跳过不是 PASS Action，不增加额外 revision，也不进入 canonical replay。黑白棋复用既有双人房间、多轮、stable slots、projection、Replay V1、PostgreSQL archive/history 和通用 Web 页面，M6 因此完成。

## 5. 长期产品能力

以下能力在架构上不得被阻碍，但不要求在首个纵向切片实现：

- 持久用户账号与跨设备身份；
- 完整账号下的跨设备比赛历史、replay 浏览和回放 UI；
- Rating、排行榜和赛季；
- Friendship、邀请与社交能力；
- 观战、观众延迟和隐私策略；
- Matchmaking；
- durable active room/checkpoint 与跨实例 ownership；
- 多实例、跨区域或容灾部署；
- 卡牌、骰子、隐藏信息和更多玩家数量的游戏；
- 使用 Phaser 的实时 2D 游戏。

实时 2D 游戏将使用与离散 Action 游戏不同的 runtime contract，但继续复用平台身份、房间、目录和比赛生命周期等能力。

## 6. 当前明确非目标

M6 完成后当前仍不实现：

- 完整 Lobby 或公开房间浏览；
- 正式用户注册、登录、密码和第三方 OAuth；
- 公开比赛列表、完整历史产品、公开 replay 或排行榜；
- 自动 Matchmaking；
- 观战功能；
- Redis、Kubernetes、微服务拆分或多区域部署；
- 完整 replay 播放器；
- 一批并行开发的新游戏；
- 为尚未验证的未来游戏提前设计通用脚本系统或复杂 ECS。

## 7. 成功标准

平台架构达到可继续开发的标准，需要同时满足：

- 新游戏规则不要求修改平台房间和网络核心；
- 平台不包含任何具体游戏的胜负或合法动作知识；
- Game Core 可在无浏览器、网络和数据库的环境中单独测试；
- 客户端无法通过伪造 State、actor 或 revision 改写权威结果；
- 相同 `gameVersion`、配置、seed、玩家席位和 actions 可重建相同结果；
- 创建房间但尚未开始一局时不产生 Match/history；每轮 Replay header 与 Core 初始化使用完全相同的 `playerOrder`；
- 模块职责、公开 API 和依赖方向在文档与自动化检查中保持一致。

测试职责与验收矩阵见 [TESTING.md](./TESTING.md)，开发顺序见 [ROADMAP.md](./ROADMAP.md)。
