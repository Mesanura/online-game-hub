# 开发路线图

> 状态：M1–M8 已完成；M9 独立 Game Surface、Setup V6 与显示系统正在实施
> 本文是项目阶段顺序和里程碑退出条件的权威来源。里程碑按依赖排序，不承诺具体日期。

## 原则

- 完成当前里程碑的退出条件后再扩大范围。
- 每个阶段留下可运行检查和明确 public API。
- 井字棋用于验证架构，不并行堆叠更多游戏。
- 基础设施只在当前产品需求或测量结果证明必要时引入。
- Roadmap 变化不得绕过 [PRODUCT.md](./PRODUCT.md) 的明确非目标和 [ARCHITECTURE.md](./ARCHITECTURE.md) 的依赖边界。

## M0：架构基线

交付：

- 产品、架构、插件、协议、replay、测试和路线图文档；
- 根 `AGENTS.md`；
- 已确定、暂缓和当前不做的决策清单；
- 推荐目录与依赖方向。

退出条件：八个 Markdown 文件通过范围、链接和一致性检查；没有生产代码、配置或依赖。

## M1：Repository 与 Monorepo 基础

> 实施状态：已完成（2026-08-30）。稳定根命令、干净安装和故意违规 fixture 已通过验证。

目标：建立可验证的工程外壳，不实现游戏或在线功能。

交付：

- 经用户确认后初始化 Git；
- pnpm workspace、Turborepo 和 pinned Node/pnpm 版本；
- strict TypeScript 基础配置；
- ESLint、格式化和 import boundary/cycle checks；
- `apps`、`packages`、`games`、`tooling` 的最小 workspace package manifests 与 public exports；
- 根 `lint`、`typecheck`、`test`、`build` 命令和最小 CI；
- 贡献说明或 README，指向本文档体系。

退出条件：空实现 package 能在干净环境安装、typecheck、lint、test 和 build；边界检查能用故意违规 fixture 证明有效。

不做：Next.js 页面、Colyseus room、井字棋规则、数据库或 UI。

## M2：Game SDK、Protocol 与井字棋 Core

> 实施状态：已完成（2026-08-30）。Game/Protocol/registry public API、井字棋 1.0.0 Core、内存 replay store/verifier 与 golden fixture 已通过全仓质量门禁。

目标：用纯逻辑证明插件和 replay 契约可实现。

交付：

- `game-sdk` 类型、JSON 约束和 deterministic RNG；
- `protocol` V1 Zod schemas 与 type tests；
- 显式 registry 的 manifest/server 基础；
- 井字棋 manifest、Core、规则说明和局部 `AGENTS.md`；
- in-memory replay record/runner；
- Core、determinism、projection 和 golden replay tests。

退出条件：相同 replay 可重复重建相同 State、RNG cursor 和 Outcome；Core 禁止依赖检查通过；没有网络或 React 依赖。

## M3：Authoritative Game Server

> 实施状态：已完成（2026-08-30）。独立 Colyseus composition root、ticket/runtime ports、authoritative room、reconnect、replay commit 与真实双客户端 integration tests 已通过全仓质量门禁。

目标：建立两连接可使用的通用 server runtime。

交付：

- 独立 Colyseus Game Server；
- ticket verification port 与测试 issuer；
- 创建/加入房间、room code 和 stable slots；
- 串行 Action pipeline、revision、idempotency 和 per-viewer snapshot；
- in-memory `RoomStore`，并将 M2 `ReplayStore` 接入 authoritative room commit；
- 60 秒 reconnect 与 fake-clock integration tests；
- health check、结构化日志和最小指标。

退出条件：两个测试客户端可完成权威对局；伪造 actor、stale revision、重复命令和未授权重连测试通过。

## M4：Web Vertical Slice

> 实施状态：已完成（2026-08-30）。Next.js/guest/ticket/client host/井字棋 UI 已形成真实 Web vertical slice；双 browser-context Playwright 已验证胜局、平局、恶意 intent、reconnect、cookie 隔离、abandoned 和 canonical replay。

目标：完成用户可操作的井字棋端到端链路。

交付：

- Next.js 首页、游戏目录和井字棋页面；
- 匿名 guest session 和短期连接 ticket；
- 创建房间、房间码及邀请链接加入；
- `game-client-sdk` host 与井字棋 Client Module；
- 连接、重连、错误和终局的最小 UI；
- 两 browser contexts 的 Playwright E2E。

退出条件：两名访客能在浏览器完成一场比赛；刷新后在宽限期内恢复；canonical replay 验证通过。

## M5：持久化基础

> 实施状态：已完成（2026-08-30）。PostgreSQL/Drizzle migration、durable replay、Match archive、同房间多轮/关闭纵切、真实数据库 integration 与 PostgreSQL-backed Playwright 已通过验证。

开始条件：M4 稳定，产品确认需要跨重启历史。

已交付：

- PostgreSQL + Drizzle 基础和 migrations；
- `User`、`Match`、`MatchPlayer`、`Replay` 的最小 schema；
- durable `ReplayStore` 和比赛历史读取；
- canonical replay 保持 server-only；账户归属留待 M7-A；
- 两名原玩家在同一 live room ready/cancel 后开始独立下一轮，保留 room code/stable slots；每轮拥有独立 Match、replay、revision 和 `roundNumber` history；
- 房主关闭、非房主主动离开、active 确认、terminal outsider 拒绝、60 秒 reconnect close 与 5 分钟 completed TTL；
- 单实例启动把遗留 waiting/active archive 标记 abandoned，不恢复 active State；
- 固定版本 CI PostgreSQL service、随机数据库清理和真实 adapter/Colyseus/Playwright tests。

事务边界已收敛在 replay action/Match revision、replay completion/Match completion，以及 advisory lock 下连续后续轮 Match insert；`(runtime_room_id, round_number)`、replay sequence 和 participant 约束 fail closed。active RoomStore 仍是内存且没有跨存储原子性。当前幂等写入与唯一约束足够，不引入 outbox。OAuth/password/provider、通用数据保留/删除产品、公开 replay、active room recovery、多实例 ownership 都未实现。

## M6：验证插件扩展性

> 实施状态：已完成（2026-08-31）。四子棋、五子棋、用户确认的额外六贯棋与黑白棋均已通过各自 Core、Client、golden、authoritative integration、PostgreSQL-backed E2E 和全仓质量门禁。

按顺序增加少量规则类型不同的游戏：

1. 四子棋：验证不同棋盘和胜负扫描（**第一阶段已完成**）；
2. 五子棋：验证更大棋盘与规则变体 Config（**第二阶段已完成**）；
3. 黑白棋：验证翻转、无合法行动和跳过回合（**第三阶段已完成**）。

每新增一个游戏前复盘：需要修改多少平台文件、registry 步骤是否机械、SDK 是否出现游戏特例。只有流程稳定后才实现 `tools/create-game`。

四子棋复盘结果：

- 游戏 package 内 16 个文件拥有 manifest、Core、Client Module、局部规则/Agent 文档、unit/client/golden tests；
- 游戏外非文档改动 12 个文件，其中 registry/build/lockfile 机械登记 6 个、Web 游戏表现 CSS 1 个、验证测试 5 个；
- `game-sdk`、Protocol V1、Replay Format V1、`game-client-sdk`、通用 runtime、ticket、database schema 和 migration 均无需修改，也没有新增 `gameId` 分支；
- exact/current resolver、`projectView`、canonical replay、同房间多轮、PostgreSQL history 和 repository-check 可直接支持第二游戏；
- 现有通用 Web 页面仍含井字棋 `CELL_OCCUPIED` 规则文案映射，且 game CSS/Next transpile 仍需显式登记；本轮没有为四子棋增加规则文案特例；
- 两个游戏只证明 registry 步骤大体机械，尚不足以固定模板、样式与错误呈现策略，因此不创建 `tools/create-game`。

五子棋复盘结果：

- 游戏 package 内 16 个文件拥有 manifest、15×15/19×19 strict Config、Core、Client Module、局部规则/Agent 文档、unit/client/golden tests；默认 15×15，`winLength` 固定为 5；
- 现有 Protocol V1 create request、runtime Config normalization、exact/current resolver、Replay Format V1、PostgreSQL adapters 和通用游戏页均能承载非 `null` Config，没有任何 Gomoku 规则进入平台；
- 通用 Web 原先固定传 `null`，无法从 catalog 取得不同游戏的默认 Config；`GameManifest` 因跨所有游戏的真实创建需求新增必填 JSON-safe `defaultConfig`，同步迁移全部 manifest、消费者、contract tests 与权威文档；
- `protocol`、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database schema/migration、Protocol V1、Replay Format V1 和既有游戏 `gameVersion` 均无需修改；
- 五子棋真实 Colyseus integration 使用 19×19 Config，Playwright 使用默认 15×15，从中文目录完成创建、加入、权威拒绝、状态同步、胜局、PostgreSQL replay 重读与私有 history；
- 第三游戏仍需显式 registry、Next transpile 与 Web CSS 登记，且 manifest contract 本轮才因 Config 证据收敛，因此继续暂缓 `tools/create-game`，不在同一阶段固化模板。

额外六贯棋复盘结果：

- 六贯棋以 `gameId: hex`、exact `gameVersion 1.0.0` 作为额外游戏加入，当时不替代按序计划的黑白棋；固定 11×11、BLUE 先手、RED/BLUE 连接边、无交换规则与无 DRAW；
- 游戏 package 自身 16 个文件拥有 null Config、strict `PLACE_STONE | RESIGN`、canonical multi-source BFS path、Core、Client Module、局部文档、unit/client/golden tests；没有新增外部依赖；
- 现有 Protocol V1、Action pipeline、exact registry、`projectView`、Replay Format V1、多轮 stable slots、PostgreSQL archive/history 都能直接承载不受回合限制的投降与变长连接路径；
- `game-sdk`、`protocol`、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 与既有游戏版本均零修改；真实 Colyseus integration 覆盖连接胜局与第二轮 off-turn resignation；
- 仍需显式 registry、Next transpile、Web CSS 和纵切测试登记；第四游戏在当时尚未验证黑白棋的翻转、无合法行动与跳过回合，因此继续不创建 `tools/create-game`。

黑白棋与 M6 收尾复盘结果：

- 黑白棋以 `gameId: reversi`、exact `gameVersion 1.0.0` 上线；固定 8×8、BLACK 先手、八方向全部翻转、对方无合法行动时同 slot 续行、双方无行动的非满盘终局与按棋子数 WIN/DRAW；
- 游戏 package 内 16 个文件拥有 null Config、strict `PLACE_DISC(cell)`、Core、服务器 View 的合法落点/棋子数/Outcome、Client Module、局部文档、unit/client/golden tests；没有新增外部依赖；
- 游戏外非文档改动为 10 个唯一文件：registry package/catalog/client/server、lockfile、Next transpile 共 6 个机械登记，Web CSS 1 个，registry/integration/E2E 验证 3 个；
- 现有 Action pipeline 可让一次 accepted placement 同时完成多方向翻转和回合推进；强制跳过不产生 PASS、不增加额外 revision、不写 replay。`game-sdk`、Protocol V1、Replay Format V1、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 与全部既有游戏版本均零修改；
- 60-action golden 在连续 WHITE actor 处证明 PASS-free replay；真实 Colyseus integration 以 25-action 对局覆盖强制跳过、35 个空格的非满盘终局和同房间第二轮独立 replay；PostgreSQL-backed E2E 以 11-action 对局覆盖权威翻转、49 个空格终局、新连接 replay verification 与双方安全 private history；
- 连续多个游戏的 16 文件骨架及 registry/package/lock/Next 登记已经稳定；M6 当时据此把窄 `tools/create-game` 留给后续独立任务，并限定它只自动化 package/export/tsconfig 与显式登记。该独立任务现已按下文“已完成开发工具增强”落地，规则、CSS、golden、integration、E2E 序列仍由游戏 owner 设计。

## 已完成平台增强：Protocol V2 与逐局先手

> 实施状态：已完成（2026-08-31）。Protocol/Host/Runtime/Database adapter/Web 与五游戏纵切已迁移；该增强完成时 Replay Format V1、五个游戏 1.0.0、PostgreSQL schema 和 migration 保持不变。后续规则版本见“通用投降与规则/Replay 版本”增强。

本增强在进入 M7 候选能力前收敛现有双人房间流程：

- live room 与 Round 解耦；创建房间只保存 room code、Config、stable slots 和关闭状态，未开局房间不创建 Core、Replay、Match 或 history；
- 首局与每次重开统一进入下一局设置，由房主选择“房主先手/非房主先手”，双方 ready 且在线后才启动 Round；改变选择会清空 ready，重复选择保持 ready，断线/takeover 只清对应玩家 ready；
- 每轮独立保存 `playerOrder`、RNG、State、revision、Outcome、Replay 和 Match；stable slot identity 不变，标准先手角色由本轮 `players[0]` 获得；
- Runtime 新增独立 `MatchArchive` port，PostgreSQL 使用 `PostgresMatchArchive`；启动失败保留 pending candidate 并通过 replay/archive 幂等语义重试；
- Protocol V2 使 Action/Snapshot 的 `roundNumber` 必填，并以严格 discriminated union 提供 `SELECT_STARTER`、`READY_FOR_ROUND`、`CANCEL_ROUND_READY`、`CLOSE_ROOM`；Host 可在首局没有 snapshot 时只根据 lifecycle 工作；
- 通用 Web 在无 snapshot 时展示邀请与下一局设置，completed 时保留终局棋盘并并列展示设置；五套 E2E 使用稳定 test id 覆盖相同流程，井字棋第二局明确反转先手。

该增强只面向当前所有已注册的双人游戏，当时不预先加入多人 starter policy、随机先手、观战、房主迁移或 active room 跨进程恢复。M2–M6 小节中的 “Protocol V1” 描述保留为各里程碑完成当时的历史事实；当前部署契约以 [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md) 的 Protocol V5 为准。

## 已完成平台增强：三阶段 Claymorphism Web 体验

> 实施状态：已完成（2026-09-01）。五个游戏共用入口、等待和对局真实路由；该 UI 增强本身未改变 Game Core、Protocol V2、Replay Format V1、数据库 schema 或当时的游戏版本。

- 首页、游戏目录与五游戏流程统一为暖奶油、蜜桃/珊瑚/蓝绿色 Claymorphism tokens，并保留明显 focus、reduced motion、语义状态和键盘操作；
- `/games/[gameId]` 只创建/加入，`/rooms/[roomCode]` 只处理稳定席位、邀请、先手与准备，`/play` 只承载 active/completed 棋盘；服务器 lifecycle 决定规范阶段；
- `[gameId]/layout` 跨三个子路由保留同一 `GameClientHost`，兼容旧 `?roomCode=`，刷新/reconnect 不重复 join 或丢失 stable slot；
- 邀请改为 Clipboard API 按钮，含 copying/copied/failed、`aria-live` 和手动复制后备，不复制身份凭据；
- 桌面对局页面本身不因 HUD 滚动；大型棋盘在专属容器内滚动，移动端有效落点至少 44px；终局保留最终棋盘并从“下一局设置”回到等待页；后续通用投降增强继续复用同一 HUD；
- PostgreSQL-backed 五套 Playwright 继续覆盖双方准备、两轮、reconnect、completed/closed、canonical replay 和私有 history，未新增观战、昵称、计时、Matchmaking 或规则配置。

## 已完成开发工具增强：窄版 `tools/create-game`

> 实施状态：已完成（2026-09-01）。只自动化五款游戏反复验证的机械骨架和显式登记，不改变产品或运行时能力。

- 新增独立 `@online-game-hub/create-game` workspace package 与根 `pnpm create-game --game-id <id>` 非交互命令，接入 Turbo build/typecheck/test；
- 严格验证 lowercase kebab-case、路径/保留名、已有目录、workspace package、manifest gameId 和确定性 export symbols；
- 只生成 package/public exports、三套 tsconfig、必要目录和未完成说明；不生成 manifest 语义、规则/Core/Client、CSS、golden 或纵切对局；
- 通过固定静态 marker 幂等更新 registry dependency、catalog、lazy client loader、exact/current server definitions 和 Next transpile allowlist，继续禁止目录扫描与运行时插件发现；
- 在写入前完成全量 preflight，冲突/部分登记零写入；写入或根目录固定 pnpm lockfile-only 更新失败时回滚本轮目标；
- 隔离临时 fixture 覆盖精确输出、第二次零 diff、非法输入、目录/package/gameId/symbol 冲突、部分/重复登记、lockfile 失败回滚、CLI help/退出码和稳定输出；
- 成功后只打印人工 Definition of Done 清单。该工具增强本身未改变 Protocol V2、Replay Format V1、database schema、当时五款游戏的 `gameVersion 1.0.0` 或平台 public runtime API。

## 已完成平台增强：通用投降与规则/Replay 版本

> 实施状态：已完成（2026-09-01）。五游戏共用投降 HUD 与 exact 历史/当前规则并存已通过 Core、client、registry、golden、真实 Colyseus 和 Playwright 验证。

- `GameClientModule` typed/erased contract 新增可选 `createResignAction`；五个 current modules 都提供最小 strict `RESIGN`，共用 HUD 统一处理 active player 可见性、二次确认与提交，游戏组件不再各自实现投降按钮；
- 井字棋、四子棋、五子棋与黑白棋 current `gameVersion` 提升为 `1.1.0`，增加 off-turn `RESIGN`、State `resignedSlotId` 与 `RESIGNATION` WIN；普通落子、胜负、计分、Config 与 RNG 规则保持不变；
- 四个 `1.0.0` definition 独立 frozen、不 alias current、继续拒绝 `RESIGN`；原 golden fixture 不改写，current `1.1.0` 各有 normal 与 resignation fixtures；
- registry 同时 exact-resolve 历史/当前版本；创建新房间先读取 catalog manifest，再 exact 选择 current definition，不依赖登记数组顺序；
- 六贯棋 Core、邻接算法和 `gameVersion 1.0.0` 保持不变；新增 BLUE/RED 第三轴 accepted-Action regression，并由真实 server integration 验证 canonical path、终局拒绝和 replay；
- canonical replay 仍只记录规范化且 accepted 的 Action。四游戏 server table 验证正常 Action 后同 actor off-turn resignation、revision/completed/Outcome、单一 `RESIGN` event 与 exact verification；Protocol V2、Replay Format V1 和数据库 schema/migration 均无需修改。

## 已完成平台增强：Protocol V3 随机先手与即时重开

> 实施状态：已完成（2026-09-01）。五款游戏共用设置、结果 HUD、Host 与 Runtime 已迁移；Replay Format V1、数据库 schema 和全部游戏版本保持不变。

- `StarterChoice` 增加 `RANDOM`，由 Game Server 使用本轮新 seed 规范决定 owner/non-owner 顺序；选择过程不推进交给 Game Core 的 RNG cursor，最终 `playerOrder` 同时写入 Core 初始化、Replay header 和 Match archive；
- `room.control` 增加 `START_REMATCH`；completed 后任一原玩家可在双方在线时复用上一轮实际 `playerOrder` 立即创建独立新 Round，不复用 State、revision、Outcome、Replay 或 Match；
- 结果 HUD 提供“重新对局”和“设置规则”两个操作；后者保留原下一局设置流程，前者直接发送即时重开 intent；
- starter 设置统一显示“我方先手”、“对方先手”、“随机先手”并以细线分隔；五款游戏的棋盘状态文本追加对应棋子和当前回合颜色标记；
- `RANDOM` 会出现在严格 lifecycle schema，旧 V2 客户端无法安全解析，因此 wire envelope 提升为 Protocol V3；V1/V2 ticket、request 和 message 均 exact 拒绝，不做混合版本猜测。

## M7-A：密码账户与登录态对局归属

> 实施状态：已完成（2026-09-02）。Protocol V4、用户名+密码账户、可撤销 30 天 session、账户/游客混合对局、Round 开始身份快照、账户私有历史和 Web 认证页面已实现；多人扩展后的现行 wire 为 Protocol V5。

- `password_credentials` 与 `account_sessions` 独立于通用 `users`；Argon2id hash、SHA-256 token hash-at-rest、同源 JSON mutation、单实例有界限速和 Secure/HttpOnly/Lax cookie；
- ticket claims 的可选 `userId` 使 Protocol V4 显式拒绝 V1–V3；Game Server 只信 verifier 结果，slot 私有保存账户身份并在 Round 开始写入 `match_players.user_id`；
- 游客可完整创建/加入/重连/完成，但匿名历史 API 返回 401；注册、登录、退出或归档重试不会认领/回填旧游客 Round；
- 账户历史最多 50 条安全 metadata；M7-B 提供账户私有 replay UI 和逐步播放，但不提供下载或公开分享。

## M7-B：账户私有历史与回放中心

> 实施状态：已完成（2026-09-02）。

- 新增 `GET /api/matches/[matchId]/replay`，只接受当前账户参赛的 completed Match 和 completed canonical replay；未登录、未参赛、不存在和非法 UUID 使用安全语义；
- runtime 以 exact `gameId + gameVersion` definition 和数据库推导的 player Viewer 逐帧重建 `projectView`，设置帧数、响应大小和 fail-closed 校验边界；
- 五款游戏显式登记 historical client module，回放页面严格只读并支持首帧、前后帧、末帧、播放/暂停和 slider；
- Protocol V5、Replay Format V1、所有游戏规则与 gameVersion 均保持不变；游客比赛内部保留但永不进入账户历史；
- 不包含公开 replay、观战、分享链接、下载、排行榜、Matchmaking、隐藏信息权限策略、Redis、多实例或 active room 恢复。

## 已完成平台增强：Protocol V5 多人中国跳棋

> 实施状态：已完成（2026-09-02）。中国跳棋 1.0.0、多人 room lifecycle、assignment 控制、Replay V1 元数据、Web 六芒星棋盘与全仓质量门禁已完成。

- `GameManifest` 和 `InitialContext` 增加可选 assignment capability/metadata；runtime 按 manifest 校验 2–6 人、精确人数和唯一营地，不把具体游戏规则写入平台；
- Protocol V5 增加 `SELECT_PLAYER_COUNT`、`SELECT_PLAYER_ASSIGNMENT`、`CLEAR_PLAYER_ASSIGNMENT` 与动态最多六个 slot 的 lifecycle；首手策略只决定首位，其余玩家按 assignment 固定顺序排列；
- 中国跳棋 package 提供 73 位确定性轴坐标 Core、相邻/连续跳跃、完成/阻塞/投降排名、projection、Claymorphism Client Module、规则文档和 golden replay；
- Replay Format V1 在既有 `players` 条目中兼容可选 assignment，旧 replay 继续可读；registry、Web、PostgreSQL-backed checks、Colyseus integration 和 Playwright E2E 均覆盖新契约。

## M7：按证据扩展平台

以下能力不预先排序，在产品需求和运行指标出现后单独立项：

- Matchmaking、排行榜、Rating、Friendship；
- 观战、观众延迟和公开 replay；
- Redis presence/driver、多 Game Server 实例和 room ownership；
- 长比赛 checkpoint 和服务重启恢复；
- 隐藏信息卡牌游戏及其 replay 权限；
- 多区域读取、容灾或更细服务拆分。

## M8：独立 realtime runtime 与 Phaser Pong

> 实施状态：已完成（单实例双人 Pong）。详细运行时契约见 [REALTIME_RUNTIME_DESIGN.md](./REALTIME_RUNTIME_DESIGN.md)。

目标：以一个双人实时 Pong 纵切验证“固定 tick、持续输入、服务器权威物理、快照插值和 Phaser 渲染”可以与现有离散 Action 游戏并列运行，而不污染回合制 Core 或其 wire/runtime 契约。

交付：

- 新增与 `game-sdk`、`game-server-runtime`、`game-client-sdk` 并列的 realtime SDK、server runtime 和 client host；它们不导入或复用回合制 `GameDefinition`、`GameClientModule`、`game.action`、`match.snapshot` 或 revision pipeline；
- 将 catalog manifest 收敛为按 `runtime: "turn-based" | "realtime"` 判别的公共契约，保留所有既有游戏和 V5 行为；registry、Web 与 Game Server 根据 manifest 显式选择对应的 client/server runtime，不做目录扫描或单一 room 内的 gameId 特例；
- 一个 `games/pong` package：纯 TypeScript、固定整数单位的 60 Hz 服务端模拟；双人 paddle 输入、球拍/边界碰撞、得分、确定性发球、获胜、投降和公开投影均由服务器裁定；Phaser 仅位于游戏 client；
- 独立 `Realtime Protocol V1`：客户端只提交有界、单调 input sequence 的方向 intent；服务器决定接受顺序和生效 tick，并发送带 `roundNumber`、server tick 和 input acknowledgement 的完整 realtime view snapshot。Protocol V5 的 turn-based envelope、ticket 语义和所有既有客户端保持原样；
- 复用平台的身份、ticket、room code、stable slots、ready/reconnect、Round/Match、账户归属和单实例 active-room 语义。实时 Round 同样必须 archive；其 canonical replay 记录按 server tick 规范化且 accepted 的 input changes，并有 exact verifier、golden fixture、PostgreSQL 持久化和账户私有的只读回放路径；
- Web 目录、创建/加入/等待页面继续复用现有工作流；Pong 对局和只读 replay 使用 Phaser canvas，提供键盘可操作输入、连接/重连/终局状态和必要的 reduced-motion 降级。

退出条件：

- 两个真实浏览器可创建、加入、ready、实时完成一局 Pong、短暂断线后恢复，并在相同服务器快照下收敛；
- 伪造位置、速度、碰撞、分数、Outcome、actor、slot、tick 或过期/重复 input sequence 均不会推进 authoritative simulation、tick replay 或 Match；
- 固定 seed 与 accepted input log 可逐 tick 重建相同 State、score、Outcome 和最终 tick；既有 Replay Format V1 golden fixtures 继续通过；
- 实时协议、runtime、registry、PostgreSQL archive、私有 replay、Phaser client、两浏览器 E2E 和全仓质量门禁按 [TESTING.md](./TESTING.md) 完成；
- 不引入 Matchmaking、Lobby、观战、公开 replay、Redis、多实例、durable active-room recovery、客户端预测/回滚、通用 ECS 或第二个 realtime 游戏。

## M8 维护提示

后续 realtime 变更仍应以 [REALTIME_RUNTIME_DESIGN.md](./REALTIME_RUNTIME_DESIGN.md) 为权威边界。修改 shared public API、Protocol、Replay Format 或数据库 schema 前，必须完成其中要求的兼容性评估。

M8 结束后再由产品证据选择下一个 M7 候选能力；不要把 OAuth、Lobby、Matchmaking、排行榜、观战、公开 replay、durable active room、Redis 或多实例混入本轮。

## M9：独立 Game Surface、Setup V6 与显示系统

目标：让游戏表现层从 Next/React 布局与构建链中独立，同时保留纯 TypeScript 权威 Core；把逐局规则、参与者、顺序和阵营迁入游戏定义的 Setup，并消除平台 HUD 对游戏舞台的挤压与字段猜测。

### M9-A：契约与兼容骨架

> 实施状态：已完成契约、双轨注册与兼容骨架；现有房间行为保持不变。

- 新增无 React/Next/具体游戏依赖的 `game-surface-bridge`，定义 artifact schema、Bridge V1、nonce/MessageChannel 与 strict JSON messages；
- 新增无 transport/DOM 依赖的 `game-setup`，定义 Setup State/Action/View、transition/projection/readiness/finalize 与 `FinalizedRoundSetup` 通用校验；
- Protocol V6 与 V5 exact schema 并存，Realtime Input/Snapshot Protocol V1 不变；
- 所有 manifest 显式声明 `none | record-only | player-playback`，现有/历史版本保持 `player-playback`，runtime 对 `none` fail closed；
- deployment registry 按 exact game/version 固定 V5/V6 与 legacy/surface renderer；五种版本的升级边界写入权威文档。

退出条件：现有游戏行为零变化，contract、全仓 typecheck/lint/test/build/dependency checks 全部通过。

### M9-B：非挤压式游戏页外壳

> 实施状态：已完成；代码、组件测试与桌面/平板/手机全 viewport E2E 均已通过。

- HUD 改为默认收起的覆盖式抽屉，最小浮动工具条只保留 HUD、连接状态与全屏；
- stage 占满可用空间并使用 `min-width/min-height: 0`、`overflow: hidden`；
- Fullscreen API 被拒绝或不支持时切换 `100dvh` focus mode；ESC、focus trap、ARIA 和 reduced-motion 完整；
- Platform HUD 删除比分、棋子、阵营、当前回合、排名和 Outcome 猜测；legacy Client Module 通过适配器继续运行。

退出条件：既有游戏无需迁移即可通过桌面/平板/手机 viewport 与现有 E2E。

### M9-C：独立 Surface 工具链与 Host

> 实施状态：已完成；Bridge V1、workspace/artifact 发布链、Docker static copy、Web iframe Host、独立 Workbench 与全 viewport E2E 均已实现并通过验证。

- `game-surfaces/*` 加入 workspace、Turbo、依赖检查、CI 和 Docker static copy；`dist` 不提交；
- manifest/source lock/digest/version drift 校验后复制到 `/game-surfaces/<gameId>/<surfaceVersion>/<mode>/` 并使用 immutable cache；
- 实现 sandboxed iframe Host、Bridge handshake、timeout/retry、安全 headers 和生命周期；
- Surface Workbench 支持任意 dev URL、fixtures、断线/重连/终局/只读/revision/tick/reduced-motion/viewport/fullscreen 模拟；
- conformance tests 证明 Surface 无需 Next 或 Game Server 即可开发。

### M9-D：Setup V6 与双 runtime

> 实施状态：回合制 dormant V5/V6 runtime 与井字棋 Setup integration 已完成；production registration 仍为 V5。Realtime adapter、等待页 Setup Surface 和试点切换尚未完成。

- 两套 runtime 使用同一纯 setup coordinator，RoomStore 保存 versioned Setup State、setupRevision、ready slots、上一局 finalized setup 与协议代际；
- 实现服务端 actor/schema/权限、stale/idempotency、持久化重试、per-viewer projection 和独立 setup RNG；
- 等待页保留房间码、邀请、presence、ready、关闭/离开，规则区域挂载 Setup Surface；
- 重新对局完整复用 finalized setup，但每个参与者分别重新 ready；accepted 设置清空全部确认；
- 第一轮迁移只复现现有 starter/人数/营地行为，不同时重做交互设计。

### M9-E：井字棋与 Pong 双试点

> 实施状态：井字棋独立 React/Vite Setup/Play/Replay artifact 与源码摘要锁已完成；等待页接入、production registration 切换与全链路验收尚未完成。

1. 井字棋以独立 React/Vite Surface 验证 Setup/Play/Replay 与回合制 Bridge；Core、Action、Replay V1 和 gameVersion 不变。
2. Pong 以 TypeScript + Phaser Surface 验证 realtime input sequence/ack/reconnect/replay；800×400 逻辑场地使用响应式 FIT，`targetScore` 首轮保留默认值。

只有两项试点通过 contract、真实 PostgreSQL、integration 与全 viewport E2E 后才批量迁移。

### M9-F：其余游戏与 legacy 退役

按 Connect Four、Gomoku、Reversi、Hex、Chinese Checkers 迁移表现与 Setup。全部当前/受支持历史版本都有 Surface 后，删除 Web 动态 React Client Module、游戏专属全局 CSS、字段探测 HUD 与 Next 游戏 transpile；V5 房间排空后再删除 legacy setup schema/runtime。

### M9-G：Setup UI 独立设计

架构迁移稳定后，各游戏只通过 `surfaceVersion` 迭代规则解释、预览、参与顺序和 assignment 交互。平台只规定外框、可访问性、loading/error 与 ready 区域，不引入通用表单 DSL。

本里程碑不包含真正 `replay:none` 的数据库语义、外部仓库发布、独立无 Cookie 资源域或 Setup UI 视觉重设计。生产先使用同域静态路径和 opaque iframe origin，后续迁域不改变 Bridge。
