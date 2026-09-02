# Online Game Hub

Online Game Hub 是一个面向在线棋类游戏的 TypeScript monorepo，现同时支持双人游戏与 2–6 人中国跳棋。平台采用服务端权威模型：浏览器只提交操作意图，Game Server 负责验证规则、推进状态和记录回放。

## 1. 软件定位与功能

项目提供可复用的多人网页游戏平台能力，并以独立游戏插件承载具体规则。当前已支持：

- 井字棋、四子棋、五子棋、六贯棋、黑白棋和多人中国跳棋；
- 匿名访客创建房间、邀请码加入、选择先手与双方准备；
- 服务端权威对局、断线重连、同一房间多轮游戏；
- 游客无需注册即可完整对局；用户名+密码账户、可撤销登录态和账户私有比赛历史；
- 已完成比赛的 PostgreSQL 持久化和可验证的 canonical replay；
- 显式注册的 Game Plugin，可通过 `pnpm create-game --game-id <id>` 创建开发骨架。

游客可玩但没有历史或 replay 读取入口；注册/登录不会认领此前游客比赛，只有 Round 开始时已登录的玩家才归属账户。M7-B 已提供账户私有 replay UI：只有登录态参赛者可读取，响应只包含服务端逐帧 `projectView`；浏览器不会收到 canonical replay、seed、raw State 或 Actions。邮箱、OAuth、找回密码、公开回放、观战、匹配大厅和多实例协调尚未实现。

## 2. 运行代码

### 环境要求

- Node.js `24.14.0`；
- pnpm `11.24.0`，通过 Corepack 管理；
- PostgreSQL，用于本地持久化运行；
- 可选：Docker Compose，用于部署完整服务栈。

安装依赖：

```sh
corepack enable
corepack install
pnpm install --frozen-lockfile
```

### 配置数据库与服务

分别复制环境变量示例，并替换其中的数据库 URL 和密钥占位符：

```sh
cp apps/web/.env.example apps/web/.env.local
cp apps/game-server/.env.example apps/game-server/.env.local
```

PowerShell 可使用：

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/game-server/.env.example apps/game-server/.env.local
```

两个服务必须使用同一个 `DATABASE_URL`，并且 `GAME_SERVER_TICKET_ISSUER`、`GAME_SERVER_TICKET_SECRET` 必须完全相同。请先创建空数据库，再从仓库根目录执行 migration：

```sh
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/online_game_hub pnpm db:migrate
```

PowerShell 中先设置 `$env:DATABASE_URL`，再运行 `pnpm db:migrate`。开发环境可在 `.env.local` 中保留 `APP_ENV=development` 和 `GUEST_COOKIE_SECURE=false`；生产环境必须使用 HTTPS 和安全 Cookie。

### 启动开发服务

在两个终端分别运行：

```sh
pnpm --filter @online-game-hub/game-server dev
```

```sh
pnpm --filter @online-game-hub/web dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。Game Server 默认监听 `http://127.0.0.1:2567`，可通过 [health endpoint](http://127.0.0.1:2567/health) 确认状态。

Docker Compose 单机部署、生产配置和数据备份见 [部署文档](./docs/DEPLOYMENT_DOCKER_COMPOSE.md)。

## 3. 使用说明

1. 在首页选择游戏并创建房间。
2. 将房间邀请链接发送给另一名玩家；对方加入后，双方选择本轮先手并准备开始。
3. 对局页面只展示服务器下发的当前视图。落子、投降和终局均由服务端判定。
4. 对局结束后可在同一房间设置下一轮；短暂断线会尝试恢复原有席位。

开发新游戏时，可先运行：

```sh
pnpm create-game --game-id example-game
```

该命令只生成 package 和登记骨架。游戏规则、客户端界面、测试与回放 fixture 仍须按 [Game Plugin 规范](./docs/GAME_PLUGIN_SPEC.md) 完成。

## 4. 代码结构与基本原理

```text
apps/
  web/                 Next.js 页面、匿名身份与连接票据
  game-server/         Colyseus 服务、房间生命周期和权威执行入口
packages/
  game-sdk/            JSON 类型、游戏定义和确定性 RNG
  protocol/            网络消息 schema 与类型
  game-server-runtime/ 通用房间、动作和 replay 管线
  game-client-sdk/     浏览器连接与游戏 Client Module 合约
  game-registry/       游戏的显式 catalog 与解析
  database/            PostgreSQL schema、migration 和持久化适配器
games/                 每个游戏独立的 manifest、Core、Client 和测试
tooling/               仓库检查、E2E 与测试工具
tools/create-game/     新游戏机械骨架生成器
```

一次对局遵循以下流程：浏览器取得 Web 签发的短期 ticket，连接 Game Server 并提交 action intent；服务端根据 stable slot、revision 和游戏 Core 验证 action，只有被接受的 action 才会推进状态、写入 replay，并经 `projectView` 投影给各自客户端。平台负责身份、房间、网络、重连与回放；游戏包只负责确定性的状态、规则与结果。

架构、协议和版本兼容性以 [系统架构](./docs/ARCHITECTURE.md)、[网络协议](./docs/NETWORK_PROTOCOL.md) 与 [Replay 设计](./docs/REPLAY_DESIGN.md) 为准。

## 5. 常见问题

**安装时 pnpm 或 Node.js 版本不匹配**

确认正在使用 Node.js `24.14.0`，然后运行 `corepack enable` 和 `corepack install`。项目的准确版本记录在 `package.json`、`.nvmrc` 和 `.node-version`。

**migration 无法连接数据库**

确认 PostgreSQL 已启动、目标数据库已创建，且当前终端的 `DATABASE_URL` 与两个 `.env.local` 中的值一致。应用启动不会自动执行 migration。

**网页能打开，但无法创建或加入房间**

检查 Game Server 是否可访问 `/health`，Web 的 `GAME_SERVER_PUBLIC_URL` 是否为浏览器可访问的地址，以及两个服务的 ticket issuer 和 secret 是否完全一致。浏览器地址也必须包含在 `GAME_SERVER_ALLOWED_WEB_ORIGINS` 中。

**重启服务后正在进行的对局不见了**

当前 live room 和权威 State 只保存在 Game Server 内存中；已完成的比赛、replay 和历史记录会持久化到 PostgreSQL。服务重启不会恢复进行中的对局。

完整的质量检查、测试层级和改动对应验证见 [测试策略](./docs/TESTING.md)。产品范围、路线图、贡献约束和开发工具说明分别见 [产品文档](./docs/PRODUCT.md)、[开发路线图](./docs/ROADMAP.md)、[AGENTS.md](./AGENTS.md) 与 [tools 文档](./tools/README.md)。
