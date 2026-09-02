# 系统架构

> 状态：架构基线（Protocol V5，M1–M7-B、逐局先手、多人 assignment、三阶段 Web 与窄版 create-game 已完成）
> 本文是系统职责、目录结构、依赖方向和部署基线的权威来源。产品范围见 [PRODUCT.md](./PRODUCT.md)。

## 1. 架构目标

- Platform 与 Game 分离，平台永远不实现具体游戏规则。
- 每个游戏拥有可独立理解、测试和版本化的纯逻辑 Core。
- 服务器是房间、玩家身份、动作顺序和比赛状态的唯一权威。
- 新游戏通过显式、类型化注册加入，不依赖运行时目录扫描。
- 依赖方向简单且可自动检查，避免循环依赖和隐式约定。
- Next.js Web 与 Colyseus Game Server 可以独立部署和扩容。

## 2. 系统上下文

```text
Browser
  ├─ HTTPS ──> Next.js Web
  │              ├─ 首页与游戏页面
  │              └─ 匿名 session / 短期连接票据
  └─ HTTPS + WebSocket ──> Colyseus Game Server
                             ├─ 房间与席位
                             ├─ authoritative action pipeline
                             ├─ reconnect / match lifecycle
                             └─ replay event log
```

浏览器不通过 Next.js 代理 WebSocket。Web 和 Game Server 共享经过版本化的协议契约，但保持进程、部署和横向扩容边界独立。

## 3. 服务职责

### 3.1 `apps/web`

负责：

- 统一首页、游戏目录、游戏页面和房间加入界面；
- 建立匿名访客 session，并管理用户名+密码账户、可撤销账户 session 和同源认证 API；
- 签发短期 Game Server 连接票据；
- 加载具体游戏的 Client Module；
- 展示服务器发送的 View，提交 Action 与房间控制 intent；
- 以 server-verified guest 读取私有比赛 metadata。

不负责：

- 判断 Action 是否合法；
- 计算 authoritative State 或 Outcome；
- 持有唯一比赛状态；
- 代理常驻 WebSocket 连接。

### 3.2 `apps/game-server`

作为服务端 composition root，负责：

- 启动 Colyseus 和注册具体游戏；
- 验证连接票据并映射 `PlayerSessionId`；
- 创建/加入房间、分配 `PlayerSlotId`，管理多轮、关闭和重连；
- 调用通用 game runtime 处理 Action；
- 组装内存 active `RoomStore`、PostgreSQL `ReplayStore` 和 Match archive adapter；
- 暴露健康检查与运行指标。

它可以依赖 server registry，但不得包含井字棋等具体规则。

无副作用的 `createGameServer(options)` 必须注入 `TicketVerifier`，默认组合 `InMemoryRoomStore`、`InMemoryReplayStore`、secure runtime ID source、结构化 logger 和内存 metrics；`start`/`stop` 显式控制生命周期，`port: 0` 支持无固定公共端口的测试。HTTP 使用 Colyseus 自带 router 暴露 `/health` 与 `/metrics`，WebSocket 使用 `@colyseus/ws-transport`。Express 只因该 transport 的运行时顶层 import 而由 app 拥有，不承载业务路由。

`createProductionGameServer(config, overrides?)` 在 composition layer 注入正式 HMAC ticket verifier、60 秒 reconnect、Web origin allowlist，以及按配置创建的 PostgreSQL client、`PostgresReplayStore` 和独立 `PostgresMatchArchive`。live `RoomStore` 始终是单独的内存 port，不再由 decorator 隐式写 Match。启动前显式把单实例遗留的旧 waiting/当前 active archive 标记 abandoned；`SIGINT`/`SIGTERM` 先停止 Colyseus 再关闭数据库连接。模块 import 不连接数据库、不迁移、不启动进程，生产模块不导入 `game-server-runtime/testing`。

## 4. Package 职责

| Package               | 职责                                                                                                             | 明确禁止                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `game-sdk`            | 离散 Action 游戏的纯类型契约、deterministic RNG、通用 slot/viewer/outcome 类型                                   | React、Next.js、DOM、Colyseus、WebSocket、数据库、具体游戏   |
| `game-client-sdk`     | Client Module contract、ticket provider、Colyseus client/room lifecycle、snapshot/command/control/reconnect host | authoritative 规则、服务端 State、具体游戏类型、数据库       |
| `game-server-runtime` | ticket/clock/store/observability ports、通用 Colyseus room、Action pipeline、多轮/关闭、比赛 lifecycle/reconnect | 具体游戏规则或对 `games/*` 的直接依赖                        |
| `game-server-ticket`  | Web issuer 与 Game Server verifier 共用的短期 HMAC-SHA256 ticket authority，实现 Protocol V5 ticket claims       | 浏览器 API、session cookie、房间/游戏规则、testing authority |
| `game-registry`       | 显式组合游戏 manifest、client loader 和 server definition                                                        | 游戏规则实现、运行时目录扫描                                 |
| `protocol`            | 跨 Web/Game Server 的 envelope、错误码、票据 claims 和 Zod schema                                                | 具体游戏 Action/State/View 联合类型                          |
| `database`            | PostgreSQL/Drizzle client、checked-in migrations、durable replay、Match archive/history 与 User association      | 具体游戏、规则执行、UI、active authoritative State           |
| `ui`                  | 无业务规则的共享视觉组件与 design tokens                                                                         | 网络、房间、游戏规则和数据库访问                             |

不创建 `packages/shared`。共享代码只有在所有权明确且出现真实复用后，才移动到职责具体的 package。

## 5. Game Package

每个 `games/<game-id>` 是一个 workspace package，而不是把所有游戏放入一个 package，也不把单个游戏拆成多个 workspace package。

```text
games/<game-id>/
  package.json
  src/
    core/
    client/
    manifest.ts
  tests/
  GAME_SPEC.md
  AGENTS.md
```

Package export map 提供：

- `/core`：服务器可用的 `GameDefinition` 与公开领域类型；
- `/client`：React Client Module，仅 Web 构建可加载；
- `/manifest`：无副作用、可序列化的目录元数据。

默认不创建游戏专属 Colyseus adapter。只有通用 runtime 无法表达、且经过架构评审确认的需求，才允许增加 server extension；扩展仍不得把 Colyseus 引入 Core。

每个游戏目录包含自己的规则说明和简短 `AGENTS.md`。游戏目录的 Agent 文档只补充该游戏特有不变量，不复制根规则。

## 6. 显式注册

`game-registry` 提供隔离的子路径：

- `/catalog`：纯 manifest 列表，供首页和工具读取；
- `/client`：按 `gameId` 懒加载 Client Module，避免首页打包全部游戏；
- `/server`：按 `gameId + gameVersion` 解析服务端 `GameDefinition`。

`game-registry` 是唯一允许指向所有具体游戏的 composition package。添加游戏需要新增游戏 package 并显式更新注册表；`tools/create-game` 只自动执行这些可见、可审查的机械步骤，不引入目录扫描或运行时插件发现。

每个 `GameManifest` 同时声明 JSON-safe `defaultConfig`。通用 Web 只把它作为创建房间的默认输入，runtime 仍使用 exact definition 的 `configSchema` 校验并保存 canonical Config；manifest contract test 要求默认值已规范化且 parse 后不变化。合法的非默认 Config 继续通过同一 create request 传递，不需要平台识别具体字段。

## 7. 依赖方向

```text
games/*/core ───────────────> game-sdk + zod
games/*/client ─────────────> own public types + game-client-sdk

game-client-sdk ────────────> protocol + Colyseus SDK
game-server-runtime ────────> game-sdk + protocol + Colyseus
game-server-ticket ─────────> protocol
game-registry ──────────────> games/* subpath exports
database ───────────────────> game-sdk + protocol + game-server-runtime ports
                              Drizzle ORM + Postgres.js

apps/web ───────────────────> game-registry/client + catalog
                              game-client-sdk + game-server-ticket + database

apps/game-server ───────────> game-registry/server
                              game-server-runtime + game-server-ticket + protocol + database
```

Hard Rules：

- `game-sdk`、`protocol`、`game-server-runtime` 不得依赖 `games/*`。
- 一个游戏不得依赖另一个游戏。
- Game Core 不得依赖 React、Next.js、DOM、Phaser、Colyseus、WebSocket、ORM、PostgreSQL 或 Redis。
- `ui` 不得依赖房间、网络或游戏业务模块。
- 只有 application/composition layer 可以同时看到具体实现和抽象端口。
- 不通过深层相对路径跨 package；只使用声明的 public exports。

具体 Core API 见 [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)，网络 envelope 见 [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md)。

## 8. Authoritative Action Pipeline

Game Server 对每个客户端 Action 严格按以下顺序处理：

1. 解析通用 protocol envelope；
2. 验证连接 session 和房间成员关系；
3. 从服务器连接映射 actor，不读取客户端声明的 actor；
4. 验证房间生命周期、席位、`roundNumber` 和 `expectedRevision`；
5. 使用已注册游戏的 Zod schema 解析 Action；
6. 调用 Game Core `transition`；
7. 若被拒绝，保持 State、revision 和 RNG cursor 不变；
8. 若被接受，提交新 State、推进 RNG cursor、递增 revision 并追加 replay event；
9. 调用 `projectView` 为每个玩家或观众生成完整 View；
10. 发送 snapshot，并在终局时固化 Outcome 和 replay。

Room 必须串行处理 Action。任何未来多实例方案都必须维持“一间房一个 authoritative writer”。

### 8.1 M3 实现不变量

- Room 创建时通过 registry 的 current resolver 先读取 catalog manifest，再按其 exact `gameId + gameVersion` 选择 definition，校验并保存规范化 Config；加入和 replay 继续使用 exact resolver。井字棋、四子棋、五子棋与黑白棋的 frozen `1.0.0` 和 current `1.1.0` definitions 同时注册，数组顺序不参与 current 选择；六贯棋只注册 `1.0.0`。创建只生成 room code 与 `maxPlayers` 个 stable slots，`currentRound = null`，不初始化 Core，不创建 Replay 或 Match。
- 井字棋、四子棋、五子棋、六贯棋和黑白棋都是 `minPlayers = maxPlayers = 2`；中国跳棋为 `minPlayers = 2`、`maxPlayers = 6`，并按本轮 `targetPlayerCount` 精确开局。stable slot 与 `PlayerSessionId` 映射在 live room 内保持不变；每轮有独立有序 `playerOrder`，由房主的 OWNER/NON_OWNER/RANDOM 选择和可选 assignment 顺序共同决定。RANDOM 通过本轮 seed 决定顺序但不推进交给 Core 的 RNG cursor；Core 初始化与 Replay header 必须使用完全相同的最终顺序。
- Colyseus join/leave/Action 共用每 room Promise queue；连接 session、active connection generation 和 slot ownership 都在进入 Core 前验证。
- accepted candidate 先以 `expectedSequence = current revision` append replay；终局再 complete replay；随后保存 candidate room record；三个 port 调用全部成功后才提交内存 aggregate、缓存结果和发送 snapshot。任一步失败都返回 `INTERNAL_ERROR`，不提前推进内存 State/RNG/revision。
- PostgreSQL replay append 在单事务中写 action 并推进 Match final revision；terminal complete 在单事务中写 RNG/Outcome 并把 Match 标记 completed。相同 header/action/completion 重试幂等，不同内容冲突失败；replay row lock 与 `(replay_id, sequence)` 主键串行化 concurrent append。
- live RoomStore 仍是进程内存；`MatchArchive` 与 `ReplayStore` 是独立 ports，生产 PostgreSQL implementations 虽共享数据库，但与内存 RoomStore 之间没有跨存储原子事务。Round 启动按 pending candidate → Core 初始化 → replay header → Match archive → RoomStore save → 内存 aggregate commit 排序；失败保留 candidate，依靠单 writer、数据库事务、唯一约束与幂等重试收敛。没有证据要求 outbox。
- command outcome cache 以 `PlayerSessionId + commandId` 为 key，Protocol V5 保留整个 live room lifetime，包括同房间后续轮次。旧轮重复命令返回带旧 `roundNumber` 的原结果，但不会再次进入 Core 或覆盖新轮 snapshot；后续长房间可在不小于重试窗口的前提下加入有界淘汰。
- 初连、lifecycle 激活、accepted Action、stale recovery、takeover reconnect 和 timeout abandonment 都只发送按当前连接单独调用 `projectView` 得到的完整 snapshot。

### 8.2 M4 Web 与 Client Host

- Next Proxy 在首次页面请求建立签名 `ogh_guest` cookie；Web 从可选的有效 `ogh_account` session 为 `POST /api/game-ticket` 签入可信 UserId。PlayerSessionId、UserId 和 signing secrets 都由服务器决定，浏览器不能提交或读取内部 identity。
- 首页和目录只从 `game-registry/catalog` 读取 manifest；游戏页使用 manifest 的 `defaultConfig` 创建房间，并从 `game-registry/client` 加载 Client Module，不导入 Core 或 server registry。
- Next App Router 以 `/games/[gameId]`、`/games/[gameId]/rooms/[roomCode]` 和 `/games/[gameId]/rooms/[roomCode]/play` 表达入口、等待和对局三个真实页面阶段。`GameClientHostProvider` 位于 `[gameId]/layout`，三个子路由共享同一 host，路由切换不重建连接或重复 join；旧 `/games/[gameId]?roomCode=...` 由服务端兼容重定向到规范房间 URL。
- 通用 `GameClientHost` 获取新 ticket 后调用 Colyseus `create`/`join`；join 在 SDK 调用前执行 `trim().toUpperCase()`。连接成功先以 `room.connected` 的 stable slot 和 `room.lifecycle` 为准；首局未启动时没有 snapshot，只有 active/completed Round 才有完整 `match.snapshot`。
- Web 只从当前非敏感 gameId/roomCode 构造 canonical invite URL，并通过 Clipboard API 提供 copying/copied/failed 和手动选择后备。lifecycle 的 waiting/next-round setup 映射到房间页，active 映射到 play，completed 保留在 play；closed 原因返回入口。刷新与 reconnect 都先由 host 收敛服务器 lifecycle，再决定规范路由。
- 对局页不复用等待页的邀请控件或额外连接详情；左侧共用 HUD 底部从 `room.roomCode` 显示房间码，在 active player 的 Client Module 暴露 `createResignAction` 时显示二次确认投降，并依据 server lifecycle 的 `isOwner` 选择 `closeRoom()` 或 `leaveRoom()`。投降确认后只调用 host `submitAction`；关闭/离开在 active Round 仍独立确认，UI 不自行裁定 resignation、关闭或 abandoned 结果。
- host 只保存当前 per-viewer View snapshot、`roomLifecycle`、round/revision、连接/拒绝状态。`submitAction` 生成 `commandId` 并从最新 lifecycle/snapshot 填充 `roundNumber` 和 `expectedRevision`；它不持有或重演 authoritative State。
- 所有 server payload 都先通过 Protocol V5 exact schema。duplicate、stale、schema-invalid 和 game-rule rejection 不在浏览器模拟；host 接受服务器附带或随后发送的完整 snapshot 收敛。
- transport 非主动关闭时，host 在 60 秒窗口内以指数退避获取新 ticket 并重新执行 room-code join，生成新的 seat reservation；不使用 SDK reconnection token 证明席位所有权。
- 井字棋 Client Module 只解析 View 并渲染 3×3 棋盘；四子棋 Client Module 不导入 Core，只解析 View 并渲染 7×6 棋盘；五子棋 Client Module 按 View 的 `boardSize` 渲染 15×15/19×19 棋盘；六贯棋 Client Module 渲染固定 11×11 菱形六边格；黑白棋 Client Module 渲染固定 8×8 View；中国跳棋 Client Module 渲染 73 位六芒星 View、合法跳跃目标和排名。各组件只提交自身普通落子或移动 intent，支持投降的 current modules 另以可选 `createResignAction` 向共用 HUD 提供 strict `RESIGN`，不各自实现投降按钮或确认；按钮禁用与确认仅是 UX，不能代替 authoritative rejection。

### 8.3 Live Room、Round 设置与关闭

- live room 属于 Platform，`Match`/canonical replay 属于 Round。房间级 record 只保存 room code、exact game/version、Config、stable slots、`currentRound | null` 和关闭状态；Round 独立保存 `roundNumber`、`playerOrder`、replay ID、State、RNG、revision、status 与 Outcome。
- 首局和 completed 后续局都进入相同 next-Round setup。房主可在参与者加入前用 `SELECT_STARTER` 选择 OWNER/NON_OWNER/RANDOM；参与者用 `READY_FOR_ROUND`/`CANCEL_ROUND_READY`。支持 assignment 的游戏还要求房主选择精确人数、每个参与者选择唯一 assignment。不同选择清空全部 ready，重复同值不清；断线和 connection takeover 只清对应 session ready，保留 starter/assignment。只有规定 slots 全部分配、参与者在线、starter 已选且全部 ready 时才启动。completed 后任一原玩家也可发送 `START_REMATCH`，在参与者仍在线时复用上一轮实际 playerOrder 立即创建独立新 Round。
- 成功启动后清除 starter/ready 并取消 completed TTL；Round 完成后立刻为下一轮把 starter 重置为 null。选择或 ready 不延长 5 分钟 completed TTL。completed room 拒绝任何未占原 slot 的新 session，返回 `ROOM_NOT_JOINABLE`。
- `GameClientHost.selectStarter()`、`readyForRound()`、`cancelRoundReady()`、`startRematch()` 和 `closeRoom()` 只发送 intent。房主权限始终绑定 creator session，不随本轮先后手改变。非房主使用 `leaveRoom()` 执行 consented leave；active 状态下 Web 先确认并把当前 Match 保存为 `abandoned`。首局未开始时关闭/离开不创建 abandoned Match，completed 保留原 Outcome。
- 关闭先广播带 `OWNER_CLOSED`、`PLAYER_LEFT`、`RECONNECT_TIMEOUT` 或兼容名称 `REMATCH_TIMEOUT` 的 per-viewer lifecycle，再用 25 ms 有界 drain 发送并断开 clients。`GameActionCommand.roundNumber` 与 `MatchSnapshot.roundNumber` 在 Protocol V5 中必填；Host 进入更高 Round 时清除旧 snapshot，completed 等待设置时保留终局 snapshot，并对任何 snapshot/lifecycle 非法顺序 fail closed。Protocol V5 wire 本身不决定 game version；当前规则版本仍使用同一 envelope 和 Replay Format V1。

### 8.4 M5/M7-A 持久化、Identity 与 History

- `packages/database` 是唯一 PostgreSQL/Drizzle owner，提供显式可关闭 client、checked-in SQL migration、`PostgresReplayStore`、`PostgresMatchRepository`、独立 `PostgresMatchArchive` 与 `PostgresUserRepository`。它不依赖具体游戏；`game-server-runtime` 不依赖 database、Drizzle 或 PostgreSQL。
- schema 包含 `users`、`password_credentials`、`account_sessions`、`replays`、`replay_actions`、`matches`、`match_players`。Match 不保存 authoritative State 或游戏专属列；canonical Config/Action/Outcome/seed 只存在受保护 replay 表，所有 JSONB 在写入前和读取后经过通用 runtime validation。
- `matches` 使用正整数 `round_number`，并以 `(runtime_room_id, round_number)` 唯一；同一 live room 的每轮拥有不同 Match/replay。只有 Round 真正启动时才插入 active Match/MatchPlayer，待开局 room/setup 不持久化。后续轮 transaction 取得 runtime-room advisory lock，要求上一轮 completed、轮次连续、game/version 与 slot/session 参与者集合完全一致，再插入新 active Match；参与者集合不因 `playerOrder` 反转而改变。旧 waiting rows 继续兼容读取/启动协调，无需 migration。
- `match_players` 以 `(match_id, player_slot_id)` 为主键并约束同场 participant 唯一；原始 `PlayerSessionId` 只用于服务器内部参与者一致性，不进入公共 response、日志或错误。M7-A 删除旧 `guest_user_associations` 回填路径；Round 创建直接保存 slot 在开始时已快照的可选 UserId，save/complete/归档重试只能验证既有值，不能重新查询当前登录态或补写。
- reconnect/takeover 必须同时匹配 PlayerSessionId 与原 slot UserId。注册、登录、退出或账户 session 失效都会轮换 guest session，因此 live seat 不能匿名升级、账户降级或换号接管。同一房间后续 Round 沿用 stable slot 身份。
- Web 的 `GET /api/matches` 只从经 HMAC 验证的 `ogh_guest` 推导 identity，每次请求创建并关闭自己的 server-only database client。结果最多 50 条，按 `createdAt DESC, matchId DESC` 稳定排序，只返回含 `roundNumber` 的平台 metadata；canonical replay、Config、Action、Outcome、seed、State、其他参与者和内部 room ID 都不返回。
- PostgreSQL 是唯一生产数据库，`DATABASE_MODE=memory` 只允许 development/test 且明确无 durable history。migration 只能通过运维命令显式执行，应用 import/start 不自动迁移；`DATABASE_URL` 不进入浏览器 bundle、结构化日志或错误 response。

### 8.4.1 Account Profile Boundary

- `users.display_name` 是非空账户资料字段。迁移先添加可空列，再从 `password_credentials.username` 回填；无法关联凭证的旧用户回填“游客”，最后设置 `NOT NULL` 和数据库长度检查。
- `PublicAccount`、登录/注册和 `GET /api/auth/me` 返回 `username` 与 `displayName`。同源 JSON `PATCH /api/auth/profile` 只接受严格的 `{ displayName }`，由当前有效账户 session 授权后更新对应 UserId；伪造 `userId`、额外字段、非 JSON、非同源和失效 session 均拒绝。
- Web Client 的 `ProfileMenu` 只负责资料展示、输入交互和游客 `localStorage`；服务器负责规范化、账户授权与 PostgreSQL 持久化。登录账户和游客 key 分离，身份轮换不迁移资料。头像规则属于 Web profile utility，不属于 Game Core、Protocol、ticket、room、match 或 replay contract。
- 资料更新沿用认证 API 的 `no-store, private` 与 `Vary: Cookie` 响应头，并在失效 session 时清理账户/guest cookies。读取 session 时通过账户仓储 join `users` 载入最新 `displayName`，因此新连接和跨设备请求能读取同一资料。

### 8.5 M6 插件扩展性实证

- 四子棋、五子棋、额外六贯棋与黑白棋都只通过 `game-registry` 显式加入 catalog、lazy client loader、exact/current server resolver；没有运行时目录扫描，游戏之间没有依赖。
- 五子棋 package 自身为 16 个文件，拥有 15×15/19×19 Config、manifest、Core、Client Module、局部文档、unit/client/golden tests；规则 Core 只依赖 `game-sdk` 与 Zod。
- 六贯棋 package 同样为 16 个文件，拥有固定 11×11 六边邻接、连接/投降 Outcome、canonical BFS path、manifest、Core、Client Module、局部文档和 unit/client/golden tests；Core 仍只依赖 `game-sdk` 与 Zod。
- 黑白棋 package 同样为 16 个文件，拥有固定 8×8、八方向翻转、强制跳过、非满盘终局、manifest、Core、Client Module、局部文档和 unit/client/golden tests；Core 仍只依赖 `game-sdk` 与 Zod。
- M6 当时的 Protocol V1 `initialConfig: unknown`、definition `configSchema`、room/replay canonical Config 和 exact resolver 无需变化即可处理 `{ boardSize: 15 | 19, winLength: 5 }`。通用 Web 原先固定传 `null`，无法发现每游戏默认值，因此 `GameManifest` 新增必填 JSON-safe `defaultConfig`；该 shared API 迁移同步更新全部 manifest、消费者、contract tests 与文档。当前 Protocol V5 保留相同 Config envelope。
- 六贯棋直接使用 `defaultConfig: null` 和现有 opaque Action envelope；其上线阶段对 `game-sdk`、当时的 Protocol V1、Replay Format V1、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 均零修改。后续 Protocol V2 只改变平台逐局设置，Replay Format V1 与全部既有游戏版本保持兼容。
- 黑白棋同样直接使用 `defaultConfig: null` 和现有 opaque Action envelope。一次 accepted placement 内完成全部翻转和跳过判断；只有该 placement 递增一次 revision 并进入 replay，平台不理解 PASS 或翻转列表。`game-sdk`、`protocol`、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 继续零修改。
- 通用 Action pipeline、`projectView`、replay verifier、PostgreSQL adapters、多轮/关闭/reconnect 行为没有 `connect-four`、`gomoku`、`hex` 或其他 gameId 规则分支。真实 Colyseus integration 直接验证六贯棋 21-action 第三轴连接胜局、同房间第二轮再次选择相同先手时的角色一致性与 off-turn `RESIGN`；另以四游戏 table 验证 current `1.1.0` 的正常 Action 后同 actor off-turn `RESIGN`、单次 revision、completed、对手 WIN 和 exact replay verification。
- 井字棋、四子棋、五子棋与黑白棋 current `1.1.0` 统一增加 strict `RESIGN`、State `resignedSlotId` 与 `RESIGNATION` WIN；普通落子规则保持不变。各自 frozen `1.0.0` definition 是不 alias current 的独立对象，继续拒绝 `RESIGN` 并重建原 golden replay。Hex Core、算法与 `gameVersion 1.0.0` 不变。
- presentation 仍需在 Next transpile allowlist 与 Web 全局 CSS 显式登记；通用 `GameRoomPage` 继续只按稳定领域错误码提供少量文案映射，没有新增 gameId 规则分支。
- 黑白棋涉及游戏外非文档 10 个唯一文件：registry package/catalog/client/server、lockfile、Next transpile 共 6 个机械登记文件，CSS 1 个，registry/integration/E2E 验证 3 个。连续多个游戏证明 package 骨架和登记步骤稳定后，窄版 `tools/create-game` 已作为独立工具实现；规则、样式与验收序列继续由游戏 owner 设计。

### 8.6 `tools/create-game` 边界

- 工具是独立 workspace package，接入既有 Turbo `build`、`typecheck`、`test` 图；根命令只负责非交互参数与稳定退出码。
- gameId 经严格 lowercase kebab-case、路径/保留名、workspace package、manifest id 和确定性 export symbol preflight；`sample-game` 固定推导 `sampleGameManifest`、`sampleGameDefinition` 与 `sampleGameClientModule`。符号碰撞即使 package path 不同也 fail closed。
- 生成内容仅为 package/export map、TypeScript configs、必要目录和未完成说明；manifest、Config、玩家数、capabilities、规则 Core、Client、CSS、golden 与纵切序列不属于模板。
- registry package dependency、catalog、lazy client loader、exact/current server definitions 和 Next transpile 继续使用显式静态条目。固定 marker 只是开发工具的审查锚点，不参与应用运行，也不构成插件发现协议。
- preflight 在任何写入前构造全部目标内容。完整重复输入为零写入；已有内容冲突、重复条目或部分登记均拒绝。写入阶段记录原文件，仅由 workspace root 固定 pnpm 执行离线 lockfile-only 更新；失败恢复原登记与 lockfile，并只清理本轮已确认创建的目标目录。
- 新骨架在 owner 完成 manifest/Core/Client/文档/样式/unit/golden/integration/E2E 前有意不可构建为可玩游戏，也不满足 Plugin Definition of Done。工具没有改变当时的 Protocol V2、Replay Format V1、database schema、既有 gameVersion 或任何平台 public runtime API。

## 9. 存储与部署

### 9.1 V1 基线

- `apps/web` 与 `apps/game-server` 是两个独立服务。
- 单区域、单个 Game Server 实例。
- 根 `docker-compose.yml` 提供通用单机部署基线：独立 Web、Game Server、一次性 migration 和 PostgreSQL 容器；应用使用 CI 发布的 Docker Hub 镜像，PostgreSQL 使用可备份迁移的宿主数据目录，部署主机不需要源码。
- Web 通过环境注入浏览器可达的 Game Server public URL；Game Server 通过环境注入允许的 Web origins 和与 Web 一致的 ticket issuer/secret。
- live `RoomStore` 使用内存 adapter；Replay、Match archive 与完成历史使用独立 PostgreSQL adapters。
- 默认重连宽限为 60 秒；同一 session 通过新 ticket 和新的 Colyseus seat reservation 接管 stable slot，旧连接立即失去 writer 权限。超时策略为 `abandoned`。
- 同一 live room 可以顺序承载多轮，但每轮 Match/replay 独立；completed room 的 live TTL 为 5 分钟，且不再接纳新参与者。
- 服务器重启会丢失 live room、待开局设置、State、socket 与 reconnect timer；已完成 replay/history 保留。启动协调只把旧 waiting/当前 active archive 标记 abandoned。
- 不引入 Redis、Kubernetes 或服务网格。

### 9.2 扩容路径

出现真实容量或高可用需求后：

1. 将房间分配和 presence 切换到 Colyseus 支持的共享 driver/presence；
2. 引入 Redis，但只承担 presence、协调或短期缓存，不成为游戏规则来源；
3. 已使用 PostgreSQL adapter 持久化比赛、玩家和 replay；未来扩容必须在此基础上增加明确 room ownership；
4. 确保同一 room 始终路由到唯一 owner process；
5. 在指标证明需要前，不拆分更多微服务或多区域写入。

## 10. 架构决策状态

### 10.1 已确定

- pnpm workspace + Turborepo + strict TypeScript；
- Next.js App Router Web 与独立 Colyseus Game Server；
- PostgreSQL + Drizzle schema、migrations 与持久化 adapters；
- server-authoritative、deterministic Core、Replay First；
- 每游戏单 package、子路径隔离和显式类型化注册表；
- Zod 负责不可信边界的运行时校验；
- 完整的 per-viewer snapshot，而不是 V1 patch 或纯 Action 广播；
- 匿名 guest session、短期连接票据和 60 秒重连宽限；
- 首局无 snapshot、逐局先手选择、同一 live room 多轮、双方 ready、房主关闭、非房主离开和 terminal TTL；
- V1 单实例单区域；active RoomStore 为内存，完成 archive/replay 为 PostgreSQL；
- Docker Compose 单机部署使用 CI 发布的多架构生产镜像、显式 migration、服务 healthcheck 和 PostgreSQL 宿主数据目录。
- 用户名+密码账户使用独立 `password_credentials` 与 `account_sessions` 表；session token 只以 SHA-256 hash 存储，Argon2id 负责密码 hash。
- Protocol V5 ticket 可选携带可信 `userId`。slot 保存 `{ playerSessionId, userId }` 私有快照；Round 开始时写入 `match_players.user_id`，之后不重新查询登录态。
- 游客可玩但无历史；账户注册/登录不认领旧游客比赛。M7-B replay API 仅允许当前账户参赛且 Match/replay 均 completed，并返回服务端逐帧 `projectView`；浏览器不接收 canonical replay、seed、raw State 或 Actions。

### 10.2 暂缓

- 具体云平台和公网域名/TLS 拓扑；
- 邮箱/OAuth、找回密码和账户删除策略；
- Redis driver/presence 的选择与部署；
- Matchmaking、观战延迟、公开 replay 权限；
- realtime runtime contract；
- game generator 的具体 CLI 和模板格式。

### 10.3 当前不做

- 邮箱/OAuth/找回密码、公开历史、公开 replay、观战、分享和下载；
- durable active room、公开 replay、通用数据删除产品；
- 并行开发多个新游戏；
- Redis、Kubernetes、多区域或微服务化；
- 为实时游戏、复杂卡牌或几十种游戏预先构造统一大接口。

## 11. 主要架构风险

| 风险                        | 影响                                                     | 当前控制措施                                                                                            |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Game Plugin 过早抽象        | 隐藏信息或实时游戏可能迫使接口复杂化                     | V1 只处理离散 Action；仅预留 `projectView`，实时游戏使用独立 runtime family                             |
| `gameVersion` 长期兼容      | replay 读取代码和测试矩阵会持续增长                      | 精确钉住版本、保留 golden replay，并在删除旧实现前迁移稳定归档                                          |
| Colyseus 生命周期与扩容耦合 | 重连、per-viewer snapshot 和多实例可能破坏 single-writer | Core 与 Colyseus 隔离，通过 runtime adapter 和 store ports 组合；扩容前先验证 ownership                 |
| Web/Game Server 密钥误配    | ticket 无法验证或错误环境共享身份信任域                  | 独立 32-byte secrets、严格 issuer/audience/config validation；后续再设计轮换基础设施                    |
| Live room 不持久化          | Game Server 重启会终止待开局设置或 active 对局           | 只对已存在的 active/旧 waiting archive 标记 abandoned；不宣称恢复 State，durable RoomStore 留待真实需求 |
| 单实例启动协调              | 多实例同时启动会误标其他实例的 active archive            | M5 明确只支持单实例；引入多实例前必须设计 ownership/presence，不能复用当前全局协调                      |

## 12. 共享 API 变更政策

修改 `game-sdk`、`protocol`、`game-client-sdk`、`game-server-ticket` 或 `game-server-runtime` 的公开 API 时必须：

1. 说明改变的架构理由和兼容性影响；
2. 同步更新其权威文档；
3. 更新所有注册游戏和消费方；
4. 添加或更新 contract/integration tests；
5. 对影响 replay 的变更明确 `gameVersion` 或 `replayFormatVersion` 策略。

仅为了减少少量重复，不足以成为新增共享抽象或依赖的理由。
