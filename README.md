# Online Game Hub

这是一个 server-authoritative、replay-first 的多人网页游戏平台 monorepo。M1–M6 已完成；四子棋、五子棋、额外六贯棋与黑白棋依次证明既有 Game Plugin 可表达重力、Config、六边连接/投降，以及八方向翻转、无合法行动、强制跳过和非满盘终局。所有游戏继续复用显式 registry、Client Module、authoritative runtime、per-viewer projection、Replay V1、PostgreSQL Match/history 和 Web vertical slice。创建 live room 后不立即创建比赛；首局及每次重开都由房主选择“我先/对方先”，双方 ready 且在线后才按本轮 `playerOrder` 创建独立 Match、Replay 和 State。room code 与 stable slots 跨轮不变，标准先手角色随 `playerOrder` 变化。当前 wire 为 Protocol V2；Replay Format V1 与井字棋/四子棋/五子棋/六贯棋/黑白棋 1.0.0 保持不变。OAuth、公开 replay 与活动房间恢复仍未实现。

## 开始之前

架构与产品约束以以下文档为准：

- [产品范围](./docs/PRODUCT.md)
- [系统架构](./docs/ARCHITECTURE.md)
- [Game Plugin 规范](./docs/GAME_PLUGIN_SPEC.md)
- [网络协议](./docs/NETWORK_PROTOCOL.md)
- [Replay 设计](./docs/REPLAY_DESIGN.md)
- [Docker Compose 单机部署](./docs/DEPLOYMENT_DOCKER_COMPOSE.md)
- [测试策略](./docs/TESTING.md)
- [开发路线图](./docs/ROADMAP.md)
- [Agent 工作规则](./AGENTS.md)

## 工具链

- Node.js 24.14.0 LTS（Krypton）
- pnpm 11.24.0
- Turborepo 2.10.12
- TypeScript 6.0.3（`typescript-eslint` 8.68.0 当前支持的最新 TypeScript 主线）
- ESLint 10.9.1
- Prettier 3.9.6
- Zod 4.4.3
- Vitest 4.1.11
- Colyseus Core 0.18.10、WebSocket Transport 0.18.2、SDK 0.18.2
- Express 5.2.1（`@colyseus/ws-transport` 的运行时顶层 import；业务路由继续使用 Colyseus router）
- Next.js 16.3.3
- React / React DOM 19.2.8
- Playwright 1.62.1（Chrome for Testing 151）
- PostgreSQL（生产唯一数据库；CI 固定 `postgres:17.6-alpine3.22`）
- Drizzle ORM 0.45.2、Drizzle Kit 0.31.10、Postgres.js 3.4.9

Node 与 pnpm 都是精确固定版本。请使用 Corepack 激活 `package.json#packageManager` 中的 pnpm，再从仓库根目录安装：

```sh
corepack enable
corepack install
pnpm install --frozen-lockfile
```

## 稳定根命令

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm deps:check
pnpm db:check
pnpm db:migrate
pnpm test:database
pnpm test:integration
pnpm test:e2e
```

`pnpm lint` 同时执行格式、ESLint、本地 Markdown 链接和依赖边界检查。`pnpm test` 包含 Game SDK、Protocol、井字棋/四子棋/五子棋/六贯棋/黑白棋 Core、Client 与 golden replay、registry、runtime ports、replay/store tests、Game Server unit tests、create-game 临时 workspace fixtures，以及故意违规的 repository-check 隔离 fixture。`pnpm db:check` 静态检查 checked-in migration；`pnpm db:migrate` 只在调用者显式提供 `DATABASE_URL` 时应用 migration。`pnpm test:database` 需要 `TEST_DATABASE_URL` 指向测试可创建数据库的 PostgreSQL 管理库，并为每个 suite 创建、验证和删除随机 `ogh_test_*` 数据库。`pnpm test:integration` 在随机本地端口运行真实 Colyseus 双客户端 tests；`pnpm test:e2e` 先构建 workspace，再以随机回环端口启动真实 Next production app、真实 Colyseus Server 和隔离 PostgreSQL 数据库，运行双 browser-context Playwright。三个测试脚本都不是空脚本，CI 都会执行。

所有当前支持 `gameVersion` 的 golden replay 可单独运行：

```sh
pnpm --filter @online-game-hub/tic-tac-toe test:golden
pnpm --filter @online-game-hub/connect-four test:golden
pnpm --filter @online-game-hub/gomoku test:golden
pnpm --filter @online-game-hub/hex test:golden
pnpm --filter @online-game-hub/reversi test:golden
```

首次在本机运行浏览器测试前执行 `pnpm exec playwright install chromium`；CI 使用 `--with-deps chromium` 安装精确匹配的浏览器。

Colyseus 的可选 `msgpackr-extract` 原生加速不影响协议正确性，仓库在 `pnpm-workspace.yaml#allowBuilds` 中明确拒绝其 install script，使用纯 JavaScript fallback。依赖版本与 lockfile 必须继续由 pnpm 维护。

## 新游戏机械骨架

五款游戏已验证稳定的 package/export/registry/Next 登记可通过窄版 CLI 自动完成：

```sh
pnpm create-game --help
pnpm create-game --game-id example-game
```

CLI 只接受稳定 lowercase kebab-case，并在写入前检查路径、保留名、目录、workspace package、gameId、export symbol 和全部显式登记冲突。同一完整输入重复运行零写入；部分登记或内容冲突 fail closed。`pnpm-lock.yaml` 只由根目录固定 pnpm 以 lockfile-only 模式更新，失败会回滚本轮文件并返回非零退出码。

生成器只创建未完成 package/config/export 骨架，登记 catalog、lazy client loader、exact/current server resolver 和 Next transpile package。它不生成或猜测 manifest 产品字段、规则、Core、Client、CSS、golden replay、integration 或 E2E 对局。成功输出的人工清单全部完成并满足 [Game Plugin 规范](./docs/GAME_PLUGIN_SPEC.md) 前，新游戏不属于已完成插件。完整参数、退出码、保留名和恢复语义见 [Tools](./tools/README.md)。

## M4/M5 依赖 ownership

| 依赖                                                                                             | Owner                          | 版本与不可替代原因                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `next` 16.3.3                                                                                    | `apps/web`                     | 提供 App Router、server route、Proxy、生产 build/start；现有 TypeScript/React 工具链不提供这些 Web runtime 能力。                |
| `react` / `react-dom` 19.2.8                                                                     | `apps/web` 与 game client peer | 与 Client Module 的精确 peer 对齐，负责实际浏览器渲染；未引入额外状态管理框架。                                                  |
| `@colyseus/sdk` 0.18.2                                                                           | `game-client-sdk`              | 与 Core 0.18.10 / WS transport 0.18.2 的协议代际对齐，提供真实 matchmaking/WebSocket lifecycle；不能由服务端 transport 替代。    |
| `server-only` 0.0.1                                                                              | `apps/web`                     | 在 Next 构建期阻止含 secret 的 runtime config 被客户端模块引用；TypeScript 类型本身不能建立 bundle 边界。                        |
| `@playwright/test` 1.62.1                                                                        | `tooling/e2e` / CI             | 与 Next 16 的 Playwright peer 范围兼容，提供隔离 contexts 和真实 Chromium 自动化；Vitest/Colyseus SDK 不能验证浏览器 cookie/UI。 |
| `@types/node` 24.13.3、`@types/react` 19.2.18、`@types/react-dom` 19.2.5、`@types/express` 5.0.6 | 各直接 TypeScript consumer     | 分别与 Node 24、React 19.2 和 Express 5 对齐，仅用于 strict compile，不进入运行时 bundle。                                       |
| `drizzle-orm` 0.45.2 / `postgres` 3.4.9                                                          | `packages/database`            | 分别拥有类型化 PostgreSQL schema/query 与可关闭连接池；现有 TypeScript/Vitest 不能替代真实 SQL 约束、事务和跨进程连接。          |
| `drizzle-kit` 0.31.10                                                                            | `packages/database` dev        | 生成并检查 checked-in PostgreSQL migrations，不进入应用 runtime；手写依赖树或应用启动时隐式建表都不能替代 migration 审计。       |

## 本地启动与停止

新机器可使用 Docker Compose 自动准备脚本下载部署配置、生成安全凭证并创建本地 PostgreSQL 数据目录；应用直接从 Docker Hub 拉取，不需要下载源码或安装 Node.js：

```sh
curl -fsSL https://raw.githubusercontent.com/Mesanura/online-game-hub/main/docker-deploy.sh | bash
cd online-game-hub
docker compose up -d
```

脚本的版本固定、目标目录、数据备份与完整验收方式见 [Docker Compose 单机部署](./docs/DEPLOYMENT_DOCKER_COMPOSE.md)。

Web 和 Game Server 是两个独立进程，也是各自 PostgreSQL 连接的 owner。先分别复制 `apps/web/.env.example` 和 `apps/game-server/.env.example` 为同目录下被忽略的 `.env.local`，将数据库与 secret 占位符替换为本地值。两端使用同一个已迁移数据库时，`DATABASE_MODE=postgres` 与 `DATABASE_URL` 必须一致；生产环境强制 PostgreSQL，缺失 credential 会 fail closed。两端的 `GAME_SERVER_TICKET_ISSUER` 和 `GAME_SERVER_TICKET_SECRET` 必须完全一致；Web 的 `GAME_SERVER_PUBLIC_URL` 必须是浏览器可访问的 Game Server HTTP(S) 地址，Game Server 的 `GAME_SERVER_ALLOWED_WEB_ORIGINS` 必须包含 Web origin。guest session secret 与 ticket secret 不得复用，`DATABASE_URL`、cookie 和 ticket 不得写入仓库或日志。

先显式创建空数据库并从 workspace root 应用 migration；应用启动不会自动迁移或破坏 schema：

```sh
DATABASE_URL=postgresql://... pnpm db:migrate
```

然后在两个终端启动：

```sh
pnpm --filter @online-game-hub/game-server dev
pnpm --filter @online-game-hub/web dev
```

默认地址分别为 `http://127.0.0.1:2567` 和 `http://127.0.0.1:3000`。开发和测试可明确配置 `DATABASE_MODE=memory`，但该模式不提供 durable history，Web history route 会返回稳定 unavailable 错误；生产不得回退到内存。开发和测试可在 loopback HTTP 上显式配置 `GUEST_COOKIE_SECURE=false`；生产环境强制 HTTPS public URL/origin 和 Secure guest cookie。生产式运行先执行 `pnpm build`，再分别运行两个 package 的 `start`。发送 `SIGINT`/`SIGTERM` 会先 graceful shutdown Game Server，再关闭它拥有的数据库连接；Next 进程只拥有自己的短生命周期 history query connections。测试使用随机 loopback 端口与随机数据库，不访问外部托管服务。

## Game Server 运行边界

`apps/game-server` 导出无副作用的 `createGameServer(options)` composition API。调用方必须注入可信 `TicketVerifier`，再显式调用 `start({ hostname, port })`；测试使用 `port: 0`，生产 adapter 可配置确定端口。`start` 返回实际 HTTP/WebSocket 地址，`stop()` 执行 graceful shutdown。服务暴露：

- `GET /health`：JSON health check；Colyseus 同时保留 `GET /__healthcheck`；
- `GET /metrics`：内存 metric samples，不包含 State、seed 或 bearer secret；
- `/matchmake/*` 与 WebSocket：Colyseus 创建/加入和房间消息 transport。

生产入口 `createProductionGameServer(config, overrides?)` 使用 `@online-game-hub/game-server-ticket` 的 HMAC adapter 注入 verifier，并在 `DATABASE_MODE=postgres` 时分别注入内存 `RoomStore`、`PostgresReplayStore` 与独立 `PostgresMatchArchive`；生产代码不导入 testing subpath。启动协调会把同一数据库中上次单实例留下的旧 `waiting`/当前 `active` archive 诚实标记为 `abandoned`，不会尝试恢复不存在的 authoritative State。completed replay/history 可跨进程读取；live room、待开局设置、socket、reconnect timer 和 State 仍只在内存。

创建房间后和一轮结束后都进入统一的下一局设置。房主可预选“我先/对方先”，双方使用“准备开始/取消准备”；改变先手会清空全部 ready，重复相同选择保持 ready，断线或 connection takeover 只清对应玩家 ready。所有 slots 已分配、双方在线、已选择先手且全部 ready 后，才按选择构造本轮 `playerOrder`，从 revision `0`、新 RNG 和新 replay 开始。终局房间拒绝新访客，只允许原玩家重连；房主可关闭未开局、active 或 completed 房间，非房主可离开，active 操作先由 Web 确认并把当前 Match 标记 `abandoned`。未开始首局的房间关闭时不产生 abandoned Match。刷新或组件卸载调用 `GameClientHost.close()`，属于非主动断线并保留 60 秒重连；只有 `leaveRoom()` 是主动离开。未关闭的 completed live room 在 5 分钟后回收，选择/ready 不延长 TTL，成功开始下一局会取消 TTL。

## Workspace 结构

```text
apps/
  game-server/             # Colyseus composition root、health/metrics 与真实 integration tests
  web/                     # Next.js App Router、guest cookie、ticket route 与游戏页面
packages/
  database/                # PostgreSQL/Drizzle schema、migration、Replay/Match/User adapters
  game-client-sdk/         # 通用 browser host、ticket provider 与 Client Module contract
  game-registry/           # 显式 catalog/client/server 组合与 exact resolution
  game-sdk/                # JSON/definition 类型与 deterministic RNG V1
  game-server-runtime/     # auth/room ports、authoritative pipeline、多轮/关闭、reconnect 与 replay
  game-server-ticket/      # Web/Game Server 共用的正式短期 HMAC ticket authority
  protocol/                # Protocol V2 strict Zod schemas 与推导类型
  ui/                      # 空 public entry
games/
  connect-four/             # 单 package：7×6 manifest/core/client + 1.0.0 golden replay
  gomoku/                   # 单 package：15×15/19×19 Config、core/client + 1.0.0 golden replay
  hex/                      # 单 package：11×11 六贯棋、投降、canonical path + 1.0.0 golden replay
  reversi/                  # 单 package：8×8 黑白棋、翻转/跳过 + 1.0.0 golden replay
  tic-tac-toe/             # 单 package：manifest/core/client + 1.0.0 golden replay
tooling/
  e2e/                     # 随机端口真实 Next/Colyseus 双 context Playwright
  repository-check/        # 依赖、循环、Markdown 链接检查及 fixture tests
tools/
  create-game/             # 窄版机械骨架与显式登记 CLI；不生成游戏语义
```

不要创建 `packages/shared`。新增 workspace package 必须声明 public exports，并接入根 typecheck、test 和 build 图；跨 package 只能通过 manifest 中声明的依赖与 export map 导入。

M6 五子棋没有新增外部依赖，也没有修改当时的 `protocol`、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database schema 或 migration。现有 create request、Config schema normalization、canonical replay 与 exact resolver 可直接承载 15×15/19×19 Config；通用 Web 页面唯一缺少的是按游戏取得默认 Config，因此 `GameManifest` 新增必填 JSON-safe `defaultConfig`，井字棋/四子棋迁移为 `null`，五子棋默认 `{ boardSize: 15, winLength: 5 }`。该 manifest API 变更当时不提升 Protocol V1、Replay Format V1 或既有游戏版本；后续逐局先手功能才独立升级到 Protocol V2。第三游戏仍暴露显式 registry、Next transpile 与 Web game CSS 的机械步骤，且 shared manifest 刚发生一次有证据的收敛，因此本阶段仍不创建 `tools/create-game`。

额外六贯棋继续复用 `defaultConfig: null`、双人 stable slots、完整 per-viewer snapshot、同房间多轮、accepted Action replay 和 PostgreSQL archive；`PLACE_STONE` 与 `RESIGN` 都只作为游戏 intent 进入现有 envelope。它没有新增外部依赖，也没有修改当时的 `game-sdk`、Protocol V1、Replay Format V1、`game-client-sdk`、`game-server-runtime`、database schema 或 migration。当前 Protocol V2 只让平台逐局决定有序 players；六贯棋仍以 `players[0]` 为 BLUE 标准先手，不需要新游戏版本。六贯棋仍需显式 registry、Next transpile 和 Web CSS 登记；该阶段据此暂不创建 `tools/create-game`，并继续保留黑白棋对翻转/跳过回合的独立验证。

黑白棋 1.0.0 固定 8×8 与 null Config；`players[0]` 为 BLACK 并先手，客户端只提交 `PLACE_DISC(cell)`。Protocol V2 由逐局设置决定哪个 stable slot 成为该轮 `players[0]`，不会修改黑白棋规则或 game version。Core 同时翻转全部合法方向；若对方无合法行动则保持当前 slot，双方均无合法行动或棋盘填满时按棋子数产生 WIN/DRAW。强制跳过不增加 revision、不产生 PASS 或 replay Action。Client 只渲染服务器 View 提供的合法落点、当前行动方、棋子数和 Outcome。该游戏上线时没有新增外部依赖，也没有修改当时的 `game-sdk`、Protocol V1、Replay Format V1、`game-client-sdk`、`game-server-runtime`、`game-server-ticket`、database source/schema/migration 或既有游戏版本。

M6 黑白棋 package 内仍为 16 个文件；游戏外非文档改动为 10 个唯一文件：registry package/catalog/client/server、lockfile 和 Next transpile 共 6 个机械登记文件，Web CSS 1 个，registry/integration/E2E 验证 3 个。连续多个游戏证明 package 骨架和显式登记稳定后，现已独立实现窄 `tools/create-game`，只自动化 package/export/tsconfig 与上述 registry/build 登记并保持幂等；具体规则、样式、golden、integration 和 E2E 序列仍不模板化。

## 自动化边界

`tooling/repository-check` 使用 TypeScript AST 分析静态导入、动态导入、re-export 和 `require`，并结合 workspace manifests 自动阻止：

- `game-sdk`、`protocol` 或 `game-server-runtime` 指向具体游戏；
- 游戏 package 互相依赖，以及 registry 以外的 package 直接组合具体游戏；
- Game Core 导入 game-sdk 与 Zod 之外的运行时依赖，或使用 Node/React/Next.js/Colyseus/数据库/网络模块；
- 跨 package 相对路径和未导出的 package deep import；
- source module 或 workspace package 循环依赖；
- `ui` 指向网络、房间、游戏或数据库 package。

CI 在 Ubuntu 干净环境中启动固定 `postgres:17.6-alpine3.22` service，使用 lockfile 安装精确匹配的 Chromium，然后依次运行 lint/dependency checks、typecheck、unit tests、真实 PostgreSQL tests、真实 Colyseus integration、build 和 PostgreSQL-backed Playwright E2E。每个数据库 suite 只清理自己验证过前缀的随机数据库。
