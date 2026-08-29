# Online Game Hub

这是一个 server-authoritative、replay-first 的多人网页游戏平台 monorepo。当前已完成 M4：Next.js App Router Web、匿名 guest session、正式短期 ticket、通用 browser client host、Tic-Tac-Toe Client Module，以及真实双浏览器/Colyseus E2E。Protocol V1、replay format V1 和 Tic-Tac-Toe 1.0.0 保持不变；数据库与正式账号仍未实现。

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
pnpm test:integration
pnpm test:e2e
```

`pnpm lint` 同时执行格式、ESLint、本地 Markdown 链接和依赖边界检查。`pnpm test` 包含 Game SDK、Protocol、Tic-Tac-Toe Core、registry、runtime ports、replay/store tests、Game Server unit tests，以及故意违规的隔离 fixture。`pnpm test:integration` 在随机本地端口运行真实 Colyseus 双客户端 tests；`pnpm test:e2e` 先构建 workspace，再以随机回环端口启动真实 Next production app 和真实 Colyseus Server，运行双 browser-context Playwright。两者都不是空脚本，CI 都会执行。

所有当前支持 `gameVersion` 的 golden replay 可单独运行：

```sh
pnpm --filter @online-game-hub/tic-tac-toe test:golden
```

首次在本机运行浏览器测试前执行 `pnpm exec playwright install chromium`；CI 使用 `--with-deps chromium` 安装精确匹配的浏览器。

Colyseus 的可选 `msgpackr-extract` 原生加速不影响协议正确性，仓库在 `pnpm-workspace.yaml#allowBuilds` 中明确拒绝其 install script，使用纯 JavaScript fallback。依赖版本与 lockfile 必须继续由 pnpm 维护。

## M4 依赖 ownership

| 依赖                                                                                             | Owner                          | 版本与不可替代原因                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `next` 16.3.3                                                                                    | `apps/web`                     | 提供 App Router、server route、Proxy、生产 build/start；现有 TypeScript/React 工具链不提供这些 Web runtime 能力。                |
| `react` / `react-dom` 19.2.8                                                                     | `apps/web` 与 game client peer | 与 Client Module 的精确 peer 对齐，负责实际浏览器渲染；未引入额外状态管理框架。                                                  |
| `@colyseus/sdk` 0.18.2                                                                           | `game-client-sdk`              | 与 Core 0.18.10 / WS transport 0.18.2 的协议代际对齐，提供真实 matchmaking/WebSocket lifecycle；不能由服务端 transport 替代。    |
| `server-only` 0.0.1                                                                              | `apps/web`                     | 在 Next 构建期阻止含 secret 的 runtime config 被客户端模块引用；TypeScript 类型本身不能建立 bundle 边界。                        |
| `@playwright/test` 1.62.1                                                                        | `tooling/e2e` / CI             | 与 Next 16 的 Playwright peer 范围兼容，提供隔离 contexts 和真实 Chromium 自动化；Vitest/Colyseus SDK 不能验证浏览器 cookie/UI。 |
| `@types/node` 24.13.3、`@types/react` 19.2.18、`@types/react-dom` 19.2.5、`@types/express` 5.0.6 | 各直接 TypeScript consumer     | 分别与 Node 24、React 19.2 和 Express 5 对齐，仅用于 strict compile，不进入运行时 bundle。                                       |

## 本地启动与停止

Web 和 Game Server 是两个独立进程。先分别复制 `apps/web/.env.example` 和 `apps/game-server/.env.example` 为同目录下被忽略的 `.env.local`，将占位符替换为至少 32 UTF-8 bytes 的独立随机 secret。两端的 `GAME_SERVER_TICKET_ISSUER` 和 `GAME_SERVER_TICKET_SECRET` 必须完全一致；Web 的 `GAME_SERVER_PUBLIC_URL` 必须是浏览器可访问的 Game Server HTTP(S) 地址，Game Server 的 `GAME_SERVER_ALLOWED_WEB_ORIGINS` 必须包含 Web origin。guest session secret 与 ticket secret 不得复用。

在两个终端从 workspace root 启动：

```sh
pnpm --filter @online-game-hub/game-server dev
pnpm --filter @online-game-hub/web dev
```

默认地址分别为 `http://127.0.0.1:2567` 和 `http://127.0.0.1:3000`。开发和测试可在 loopback HTTP 上显式配置 `GUEST_COOKIE_SECURE=false`；生产环境强制 HTTPS public URL/origin 和 Secure guest cookie。生产式运行先执行 `pnpm build`，再分别运行两个 package 的 `start`。发送 `SIGINT`/`SIGTERM`（终端中通常是 Ctrl+C）会停止进程；Game Server 会执行 graceful shutdown。测试使用随机 loopback 端口，不读取这些固定开发端口，也不访问外部服务。

## Game Server 运行边界

`apps/game-server` 导出无副作用的 `createGameServer(options)` composition API。调用方必须注入可信 `TicketVerifier`，再显式调用 `start({ hostname, port })`；测试使用 `port: 0`，生产 adapter 可配置确定端口。`start` 返回实际 HTTP/WebSocket 地址，`stop()` 执行 graceful shutdown。服务暴露：

- `GET /health`：JSON health check；Colyseus 同时保留 `GET /__healthcheck`；
- `GET /metrics`：内存 metric samples，不包含 State、seed 或 bearer secret；
- `/matchmake/*` 与 WebSocket：Colyseus 创建/加入和房间消息 transport。

生产入口 `createProductionGameServer(config, overrides?)` 使用 `@online-game-hub/game-server-ticket` 的 HMAC adapter 注入 verifier，并配置 Web origin allowlist；生产代码不导入 testing subpath。`@online-game-hub/game-server-runtime/testing` 的 `TestTicketAuthority` 只供 contract/integration tests。服务默认使用内存 `RoomStore`/`ReplayStore`，重启后不恢复活动房间。

## Workspace 结构

```text
apps/
  game-server/             # Colyseus composition root、health/metrics 与真实 integration tests
  web/                     # Next.js App Router、guest cookie、ticket route 与游戏页面
packages/
  database/                # 仅 package 外壳；无数据库实现
  game-client-sdk/         # 通用 browser host、ticket provider 与 Client Module contract
  game-registry/           # 显式 catalog/client/server 组合与 exact resolution
  game-sdk/                # JSON/definition 类型与 deterministic RNG V1
  game-server-runtime/     # auth/room ports、authoritative pipeline、Colyseus room、reconnect 与 replay
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

CI 在 Ubuntu 干净环境中使用 lockfile 安装精确匹配的 Chromium，然后依次运行 lint/dependency checks、typecheck、unit tests、真实 Colyseus integration、build 和真实 Playwright E2E。
