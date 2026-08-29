# Online Game Hub

这是一个 server-authoritative、replay-first 的多人网页游戏平台 monorepo。当前工程只完成 M1 的仓库与质量门禁基础，不包含网页、Game Server、游戏规则或数据库实现。

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
```

`pnpm lint` 同时执行格式、ESLint、本地 Markdown 链接和依赖边界检查。`pnpm test` 包含故意违规的隔离 fixture，证明边界检查在违规时会失败。

`test:integration` 与 `test:e2e` 会在对应运行时和浏览器能力出现时分别于 M3/M4 建立；M1 不提供会产生虚假成功的空脚本。

## Workspace 结构

```text
apps/
  game-server/             # 空的服务端 composition root
  web/                     # 空的 Web composition root
packages/
  database/                # 仅 package 外壳；无数据库实现
  game-client-sdk/         # 空 public entry
  game-registry/           # 空 catalog/client/server public entries
  game-sdk/                # 空 public entry
  game-server-runtime/     # 空 public entry
  protocol/                # 空 public entry
  ui/                      # 空 public entry
games/                     # M2 才创建首个实际游戏 package
tooling/
  repository-check/        # 依赖、循环、Markdown 链接检查及 fixture tests
tools/                     # 未来面向开发者的 CLI；M1 不创建生成器
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
