# 系统架构

> 状态：架构基线（V1，M3 authoritative runtime 已实现）  
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
- 展示服务器发送的 View 并提交 Action intent。

不负责：

- 判断 Action 是否合法；
- 计算 authoritative State 或 Outcome；
- 持有唯一比赛状态；
- 代理常驻 WebSocket 连接。

### 3.2 `apps/game-server`

作为服务端 composition root，负责：

- 启动 Colyseus 和注册具体游戏；
- 验证连接票据并映射 `PlayerSessionId`；
- 创建/加入房间、分配 `PlayerSlotId` 和管理重连；
- 调用通用 game runtime 处理 Action；
- 组装 `RoomStore`、`ReplayStore` 和未来持久化 adapter；
- 暴露健康检查与运行指标。

它可以依赖 server registry，但不得包含 Tic-Tac-Toe 等具体规则。

M3 的 composition root 是无副作用的 `createGameServer(options)`：必须注入 `TicketVerifier`，默认组合 `InMemoryRoomStore`、`InMemoryReplayStore`、secure runtime ID source、结构化 logger 和内存 metrics；`start`/`stop` 显式控制生命周期，`port: 0` 支持无固定公共端口的测试。HTTP 使用 Colyseus 自带 router 暴露 `/health` 与 `/metrics`，WebSocket 使用 `@colyseus/ws-transport`。Express 只因该 transport 的运行时顶层 import 而由 app 拥有，不承载业务路由。

## 4. Package 职责

| Package               | 职责                                                                                                  | 明确禁止                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `game-sdk`            | 离散 Action 游戏的纯类型契约、deterministic RNG、通用 slot/viewer/outcome 类型                        | React、Next.js、DOM、Colyseus、WebSocket、数据库、具体游戏 |
| `game-client-sdk`     | 游戏 Client Module 契约、客户端连接状态与通用 hooks                                                   | authoritative 规则、服务端 State、数据库                   |
| `game-server-runtime` | ticket/clock/store/observability ports、通用 Colyseus room、Action pipeline、比赛 lifecycle/reconnect | 具体游戏规则或对 `games/*` 的直接依赖                      |
| `game-registry`       | 显式组合游戏 manifest、client loader 和 server definition                                             | 游戏规则实现、运行时目录扫描                               |
| `protocol`            | 跨 Web/Game Server 的 envelope、错误码、票据 claims 和 Zod schema                                     | 具体游戏 Action/State/View 联合类型                        |
| `database`            | 未来的 Drizzle client、schema、migration 与 repository adapter                                        | 游戏规则和 UI；V1 不创建实现                               |
| `ui`                  | 无业务规则的共享视觉组件与 design tokens                                                              | 网络、房间、游戏规则和数据库访问                           |

不创建 `packages/shared`。共享代码只有在所有权明确且出现真实复用后，才移动到职责具体的 package。

## 5. Game Package

每个 `games/<game-id>` 是一个 workspace package，而不是把所有游戏放入一个 package，也不把单个游戏拆成多个 workspace package。

```text
games/tic-tac-toe/
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

game-client-sdk ────────────> protocol
game-server-runtime ────────> game-sdk + protocol + Colyseus
game-registry ──────────────> games/* subpath exports

apps/web ───────────────────> game-registry/client + catalog
                              game-client-sdk + protocol + ui

apps/game-server ───────────> game-registry/server
                              game-server-runtime + protocol
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
4. 验证房间生命周期、席位和 `expectedRevision`；
5. 使用已注册游戏的 Zod schema 解析 Action；
6. 调用 Game Core `transition`；
7. 若被拒绝，保持 State、revision 和 RNG cursor 不变；
8. 若被接受，提交新 State、推进 RNG cursor、递增 revision 并追加 replay event；
9. 调用 `projectView` 为每个玩家或观众生成完整 View；
10. 发送 snapshot，并在终局时固化 Outcome 和 replay。

Room 必须串行处理 Action。任何未来多实例方案都必须维持“一间房一个 authoritative writer”。

### 8.1 M3 实现不变量

- Room 创建时通过 registry 的 current resolver 选择一个 exact `gameId + gameVersion`，校验并保存规范化 Config；加入和 replay 继续使用 exact resolver。
- Room 在 Core 初始化前预分配 `maxPlayers` 个服务器生成的 stable slots；客户端请求没有 `gameVersion`、slot 或内部 `roomId` 字段。Tic-Tac-Toe 的 `minPlayers = maxPlayers = 2`，第二个有效 session 连接后从 `waiting` 进入 `active`。
- Colyseus join/leave/Action 共用每 room Promise queue；连接 session、active connection generation 和 slot ownership 都在进入 Core 前验证。
- accepted candidate 先以 `expectedSequence = current revision` append replay；append 成功后才提交 State/RNG/revision，终局再 complete replay，最后逐连接投影并发送 snapshot。append failure 返回 `INTERNAL_ERROR`，不确认 accepted，也不更新 RoomStore/State/revision。
- M3 的两个 store 都是单进程内存实现，上述顺序在同一 writer critical section 内成立。未来 durable RoomStore/ReplayStore 必须用数据库事务或 outbox 扩展，不能把当前两次 port 调用误当作跨存储原子事务。
- command outcome cache 以 `PlayerSessionId + commandId` 为 key，M3 保留整个 room lifetime，覆盖 60 秒重连和正常重试；后续长房间可在不小于重试窗口的前提下加入有界淘汰。
- 初连、lifecycle 激活、accepted Action、stale recovery、takeover reconnect 和 timeout abandonment 都只发送按当前连接单独调用 `projectView` 得到的完整 snapshot。

## 9. 存储与部署

### 9.1 V1 基线

- `apps/web` 与 `apps/game-server` 是两个独立服务。
- 单区域、单个 Game Server 实例。
- `RoomStore` 和 `ReplayStore` 使用内存 adapter。
- 默认重连宽限为 60 秒；同一 session 通过新 ticket 和新的 Colyseus seat reservation 接管 stable slot，旧连接立即失去 writer 权限。超时策略为 `abandoned`。
- 服务器重启会丢失活动房间和 replay。
- 不引入 Redis、Kubernetes 或服务网格。

### 9.2 扩容路径

出现真实容量或高可用需求后：

1. 将房间分配和 presence 切换到 Colyseus 支持的共享 driver/presence；
2. 引入 Redis，但只承担 presence、协调或短期缓存，不成为游戏规则来源；
3. 使用 PostgreSQL adapter 持久化比赛、玩家和 replay；
4. 确保同一 room 始终路由到唯一 owner process；
5. 在指标证明需要前，不拆分更多微服务或多区域写入。

## 10. 架构决策状态

### 10.1 已确定

- pnpm workspace + Turborepo + strict TypeScript；
- Next.js App Router Web 与独立 Colyseus Game Server；
- PostgreSQL + Drizzle 为未来持久化方向；
- server-authoritative、deterministic Core、Replay First；
- 每游戏单 package、子路径隔离和显式类型化注册表；
- Zod 负责不可信边界的运行时校验；
- 完整的 per-viewer snapshot，而不是 V1 patch 或纯 Action 广播；
- 匿名 guest session、短期连接票据和 60 秒重连宽限；
- V1 内存存储、单实例单区域。

### 10.2 暂缓

- 具体云平台、容器运行方式和域名拓扑；
- 账号认证供应商和跨设备身份合并；
- PostgreSQL 业务 schema；
- Redis driver/presence 的选择与部署；
- Matchmaking、观战延迟、公开 replay 权限；
- realtime runtime contract；
- game generator 的具体 CLI 和模板格式。

### 10.3 当前不做

- 完整网站、Lobby、登录、排行榜或大量 UI；
- 数据库业务和 replay 播放器；
- Gomoku 或并行开发多个游戏；
- Redis、Kubernetes、多区域或微服务化；
- 为实时游戏、复杂卡牌或几十种游戏预先构造统一大接口。

## 11. 主要架构风险

| 风险                        | 影响                                                     | 当前控制措施                                                                            |
| --------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Game Plugin 过早抽象        | 隐藏信息或实时游戏可能迫使接口复杂化                     | V1 只处理离散 Action；仅预留 `projectView`，实时游戏使用独立 runtime family             |
| `gameVersion` 长期兼容      | replay 读取代码和测试矩阵会持续增长                      | 精确钉住版本、保留 golden replay，并在删除旧实现前迁移稳定归档                          |
| Colyseus 生命周期与扩容耦合 | 重连、per-viewer snapshot 和多实例可能破坏 single-writer | Core 与 Colyseus 隔离，通过 runtime adapter 和 store ports 组合；扩容前先验证 ownership |

## 12. 共享 API 变更政策

修改 `game-sdk`、`protocol`、`game-client-sdk` 或 `game-server-runtime` 的公开 API 时必须：

1. 说明改变的架构理由和兼容性影响；
2. 同步更新其权威文档；
3. 更新所有注册游戏和消费方；
4. 添加或更新 contract/integration tests；
5. 对影响 replay 的变更明确 `gameVersion` 或 `replayFormatVersion` 策略。

仅为了减少少量重复，不足以成为新增共享抽象或依赖的理由。
