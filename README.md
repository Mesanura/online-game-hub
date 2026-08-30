# Online Game Hub

这是一个 server-authoritative、replay-first 的多人网页游戏平台 monorepo。当前已完成 M5：M4 的 Next.js/Colyseus 双访客纵切之上已接入 PostgreSQL + Drizzle、durable canonical replay、Match/MatchPlayer archive、guest-to-account 服务端关联基础和私有比赛历史 API。两名原玩家可在同一 live room 内 ready/cancel 并无缝开始下一轮；每轮拥有独立 Match、Replay 和 history，房主可关闭房间，非房主可主动离开，终局房间有 5 分钟回收期限。Protocol V1、replay format V1 和 Tic-Tac-Toe 1.0.0 保持不变；OAuth、密码登录、公开 replay 与活动房间恢复仍未实现。

## 开始之前

架构与产品约束以以下文档为准：

- [产品范围](./docs/PRODUCT.md)
- [系统架构](./docs/ARCHITECTURE.md)
- [Game Plugin 规范](./docs/GAME_PLUGIN_SPEC.md)
- [网络协议](./docs/NETWORK_PROTOCOL.md)
- [Replay 设计](./docs/REPLAY_DESIGN.md)
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

`pnpm lint` 同时执行格式、ESLint、本地 Markdown 链接和依赖边界检查。`pnpm test` 包含 Game SDK、Protocol、Tic-Tac-Toe Core、registry、runtime ports、replay/store tests、Game Server unit tests，以及故意违规的隔离 fixture。`pnpm db:check` 静态检查 checked-in migration；`pnpm db:migrate` 只在调用者显式提供 `DATABASE_URL` 时应用 migration。`pnpm test:database` 需要 `TEST_DATABASE_URL` 指向测试可创建数据库的 PostgreSQL 管理库，并为每个 suite 创建、验证和删除随机 `ogh_test_*` 数据库。`pnpm test:integration` 在随机本地端口运行真实 Colyseus 双客户端 tests；`pnpm test:e2e` 先构建 workspace，再以随机回环端口启动真实 Next production app、真实 Colyseus Server 和隔离 PostgreSQL 数据库，运行双 browser-context Playwright。三个测试脚本都不是空脚本，CI 都会执行。

所有当前支持 `gameVersion` 的 golden replay 可单独运行：

```sh
pnpm --filter @online-game-hub/tic-tac-toe test:golden
```

首次在本机运行浏览器测试前执行 `pnpm exec playwright install chromium`；CI 使用 `--with-deps chromium` 安装精确匹配的浏览器。

Colyseus 的可选 `msgpackr-extract` 原生加速不影响协议正确性，仓库在 `pnpm-workspace.yaml#allowBuilds` 中明确拒绝其 install script，使用纯 JavaScript fallback。依赖版本与 lockfile 必须继续由 pnpm 维护。

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

生产入口 `createProductionGameServer(config, overrides?)` 使用 `@online-game-hub/game-server-ticket` 的 HMAC adapter 注入 verifier，并在 `DATABASE_MODE=postgres` 时注入 `PostgresReplayStore` 与 Match archive `RoomStore` decorator；生产代码不导入 testing subpath。启动协调会把同一数据库中上次单实例留下的 `waiting`/`active` archive 诚实标记为 `abandoned`，不会尝试恢复不存在的 authoritative State。completed replay/history 可跨进程读取；活动 `RoomStore`、socket、reconnect timer 和 State 仍只在内存。

一轮结束后，房间保留原 room code 和 stable slots；双方都点击“再来一局”才创建下一轮，任一方可取消，断线或 connection takeover 会清除其 ready。每轮从 revision `0`、新 RNG 和新 replay 开始，history 以 `roundNumber` 区分。终局房间拒绝新访客，只允许原玩家重连；房主可关闭 waiting/active/completed 房间，非房主可离开，active 操作先由 Web 确认并把当前 Match 标记 `abandoned`。刷新或组件卸载调用 `GameClientHost.close()`，属于非主动断线并保留 60 秒重连；只有 `leaveRoom()` 是主动离开。未关闭的 completed live room 在 5 分钟后回收，URL 同时清除 room code 并返回创建/加入入口。

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
  protocol/                # Protocol V1 strict Zod schemas 与推导类型
  ui/                      # 空 public entry
games/
  tic-tac-toe/             # 单 package：manifest/core/client + 1.0.0 golden replay
tooling/
  e2e/                     # 随机端口真实 Next/Colyseus 双 context Playwright
  repository-check/        # 依赖、循环、Markdown 链接检查及 fixture tests
tools/                     # 未来面向开发者的 CLI；当前不创建生成器
```

不要创建 `packages/shared`。新增 workspace package 必须声明 public exports，并接入根 typecheck、test 和 build 图；跨 package 只能通过 manifest 中声明的依赖与 export map 导入。

## 自动化边界

`tooling/repository-check` 使用 TypeScript AST 分析静态导入、动态导入、re-export 和 `require`，并结合 workspace manifests 自动阻止：

- `game-sdk`、`protocol` 或 `game-server-runtime` 指向具体游戏；
- 游戏 package 互相依赖，以及 registry 以外的 package 直接组合具体游戏；
- Game Core 导入 game-sdk 与 Zod 之外的运行时依赖，或使用 Node/React/Next.js/Colyseus/数据库/网络模块；
- 跨 package 相对路径和未导出的 package deep import；
- source module 或 workspace package 循环依赖；
- `ui` 指向网络、房间、游戏或数据库 package。

CI 在 Ubuntu 干净环境中启动固定 `postgres:17.6-alpine3.22` service，使用 lockfile 安装精确匹配的 Chromium，然后依次运行 lint/dependency checks、typecheck、unit tests、真实 PostgreSQL tests、真实 Colyseus integration、build 和 PostgreSQL-backed Playwright E2E。每个数据库 suite 只清理自己验证过前缀的随机数据库。
