# Online Game Hub

这是一个 server-authoritative、replay-first 的多人网页游戏平台 monorepo。当前已完成 M3：Game SDK、Protocol V1、显式 registry、Tic-Tac-Toe 1.0.0 Core、canonical replay，以及可由两个真实 Colyseus 客户端使用的 authoritative Game Server。Next.js 网页、React 游戏 UI 和数据库仍未实现。

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
```

`pnpm lint` 同时执行格式、ESLint、本地 Markdown 链接和依赖边界检查。`pnpm test` 包含 Game SDK、Protocol、Tic-Tac-Toe Core、registry、runtime ports、replay/store tests、Game Server unit tests，以及故意违规的隔离 fixture。`pnpm test:integration` 在随机本地端口启动真实 Colyseus transport，并运行双客户端 authoritative match、reconnect 和 replay 验证；它不是空脚本，CI 会执行。

所有当前支持 `gameVersion` 的 golden replay 可单独运行：

```sh
pnpm --filter @online-game-hub/tic-tac-toe test:golden
```

`test:e2e` 将在 M4 浏览器能力真正出现后建立；当前不提供会产生虚假成功的空脚本。

Colyseus 的可选 `msgpackr-extract` 原生加速不影响协议正确性，仓库在 `pnpm-workspace.yaml#allowBuilds` 中明确拒绝其 install script，使用纯 JavaScript fallback。依赖版本与 lockfile 必须继续由 pnpm 维护。

## Game Server 运行边界

`apps/game-server` 导出无副作用的 `createGameServer(options)` composition API。调用方必须注入可信 `TicketVerifier`，再显式调用 `start({ hostname, port })`；测试使用 `port: 0`，生产 adapter 可配置确定端口。`start` 返回实际 HTTP/WebSocket 地址，`stop()` 执行 graceful shutdown。服务暴露：

- `GET /health`：JSON health check；Colyseus 同时保留 `GET /__healthcheck`；
- `GET /metrics`：内存 metric samples，不包含 State、seed 或 bearer secret；
- `/matchmake/*` 与 WebSocket：Colyseus 创建/加入和房间消息 transport。

M3 只提供 `@online-game-hub/game-server-runtime/testing` 下的签名测试 ticket authority；正式 Web issuer/verifier adapter 属于 M4。服务默认使用内存 `RoomStore`/`ReplayStore`，重启后不恢复活动房间。

## Workspace 结构

```text
apps/
  game-server/             # Colyseus composition root、health/metrics 与真实 integration tests
  web/                     # 空的 Web composition root
packages/
  database/                # 仅 package 外壳；无数据库实现
  game-client-sdk/         # 空 public entry
  game-registry/           # 显式 catalog/client/server 组合与 exact resolution
  game-sdk/                # JSON/definition 类型与 deterministic RNG V1
  game-server-runtime/     # auth/room ports、authoritative pipeline、Colyseus room、reconnect 与 replay
  protocol/                # Protocol V1 strict Zod schemas 与推导类型
  ui/                      # 空 public entry
games/
  tic-tac-toe/             # 单 package：manifest/core/client + 1.0.0 golden replay
tooling/
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

CI 在 Ubuntu 干净环境中使用 lockfile 安装，然后依次运行 lint、typecheck、test 和 build。
