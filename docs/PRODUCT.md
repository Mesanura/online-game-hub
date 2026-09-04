# 产品目标与范围

> 状态：产品基线（M1–M8 已完成；独立 Game Surface 与 Setup Protocol V6 正在分阶段迁移，井字棋纵切已上线，房间继续固定其创建时的 V5/V6 代际）
> 本文是产品目标、范围和非目标的权威来源。技术实现边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. 产品愿景

本项目是一个多人在线网页小游戏平台。用户从统一主页发现游戏，通过房间码或邀请链接与他人实时对战；长期可扩展至账号、比赛历史、排行榜、观战、断线重连和更多游戏类型。

平台参考“多个经典桌游与小游戏汇集在同一产品”的产品形态，但不复制任天堂《世界游戏大全 51》或其他产品的名称、界面、美术、音乐、图标、文案及其他受保护素材。游戏规则可以基于公共领域或合法授权内容，产品表达必须原创或具备明确授权。

## 2. 产品原则

1. **统一入口**：所有游戏通过同一网站发现、创建房间和加入对局。
2. **平台能力复用**：身份、房间、连接、稳定席位、ready、重连和比赛生命周期不在每个游戏中重复实现；replay 是否面向玩家开放由游戏版本显式声明。
3. **游戏独立演进**：Game Core 与 Game Surface 分别拥有清晰边界；表现层可独立选择技术栈、构建、运行和测试，再以版本化 artifact 集成网站。
4. **公平且可复现**：客户端只提交意图，服务器裁定结果；一场比赛可由版本、配置、seed 和 accepted actions 重建。
5. **先验证架构**：井字棋打通最小纵向链路，四子棋、五子棋、额外六贯棋与黑白棋已依次验证不同规则类型的扩展成本。

## 3. 目标用户流程

### 3.1 发现与开始游戏

1. 用户打开统一主页并查看已上线游戏。
2. 用户进入某个游戏详情或房间入口。
3. 用户创建私人房间，获得房间码和邀请链接。
4. 房间进入该游戏定义的 Setup；规则、参与席位、顺序和阵营由 Setup Surface 展示并由 Setup Core 裁定，平台不默认提供先手选择。
5. 另一位用户通过房间码或邀请链接加入。
6. Setup 选中的全部参与者在线、分别 ready 且 Setup 可 finalize 后，平台使用固化的最终设置创建新一局。

每款游戏使用三个可刷新、可深链接的页面阶段：`/games/{gameId}` 只负责创建或加入；`/games/{gameId}/rooms/{roomCode}` 负责 stable slots、平台 ready/cancel 与游戏 Setup Surface；`/games/{gameId}/rooms/{roomCode}/play` 负责 active/completed Game Surface。旧 `?roomCode=` 邀请入口必须兼容并规范化到房间路由。页面阶段只根据服务器 `room.lifecycle` 导航，客户端本地路由或 iframe 状态不能创建 Round、伪造身份或覆盖服务器 State/Outcome。

### 3.2 在线对局

1. 客户端显示当前用户可见的权威游戏视图。
2. 当前玩家提交一个游戏 Action。
3. 服务器接受或拒绝该 Action，并同步新的权威视图。
4. 比赛结束后平台保存结构化 Outcome；canonical journal 与玩家回放按 exact game version 的 replay 能力处理。
5. 一局结束后立即以上一局完整最终设置初始化下一轮 Setup，包括 config、参与席位、实际 playerOrder 与 assignments；每位参与者仍必须分别重新确认 ready，任一 accepted 设置变更会清空全部 ready。
6. 每轮都是独立的 Match、State、RNG、revision/tick、seed、Outcome 和 replay ID；不会复用上一轮权威运行状态。
7. 投降确认属于平台安全操作，实际投降仍作为游戏 intent 交给 exact Core 裁定；比分、回合、棋子、阵营、排名和 Outcome 表现全部属于 Game Surface。
8. 房主可以关闭房间，非房主可以主动离开；终止 active 对局前界面必须要求确认。

等待页以复制按钮提供不含身份凭据的邀请 URL，不长期暴露原始 URL；复制需要 loading/success/failure 与可手动选择的后备。实际对局使用占满可用空间的游戏舞台，平台 HUD 是默认收起且不参与舞台尺寸计算的覆盖式抽屉；最小浮动工具条只保留打开 HUD、连接状态和全屏。舞台全屏失败时降级为 `100dvh` focus mode。平台 HUD 只显示房间码、Round、连接、投降确认、关闭/离开和重新对局，不探测游戏 View 中的比分、棋子、阵营、当前回合、排名或 Outcome。大型棋盘或 canvas 的滚动、缩放与响应式布局由各 Surface 负责，并在移动端保留至少 44px 的有效操作目标。

### 3.3 Game Surface 产品边界

Game Surface 在无 Next.js、无登录态、无真实 WebSocket 的工作台中即可独立开发和测试。网站只向 iframe 传递按 viewer 投影的 Setup View 或 Game View、连接/只读状态、Round/revision/tick、viewport 与 intent 结果；Surface 不能访问 ticket、session、actor、raw State、seed、canonical replay 或 socket。Surface 加载、握手或 schema 校验失败时，网站显示可重试错误且不提交任何 intent。

新游戏必须分别声明 Setup、Play 与可选 Replay Surface artifact，以及 `none | record-only | player-playback` replay 能力。简单回合制棋牌建议提供 `player-playback`；实时游戏逐个评估，通常从 `record-only` 开始。脚手架不得静默选择 replay 模式。

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
- 每轮独立 PostgreSQL Match/Replay archive，以及账户私有的最小 history metadata；游客无历史入口。

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

### 4.5 多人中国跳棋

中国跳棋 `1.0.0` 支持 2–6 名玩家，每位玩家拥有六枚棋子和六角星角部的唯一营地。棋盘固定为 73 个轴坐标棋位；玩家可相邻移动或连续跳跃，客户端只提交起点与终点。等待页允许房主选择本轮人数、玩家选择/取消营地，并在全部在线、唯一 assignment、先手和 ready 条件满足后开局；对局按完成、阻塞和投降原因生成严格排名。该游戏复用稳定席位、重连、多人 lifecycle、Replay Format V1、PostgreSQL archive/history 和通用投降 HUD，不加入 AI、计时、悔棋或交换规则。

## 5. M7-A：密码账户与登录态对局归属

M7-A 提供用户名+密码账户。用户名规范化为 lowercase ASCII `[a-z0-9_]{3,24}` 且唯一；密码长度 8–128，使用 Argon2id。账户 session 为 30 天 opaque HttpOnly cookie，可退出撤销；登录、注册、退出和失效 session 都轮换 guest session。

游客仍可创建、加入、重连和完成全部对局，但没有历史或 replay 读取入口。注册/登录不会认领此前游客比赛；只有登录身份进入房间并在 Round 开始时快照的玩家才写入 `match_players.user_id`。匿名 Round 永久保持 `null`，后续归档重试、登录或退出不会回填。账户历史最多显示最近 50 条安全 metadata；M7-B 已提供账户私有 replay UI 和逐步播放，但不提供下载。

账户操作在 live room 中会明确提示离开后失去席位；同房间后续 Round 沿用 stable slot 的快照身份，不允许匿名/账户升级、降级或换号接管。

### 5.1 账户资料与头像菜单

网站右上角统一使用头像入口。游客资料默认为“游客”，可在当前浏览器修改显示名并保存到固定 `localStorage` key；登录账户资料保存到 PostgreSQL，登录、退出和失效 session 不会认领、迁移或覆盖游客资料。资料只作用于右上角菜单，不进入房间、玩家卡片、Protocol、ticket、Game Server 或 replay。

显示名先执行 NFC 规范化和首尾空白裁剪，必须包含 1–24 个 Unicode grapheme cluster，且不得为空或包含控制字符。头像不接受图片上传，而是从显示名开头的 grapheme 生成：首位为汉字、完整 emoji 或其他非 ASCII 字母数字时只取首位；首位为 ASCII 字母数字且第二位不是 ASCII 字母数字时只取首位；否则取前两位并转为大写。数字开头的连续 ASCII 字母数字前缀若包含至少两个数字，则取其中前两个数字，例如 `1a2b🐷你好` 显示为 `12`；`1你好2` 显示为 `1`；`🐷a` 显示为 `🐷`。浏览器使用 `Intl.Segmenter` 保护 ZWJ emoji 和旗帜 emoji 不被拆分。

头像菜单支持鼠标悬停、键盘聚焦和点击打开，并支持 Escape、外部点击关闭。游客显示“登录”“注册”；登录后显示“历史对局”“账号设置”“退出登录”。在 live room 中执行这些身份变化操作前，页面保留离开席位确认。

## 6. 长期产品能力

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

M8 选择双人 Pong 作为实时 2D 验证游戏。它使用固定 tick 的服务端权威模拟、服务器决定的输入生效 tick 和仅含公开视图的快照；Phaser 只负责采集输入、插值和渲染。Realtime runtime 与离散 Action runtime 并列，继续复用目录、身份、ticket、房间码、stable slots、ready/reconnect、Round/Match 生命周期、账户归属和私有 replay 授权边界，但不复用回合制 `GameDefinition`、`game.action`、revision 或客户端 Host。完整范围和不变量以 [REALTIME_RUNTIME_DESIGN.md](./REALTIME_RUNTIME_DESIGN.md) 为准。

## 7. 当前明确非目标

M6 完成后当前仍不实现：

- 完整 Lobby 或公开房间浏览；
- 邮箱、找回密码、邮件验证、管理员重置和第三方 OAuth；
- 公开比赛列表、完整历史产品、公开 replay 或排行榜；
- 自动 Matchmaking；
- 观战功能；
- Redis、Kubernetes、微服务拆分或多区域部署；
- 公开 replay、观战、分享链接和下载；M7-B 的账户私有 replay 仅对登录态参赛者开放；
- 一批并行开发的新游戏；
- 为尚未验证的未来游戏提前设计通用脚本系统或复杂 ECS；M8 只验证一个 realtime runtime 和一个 Pong 游戏，不建立通用 ECS、预测/回滚框架或物理游戏模板。

## 8. 成功标准

平台架构达到可继续开发的标准，需要同时满足：

- 新游戏规则不要求修改平台房间和网络核心；
- 平台不包含任何具体游戏的胜负或合法动作知识；
- Game Core 可在无浏览器、网络和数据库的环境中单独测试；
- 客户端无法通过伪造 State、actor 或 revision 改写权威结果；
- 相同 `gameVersion`、配置、seed、玩家席位和 actions 可重建相同结果；
- 创建房间但尚未开始一局时不产生 Match/history；每轮 Replay header 与 Core 初始化使用完全相同的 `playerOrder`；
- 模块职责、公开 API 和依赖方向在文档与自动化检查中保持一致。
- 新游戏表现层不要求修改网站全局 CSS、字段探测 HUD、Next transpile 列表或网站前端技术栈；Surface artifact 可独立构建并按 exact game/surface version 回滚。

M8 完成后还必须满足：相同 realtime game version、Config、seed、玩家顺序及按 server tick 归档的 accepted input 能重建相同结果；浏览器不能提交位置、速度、碰撞、分数、Outcome 或生效 tick；网络抖动下 Phaser 只能用服务端快照插值，不能以本地预测状态覆盖权威结果。

测试职责与验收矩阵见 [TESTING.md](./TESTING.md)，开发顺序见 [ROADMAP.md](./ROADMAP.md)。
