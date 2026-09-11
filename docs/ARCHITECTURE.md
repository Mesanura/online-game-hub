# 系统架构

本文定义服务、package、依赖、存储与公共 API 的边界。产品范围见 [PRODUCT.md](./PRODUCT.md)，阶段状态见 [ROADMAP.md](./ROADMAP.md)，运行步骤见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 系统边界

Platform 管理身份、房间、稳定席位、连接、准备、重连和比赛生命周期；Game 管理确定性的规则、State、Action/Input 与 Outcome。服务器是唯一权威，每个房间只有一个 writer。

```text
Browser
  ├─ HTTPS ──> Next.js Web ──> PostgreSQL 账户与私有历史
  │              ├─ 目录、认证、短期连接票据
  │              └─ 版本化 Surface 静态资源
  ├─ sandboxed iframe ──> Game Surface（projected View / intent）
  └─ HTTPS + WebSocket ──> Colyseus Game Server
                             ├─ room / slots / Setup / reconnect
                             ├─ turn-based 或 realtime runtime
                             └─ PostgreSQL Match / replay archive
```

浏览器直接连接 Game Server，Next.js 不代理 WebSocket。两个服务可独立部署；当前 Game Server 只支持单实例，不具备多实例房间协调。

## 服务职责

### `apps/web`

- 提供目录、游戏入口、房间、对局、认证和账户历史页面。
- 管理签名访客 cookie、密码账户和可撤销账户 session，签发短期 Game Server ticket。
- 通过同源只读代理发现已有房间固定的 runtime、game version 与 Setup generation。
- 按 manifest 选择 turn-based/realtime Client Host，按 exact deployment 加载 sandboxed Surface。
- 为 Surface intent 补充平台 envelope，传入服务器投影视图、连接状态和 viewport。
- 只按有效账户 session 的 UserId 查询私有历史及授权回放。

Web 不验证游戏规则、不持有权威 State、不生成 Outcome。页面代码不导入 server registry/Core，也不回退到 legacy Client Module。

### `apps/game-server`

作为 composition root，组合显式 server registry、ticket verifier、两类 runtime、store、clock/scheduler、ID source、logger 和 metrics。它验证身份、创建/加入房间、分配 stable slots、执行权威管线并提供 `/health`、`/metrics` 和 `/room-discovery`；不包含具体游戏规则。

`createGameServer(options)` 通过 ports 注入依赖，`start`/`stop` 显式控制生命周期，`port: 0` 支持测试。生产 composition 注入 HMAC ticket verifier、Web origin allowlist 和 PostgreSQL adapters。模块 import 不连接数据库、不执行 migration、不启动进程；生产模块不导入 testing authority。Colyseus HTTP router 与 WebSocket transport 由 app 拥有，transport 所需 Express 不承载业务规则。

生产启动先把单实例遗留的 waiting/active archive 标记 abandoned。关闭时先停止 Colyseus，再释放数据库连接。

## Package 职责

| Package                        | 职责                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `game-sdk`                     | 回合制纯类型、JSON/slot/viewer/outcome 契约与确定性 RNG                                          |
| `game-server-runtime`          | 回合制 room、Action pipeline、lifecycle/reconnect、store/clock/observability ports 与离散 replay |
| `game-client-sdk`              | 回合制 ticket/join、命令、snapshot、连接状态、lifecycle/reconnect 与房间资料同步 Host            |
| `realtime-game-sdk`            | 固定 tick simulation、实时类型/RNG、canonical replay 与纯重建器                                  |
| `realtime-game-server-runtime` | 实时输入队列、单 writer scheduler、快照、reconnect 与 realtime replay port                       |
| `realtime-game-client-sdk`     | 实时连接 Host、input sequence/ack、快照顺序与显示插值时钟                                        |
| `protocol`                     | V6 平台 envelope、独立 Realtime V1、错误码、ticket claims 与 strict schemas                      |
| `game-server-ticket`           | Web issuer 与 Game Server verifier 共用的 HMAC-SHA256 ticket authority                           |
| `game-setup`                   | 两类 runtime 共用的纯 Setup definition、coordinator、projection/finalize 与最终设置校验          |
| `game-surface-bridge`          | Artifact 与 Bridge V1/V2 JSON schemas、消息和可选 Host/Surface helpers                           |
| `game-registry`                | 显式 catalog、exact Core/Setup resolver 与 Surface deployment                                    |
| `database`                     | PostgreSQL/Drizzle、migration、账户、room metadata、Match archive、replay 与 history adapters    |
| `ui`                           | 无网络、房间或游戏规则的视觉组件与 tokens                                                        |

不建立泛化 `packages/shared`。共享代码只有在 owner 明确且已有真实消费者时，才进入职责具体的 package。

## 游戏与注册

`games/<game-id>` 拥有无副作用的 `/manifest`、纯 `/core`、`/setup`、规则文档和测试。所有画面由独立 `game-surfaces/<game-id>` 提供；旧 Client 源码与 `/client` exports 已移除。规则版本、Surface 版本与平台协议版本独立。

`game-registry` 是组合所有具体游戏的专用 package：

- `/catalog` 公开 manifest 与 current 目录选择。
- `/server` 按 exact `gameId + gameVersion` 解析对应 runtime 的 Core 与 Setup。
- `/history` 按 exact game/version 组合游戏自有历史 projectView；`/history-types` 提供安全个人结果类型，具体契约见 [Game Plugin](./GAME_PLUGIN_SPEC.md#账户历史结果投影)。
- `/deployment` 固定 Setup generation、平台控制能力，并把 exact game/version/mode 映射到 immutable Surface。

创建新房间先从 catalog 确定 current 版本，再走 exact resolver，不依赖数组顺序。加入和 replay 都使用房间或记录中的 exact 版本。manifest 的 `defaultConfig` 必须是 `configSchema` 接受且无需再规范化的 JSON 数据，服务器仍重新校验。

注册必须显式、类型化且可审查，不扫描目录或在运行时发现插件。[create-game 工具](../tools/README.md) 生成可构建的 V6/Bridge V2 开发草稿，仅写两个包目录与 lockfile；catalog、exact resolver 和 deployment 仍需在正式接入时显式登记。

## 依赖规则

```text
games/*/core ───────────────> game-sdk 或 realtime-game-sdk + 已审计纯依赖
games/*/setup ──────────────> game-setup + 本游戏公开类型
game-surfaces/* ────────────> game-surface-bridge + 自有渲染依赖

game-server-runtime ────────> game-sdk + game-setup + protocol + Colyseus
realtime-game-server-runtime > realtime-game-sdk + game-setup + protocol + Colyseus
client SDKs ────────────────> protocol + Colyseus SDK
game-server-ticket ─────────> protocol
game-registry ──────────────> games/* 的 public exports
database ──────────────────> 两类 runtime 的 ports + Drizzle/Postgres.js
apps ──────────────────────> 各自需要的 registry、SDK/runtime、ticket、database
```

- SDK、Protocol、通用 runtime 不依赖具体游戏；游戏之间不得互相依赖。
- Realtime SDK/server/client 不导入回合制 `GameDefinition`、Host 或 `game-server-runtime` 实现。共享身份/lifecycle 能力须通过明确的最小契约表达，不能反向耦合两类管线。
- Core 和 Setup 不依赖 React、Next、DOM、Phaser、Colyseus、WebSocket、ORM、PostgreSQL 或 Redis，不读取时钟、网络或环境。
- Core 外部依赖采用显式白名单：Zod 用于 schema，`pathfinding` 主入口仅由坦克迷战持有，用于固定版本的纯网格搜索；不开放内部 deep import。库升级与搜索顺序变化须评估 replay 兼容。
- Surface 只依赖 Bridge，不导入 Core、client host、Protocol、ticket 或数据库；Next 不编译 Surface 源码和框架依赖。
- 两类连接 SDK 不定义 React 组件契约，也不依赖 React/Phaser。Web 与 Surface 各自持有渲染依赖；Next 仍保留用于 manifest/Core 静态导入的游戏 transpile 条目。
- `ui` 不依赖网络或业务。跨 package 只使用声明的 public exports，不引入循环依赖。

依赖检查由 `pnpm deps:check` 自动执行。具体规则接口见 [Game Plugin](./GAME_PLUGIN_SPEC.md) 和 [Realtime Runtime](./REALTIME_RUNTIME_DESIGN.md)。

## 房间、Setup 与执行

### 协议代际

创建房间时将 exact deployment 的 `setupProtocol: 6` 固定到 room record，此后保存不得改变代际。已有房间通过 discovery 返回最小 `{ roomCode, gameId, gameVersion, setupProtocol, runtime }`；ticket、matchmaking、消息与 reconnect 必须全部使用 V6。注册切换或回滚不能改变运行中房间的代际。

所有受支持规则版本均使用 V6，V5 在线 schema/runtime 已退役。历史 realtime metadata 保留 V5 读取类型，在线写入只允许 V6；旧数据不能恢复 V5 房间。Discovery 不承诺席位可用或活动房间可恢复；身份、席位和 room 存活仍由 join/runtime 验证。exact schemas、API 迁移、历史读取和 HTTP 错误见 [网络协议](./NETWORK_PROTOCOL.md)。

### V6 逐局设置

创建 room 只产生房间与 stable slots，不初始化 gameplay Core，也不创建 Match/replay。`game-setup` 向游戏提供 occupied/online/owner facts；游戏负责 Setup State/Action/View、权限、readiness 与 finalize。

Platform 验证 `FinalizedRoundSetup` 的 Config、参与 slot、人数范围、严格 playerOrder 排列与 assignment 键集合。accepted Setup Action 增加 setupRevision 并清空 ready，rejected/stale/duplicate 保持不变。Setup 使用独立 RNG，finalize 结果先固化，持久化重试不重新随机；Gameplay 获得新 seed。

全部所选参与者在线且分别 ready 后才开局。completed 后复用完整 finalized setup 初始化下一轮，但不复用 ready、State、Outcome、revision/tick、RNG、seed、Match 或 replay ID。平台不再提供 starter/assignment/immediate-rematch 分支。

### 权威执行

回合制 room 在同一 Promise queue 中串行处理 join、leave、control、timeout 与 Action。先验证 exact envelope、连接/session/slot、round/revision，再解析游戏 schema，从连接推导 actor 并调用 `transition`。

Rejected candidate 不改变 State、revision、RNG 或 replay。Accepted candidate 先写 replay，终局 complete，再保存 RoomStore；全部成功后才提交内存 aggregate、缓存结果并逐 viewer 调用 `projectView` 发送完整 snapshot。失败不提前确认，重试保持规范化内容与幂等语义。具体提交顺序和 crash window 由 [Replay 设计](./REPLAY_DESIGN.md) 统一定义。

Realtime 使用独立 scheduler、输入队列与 `step`，不复用 Action revision 管线。wall clock 只决定何时执行 tick，Core 只接收规范化的 tick/input frame；服务器与 replay runner 使用同一输入交付策略。

### 浏览器 Host 与 Surface

同一游戏 layout 保持 Client Host，入口、等待、对局路由切换不重新 join。Host 只保存服务器 View、lifecycle 和连接/拒绝状态，使用 snapshot 收敛；它不重演权威 State。刷新或非主动断线通过新 ticket 和新 seat reservation 恢复原 stable slot。

Web 仅加载 exact Surface。Host 负责 opaque iframe、Bridge、viewport、intent result 和平台命令；游戏信息与结果摘要由 Surface 提供，平台 HUD 不猜测 View 字段。artifact、摘要锁、静态 headers、投降命令与终局摘要的完整契约见 [Game Surface 规范](./GAME_SURFACE_SPEC.md)。

## 身份与持久化

### 账户边界

Web 使用独立 `password_credentials` 与 `account_sessions` 表；密码以 Argon2id hash 保存，opaque session token 只保存 SHA-256 hash。ticket 中的可选 UserId 只能来自服务器验证过的账户 session。

slot 私有保存 `{ playerSessionId, userId }`，Round 启动时写入参与者账户快照；后续保存、完成和归档重试只验证该值，不能按当前登录态回填。Reconnect/takeover 同时匹配两种身份，旧连接立即失去 writer 权限。游客比赛永不因后续注册或登录被认领。

`GET /api/matches` 只按有效 `ogh_account` session 的 UserId 查询，返回最近 50 条安全 metadata，采用 `createdAt DESC, matchId DESC` 稳定排序；请求级数据库 client 必须关闭。replayAvailable 与播放授权使用 exact 历史 definition，不用 current catalog 替代。

账户显示名归 Web/profile 与数据库所有，游客资料独立存在浏览器。`PATCH /api/auth/profile` 只接受严格 `{ displayName }`，执行同源 JSON 与账户授权校验。Web 将经过校验的公开显示名签入可选 ticket claims，两类 runtime 只在内存席位中保存，并向支持资料扩展的客户端投递 lifecycle；不把账户标识交给其他玩家，也不把显示资料写入 Core、Setup、Surface 或 replay。同步与兼容契约见 [网络协议](./NETWORK_PROTOCOL.md#43-http-ticket-api)，资料规则见 [产品文档](./PRODUCT.md)。迁移对旧 users 从凭证回填用户名，无凭证者回填“游客”，随后约束非空。

显示名的存储长度上限为 512，避免旧的 96 长度限制拒绝合法组合 emoji；512 个 UTF-16 code unit 与 24 个 grapheme 的输入边界由公开资料校验控制，PostgreSQL CHECK 保留非空和粗粒度长度保护。部署先应用 checked-in migrations，再升级服务。

### 存储职责

| 数据                          | 当前实现                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 回合制 live room / 权威 State | 内存 `RoomStore` 与 runtime aggregate                                                                                                      |
| Realtime room metadata        | PostgreSQL 模式可保存 generation、slots、Setup/lifecycle 摘要；不保存可恢复的 simulation State                                             |
| 回合制记录与归档              | `replays`、`replay_actions`、`matches`、`match_players`                                                                                    |
| 实时记录与归档                | 独立 `realtime_replays`、`realtime_replay_events`、`realtime_rooms`、`realtime_room_players`、`realtime_matches`、`realtime_match_players` |
| 账户与资料                    | `users`、`password_credentials`、`account_sessions`                                                                                        |

`database` 是唯一 PostgreSQL/Drizzle owner，runtime 只依赖 ports。所有 JSONB 在写入前和读取后校验，Match 不保存游戏专属规则列。实时事件有显式 tick/runtime/format 约束，不能作为未验证 JSON 混入离散 Action 表。

每个 live room 的 `(runtime_room_id, round_number)` 唯一。后续 Round 在 advisory lock 下验证上一轮 completed、轮次连续、exact game/version 与 slot/session 参与者集合；playerOrder 可以改变，参与者身份不变。旧 waiting archive 只为兼容保留，首局未开始不创建 Match。

ReplayStore 与 MatchArchive 具有各自幂等边界；数据库 append/completion 事务保持 replay 与 Match 一致，但它们和内存 State 没有跨存储原子事务。当前通过单 writer、pending candidate、唯一约束和幂等重试控制失败窗口，不引入 outbox。

## 部署与运行限制

生产使用 PostgreSQL；`DATABASE_MODE=memory` 仅限 development/test，不提供 durable history。migration 由显式命令执行，应用启动不会自动迁移。DSN、ticket、cookie、seed、私密 State 和 canonical record 不进入浏览器、日志或错误响应。

当前单区域、单 Game Server，重连宽限默认 60 秒，completed room TTL 为 5 分钟。服务器重启不恢复 room、socket、timer、Setup 或权威 State；持久化的 realtime room metadata 也不构成恢复保证。

Docker Compose 组合独立 Web、Game Server、一次性 migrator 和 PostgreSQL；镜像由 CI 构建，运行时配置、备份和更新见 [部署指南](./DEPLOYMENT_DOCKER_COMPOSE.md)。未来多实例须先设计 presence、room ownership 和唯一 writer 路由；现有全局启动协调不能直接复用到多实例。

## 公共 API 与主要风险

共享 API 变更须说明真实跨 package 价值、兼容性和迁移范围，同步权威文档、全部消费者与 contract/integration tests，并分别评估规则、wire、Bridge、artifact 和 replay 版本。仅减少少量重复不足以证明需要共享抽象。

| 风险                  | 控制措施                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| 历史版本维护成本增长  | exact resolver、冻结 Core、golden replay；结束读取承诺前明确迁移或审批         |
| UI 或网络时序影响规则 | 纯 Core、per-viewer projection、独立 scheduler、按 tick 归档输入               |
| 重启或部分持久化失败  | 不承诺活动恢复；使用 pending candidate、事务、唯一约束与幂等重试               |
| 密钥或 origin 误配    | 独立 secrets、严格 issuer/audience/config 校验和最小 origin allowlist          |
| 历史兼容误删          | 核对历史 Core、golden、精确 Surface/replay 映射和数据库 reader，按测试矩阵验证 |

扩容、预测/回滚、ECS 和隐藏信息权限等未排期能力按产品需求单独设计，不预先扩张当前接口。
