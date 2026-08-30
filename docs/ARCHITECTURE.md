# 系统架构

> 状态：架构基线（V1，M5 持久化与账号基础已实现）
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
- 建立匿名访客 session；
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

它可以依赖 server registry，但不得包含 Tic-Tac-Toe 等具体规则。

无副作用的 `createGameServer(options)` 必须注入 `TicketVerifier`，默认组合 `InMemoryRoomStore`、`InMemoryReplayStore`、secure runtime ID source、结构化 logger 和内存 metrics；`start`/`stop` 显式控制生命周期，`port: 0` 支持无固定公共端口的测试。HTTP 使用 Colyseus 自带 router 暴露 `/health` 与 `/metrics`，WebSocket 使用 `@colyseus/ws-transport`。Express 只因该 transport 的运行时顶层 import 而由 app 拥有，不承载业务路由。

M5 的 `createProductionGameServer(config, overrides?)` 在 composition layer 注入正式 HMAC ticket verifier、60 秒 reconnect、Web origin allowlist，以及按配置创建的 PostgreSQL client、`PostgresReplayStore` 和 Match archive decorator。启动前显式把单实例遗留的 waiting/active archive 标记 abandoned；`SIGINT`/`SIGTERM` 先停止 Colyseus 再关闭数据库连接。模块 import 不连接数据库、不迁移、不启动进程，生产模块不导入 `game-server-runtime/testing`。

## 4. Package 职责

| Package               | 职责                                                                                                             | 明确禁止                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `game-sdk`            | 离散 Action 游戏的纯类型契约、deterministic RNG、通用 slot/viewer/outcome 类型                                   | React、Next.js、DOM、Colyseus、WebSocket、数据库、具体游戏   |
| `game-client-sdk`     | Client Module contract、ticket provider、Colyseus client/room lifecycle、snapshot/command/control/reconnect host | authoritative 规则、服务端 State、具体游戏类型、数据库       |
| `game-server-runtime` | ticket/clock/store/observability ports、通用 Colyseus room、Action pipeline、多轮/关闭、比赛 lifecycle/reconnect | 具体游戏规则或对 `games/*` 的直接依赖                        |
| `game-server-ticket`  | Web issuer 与 Game Server verifier 共用的短期 HMAC-SHA256 ticket authority，实现 Protocol V1 ticket claims       | 浏览器 API、session cookie、房间/游戏规则、testing authority |
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

`game-registry` 是唯一允许指向所有具体游戏的 composition package。添加游戏需要新增游戏 package 并显式更新注册表；未来 `tools/create-game` 只自动执行这些可见、可审查的机械步骤，不引入运行时插件发现。

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

- Room 创建时通过 registry 的 current resolver 选择一个 exact `gameId + gameVersion`，校验并保存规范化 Config；加入和 replay 继续使用 exact resolver。
- Room 在 Core 初始化前预分配 `maxPlayers` 个服务器生成的 stable slots；客户端请求没有 `gameVersion`、slot 或内部 `roomId` 字段。Tic-Tac-Toe 与 Connect Four 1.0.0 都是 `minPlayers = maxPlayers = 2`，第二个有效 session 连接后从 `waiting` 进入 `active`。
- Colyseus join/leave/Action 共用每 room Promise queue；连接 session、active connection generation 和 slot ownership 都在进入 Core 前验证。
- accepted candidate 先以 `expectedSequence = current revision` append replay；终局再 complete replay；随后保存 candidate room record；三个 port 调用全部成功后才提交内存 aggregate、缓存结果和发送 snapshot。任一步失败都返回 `INTERNAL_ERROR`，不提前推进内存 State/RNG/revision。
- PostgreSQL replay append 在单事务中写 action 并推进 Match final revision；terminal complete 在单事务中写 RNG/Outcome 并把 Match 标记 completed。相同 header/action/completion 重试幂等，不同内容冲突失败；replay row lock 与 `(replay_id, sequence)` 主键串行化 concurrent append。
- active RoomStore 仍是进程内存，Match archive decorator 与 PostgreSQL replay 虽共享数据库，但 runtime port 调用和内存 delegate 之间没有跨存储原子事务。当前依靠单 writer、数据库事务、唯一约束与幂等重试收敛；没有证据要求 outbox，因此 M5 不引入通用事件总线或队列。
- command outcome cache 以 `PlayerSessionId + commandId` 为 key，V1 保留整个 live room lifetime，包括同房间后续轮次。旧轮重复命令返回带旧 `roundNumber` 的原结果，但不会再次进入 Core 或覆盖新轮 snapshot；后续长房间可在不小于重试窗口的前提下加入有界淘汰。
- 初连、lifecycle 激活、accepted Action、stale recovery、takeover reconnect 和 timeout abandonment 都只发送按当前连接单独调用 `projectView` 得到的完整 snapshot。

### 8.2 M4 Web 与 Client Host

- Next Proxy 在首次页面请求建立签名 `ogh_guest` cookie；`POST /api/game-ticket` 从服务器验证或创建的 session 签发短期 ticket。session ID 和两个 signing secret 都由服务器配置决定，浏览器不能选择或通过独立字段读取 `PlayerSessionId`。
- 首页和目录只从 `game-registry/catalog` 读取 manifest；游戏页从 `game-registry/client` 加载 Client Module，不导入 Core 或 server registry。
- 通用 `GameClientHost` 获取新 ticket 后调用 Colyseus `create`/`join`；join 在 SDK 调用前执行 `trim().toUpperCase()`。连接成功以 `room.connected` 的 stable slot 和完整 `match.snapshot` 为准。
- host 只保存当前 per-viewer View snapshot、`roomLifecycle`、round/revision、连接/拒绝状态。`submitAction` 生成 `commandId` 并从最新 lifecycle/snapshot 填充 `roundNumber` 和 `expectedRevision`；它不持有或重演 authoritative State。
- 所有 server payload 都先通过 Protocol V1 schema。duplicate、stale、schema-invalid 和 game-rule rejection 不在浏览器模拟；host 接受服务器附带或随后发送的完整 snapshot 收敛。
- transport 非主动关闭时，host 在 60 秒窗口内以指数退避获取新 ticket 并重新执行 room-code join，生成新的 seat reservation；不使用 SDK reconnection token 证明席位所有权。
- Tic-Tac-Toe Client Module 只解析 View，渲染 3×3 棋盘并提交 `{ type: "PLACE_MARK", cell }`；Connect Four Client Module 不导入 Core，只解析 View、渲染 7×6 棋盘并提交 `{ type: "DROP_DISC", column }`。两者都不计算 authoritative 落点/Outcome/revision；按钮禁用仅是 UX，不能代替 authoritative rejection。

### 8.3 同房间多轮与关闭

- live room 属于 Platform，`Match`/canonical replay 属于一轮。首轮完成后保留 room code、原 `PlayerSessionId → PlayerSlotId` 映射和游戏 Config；双方仍在线并都 ready 时，runtime 创建新 RNG/replay，把 `roundNumber` 加一并从 revision `0` 初始化新 State。Game Core 不知道 room 或 rematch。
- `room.control` 是 Protocol V1 的向后兼容扩展，只包含 `REQUEST_REMATCH`、`CANCEL_REMATCH`、`CLOSE_ROOM`。ready 可取消，断线、主动离开和 connection takeover 都清除该 session 的 ready；新轮开始后清空全部 ready。completed room 拒绝任何未占原 slot 的新 session，返回 `ROOM_NOT_JOINABLE`。
- `GameClientHost.closeRoom()` 只供房主发出关闭 intent；房主可关闭 waiting、active 或 completed room。非房主使用 `leaveRoom()` 执行 consented leave。active 状态下 Web 先确认，服务端随后把该轮保存为 `abandoned`；waiting 同样 abandoned，completed 保留原 Outcome。`close()` 仅关闭组件/刷新对应的 transport，使用 non-consented leave 以保留 60 秒重连，不能当作主动离开。
- 关闭先广播带 `OWNER_CLOSED`、`PLAYER_LEFT`、`RECONNECT_TIMEOUT` 或 `REMATCH_TIMEOUT` 的 per-viewer `room.lifecycle`，再用 25 ms 有界 drain 让 WebSocket 发送完成并断开 clients。completed room 5 分钟未开启下一轮会自动关闭；reconnect timeout 会 abandoned 当前轮并关闭 live room。客户端清除 URL room code 和本地 room state，回到创建/加入入口。
- `GameActionCommand.roundNumber` 与 `MatchSnapshot.roundNumber` 是 Protocol V1 可选兼容字段：新 host/server 始终发送，旧 V1 首轮缺失时按 `1` 处理；第二轮起缺失或错轮命令以 `STALE_REVISION` 和当前 snapshot fail closed。Host 忽略低于当前 lifecycle 的旧轮 snapshot，拒绝领先 lifecycle 的 snapshot。该 transport 扩展不改变 canonical replay，因此不提升 protocol/replay/game version。

### 8.4 M5 持久化、Identity 与 History

- `packages/database` 是唯一 PostgreSQL/Drizzle owner，提供显式可关闭 client、checked-in SQL migration、`PostgresReplayStore`、`PostgresMatchRepository`、Match archive `RoomStore` decorator 与 `PostgresUserRepository`。它不依赖具体游戏；`game-server-runtime` 不依赖 database、Drizzle 或 PostgreSQL。
- schema 包含 `users`、`guest_user_associations`、`replays`、`replay_actions`、`matches`、`match_players`。Match 不保存 authoritative State 或游戏专属列；canonical Config/Action/Outcome/seed 只存在受保护 replay 表，所有 JSONB 在写入前和读取后经过通用 runtime validation。
- `matches` 使用正整数 `round_number`，并以 `(runtime_room_id, round_number)` 唯一；同一 live room 的每轮拥有不同 Match/replay。创建后续轮次时 PostgreSQL transaction 取得 runtime-room advisory lock，要求上一轮 completed、轮次连续、game/version 与 slot/session 参与者完全一致，再插入新 active Match。Replay header create 可先于该事务幂等发生；active RoomStore 与 PostgreSQL 之间仍无跨存储原子性。
- `match_players` 以 `(match_id, player_slot_id)` 为主键并约束同场 participant 唯一；原始 `PlayerSessionId` 只用于服务器授权索引，不进入公共 response、日志或错误。`guest_user_associations` 通过 transaction advisory lock、唯一键和 FK 实现同 guest→同 User 幂等、跨 User 冲突拒绝，并事务化回填既有 MatchPlayer；没有可信认证来源时不暴露浏览器 claim endpoint。
- Web 的 `GET /api/matches` 只从经 HMAC 验证的 `ogh_guest` 推导 identity，每次请求创建并关闭自己的 server-only database client。结果最多 50 条，按 `createdAt DESC, matchId DESC` 稳定排序，只返回含 `roundNumber` 的平台 metadata；canonical replay、Config、Action、Outcome、seed、State、其他参与者和内部 room ID 都不返回。
- PostgreSQL 是唯一生产数据库，`DATABASE_MODE=memory` 只允许 development/test 且明确无 durable history。migration 只能通过运维命令显式执行，应用 import/start 不自动迁移；`DATABASE_URL` 不进入浏览器 bundle、结构化日志或错误 response。

### 8.5 M6 Connect Four 插件扩展性实证

- Connect Four 作为第二个游戏只通过 `game-registry` 显式加入 catalog、lazy client loader、exact/current server resolver；没有运行时目录扫描。
- 游戏外非文档改动为 12 个文件：registry dependency/catalog/client/server、Next transpile 与 lockfile 6 个机械登记，Web presentation CSS 1 个，以及 registry、Colyseus、PostgreSQL、Playwright、repository-check 5 个测试文件。游戏 package 自身为 16 个文件。
- `game-sdk`、`protocol`、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 均零修改；Protocol V1、Replay Format V1 和 Tic-Tac-Toe 1.0.0 保持兼容。
- 通用 Action pipeline、`projectView`、replay verifier、PostgreSQL adapters、多轮/关闭/reconnect 行为没有 `connect-four` 或第二游戏分支。repository-check 原有按 package 分类的 alpha↔beta fixture 同时证明跨游戏依赖与 registry 外具体游戏组合 fail closed。
- 发现的 presentation 摩擦是 Next transpile allowlist 与 Web 全局游戏 CSS 仍需显式登记；此外通用 `GameRoomPage` 在 M4 已有 Tic-Tac-Toe `CELL_OCCUPIED` 规则文案映射。本轮没有加入 Connect Four 规则文案映射或扩大 Client Module API；第三游戏若再次需要结构化规则文案或 package-owned styles，再评估通用契约。
- 两个游戏不足以冻结脚手架模板，`tools/create-game` 继续暂缓到 Gomoku Config 验证之后。

## 9. 存储与部署

### 9.1 V1 基线

- `apps/web` 与 `apps/game-server` 是两个独立服务。
- 单区域、单个 Game Server 实例。
- 根 `compose.yaml` 提供 WSL2/单机部署基线：独立 Web、Game Server、一次性 migration 和 PostgreSQL 容器；PostgreSQL 使用 named volume，运行时不 bind mount 源码。
- Web 通过环境注入浏览器可达的 Game Server public URL；Game Server 通过环境注入允许的 Web origins 和与 Web 一致的 ticket issuer/secret。
- active `RoomStore` 使用内存 delegate；Replay、Match archive 与完成历史使用 PostgreSQL adapter。
- 默认重连宽限为 60 秒；同一 session 通过新 ticket 和新的 Colyseus seat reservation 接管 stable slot，旧连接立即失去 writer 权限。超时策略为 `abandoned`。
- 同一 live room 可以顺序承载多轮，但每轮 Match/replay 独立；completed room 的 live TTL 为 5 分钟，且不再接纳新参与者。
- 服务器重启会丢失活动房间、State、socket 与 reconnect timer；已完成 replay/history 保留。启动协调只把遗留 waiting/active archive 标记 abandoned。
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
- 同一 live room 多轮、双方 ready、房主关闭、非房主离开和 terminal TTL；
- V1 单实例单区域；active RoomStore 为内存，完成 archive/replay 为 PostgreSQL；
- Docker Compose 单机部署使用生产构建镜像、显式 migration、服务 healthcheck 和 PostgreSQL named volume。

### 10.2 暂缓

- 具体云平台和公网域名/TLS 拓扑；
- 账号认证供应商和跨设备 identity 恢复；
- Redis driver/presence 的选择与部署；
- Matchmaking、观战延迟、公开 replay 权限；
- realtime runtime contract；
- game generator 的具体 CLI 和模板格式。

### 10.3 当前不做

- 正式账号登录、OAuth、Lobby、Matchmaking、排行榜或大量 UI；
- durable active room、公开 replay、replay 播放器或通用数据删除产品；
- Gomoku 或并行开发多个游戏；
- Redis、Kubernetes、多区域或微服务化；
- 为实时游戏、复杂卡牌或几十种游戏预先构造统一大接口。

## 11. 主要架构风险

| 风险                        | 影响                                                     | 当前控制措施                                                                            |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Game Plugin 过早抽象        | 隐藏信息或实时游戏可能迫使接口复杂化                     | V1 只处理离散 Action；仅预留 `projectView`，实时游戏使用独立 runtime family             |
| `gameVersion` 长期兼容      | replay 读取代码和测试矩阵会持续增长                      | 精确钉住版本、保留 golden replay，并在删除旧实现前迁移稳定归档                          |
| Colyseus 生命周期与扩容耦合 | 重连、per-viewer snapshot 和多实例可能破坏 single-writer | Core 与 Colyseus 隔离，通过 runtime adapter 和 store ports 组合；扩容前先验证 ownership |
| Web/Game Server 密钥误配    | ticket 无法验证或错误环境共享身份信任域                  | 独立 32-byte secrets、严格 issuer/audience/config validation；后续再设计轮换基础设施    |
| Active room 不持久化        | Game Server 重启会终止 waiting/active 对局               | 启动时诚实标记 archive abandoned；不宣称恢复 State，durable RoomStore 留待真实需求      |
| 单实例启动协调              | 多实例同时启动会误标其他实例的 active archive            | M5 明确只支持单实例；引入多实例前必须设计 ownership/presence，不能复用当前全局协调      |

## 12. 共享 API 变更政策

修改 `game-sdk`、`protocol`、`game-client-sdk`、`game-server-ticket` 或 `game-server-runtime` 的公开 API 时必须：

1. 说明改变的架构理由和兼容性影响；
2. 同步更新其权威文档；
3. 更新所有注册游戏和消费方；
4. 添加或更新 contract/integration tests；
5. 对影响 replay 的变更明确 `gameVersion` 或 `replayFormatVersion` 策略。

仅为了减少少量重复，不足以成为新增共享抽象或依赖的理由。
