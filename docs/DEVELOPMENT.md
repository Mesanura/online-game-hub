# 本地开发

以下命令从仓库根目录执行。完整服务栈部署见 [Docker Compose 指南](./DEPLOYMENT_DOCKER_COMPOSE.md)，测试环境见 [测试策略](./TESTING.md)。

## 环境与安装

- Node.js `24.14.0`、pnpm `11.24.0`，版本由 [package.json](../package.json)、[.node-version](../.node-version) 和 [.nvmrc](../.nvmrc) 固定。
- PostgreSQL；建议与 CI 使用相同的 `postgres:17.6-alpine3.22`。
- Docker 是本地真实数据库测试的要求；已有开发数据库时，启动应用本身不要求 Docker。

```sh
corepack enable
corepack install
pnpm install --frozen-lockfile
```

## 配置服务与数据库

复制两个服务的环境变量示例：

```sh
cp apps/web/.env.example apps/web/.env.local
cp apps/game-server/.env.example apps/game-server/.env.local
```

PowerShell 使用：

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/game-server/.env.example apps/game-server/.env.local
```

按 [Web 示例](../apps/web/.env.example) 与 [Game Server 示例](../apps/game-server/.env.example) 替换占位值：

| 配置                                                      | 要求                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                                            | 两个服务使用同一个已创建的开发数据库                        |
| `GAME_SERVER_TICKET_ISSUER` / `GAME_SERVER_TICKET_SECRET` | 两个服务完全一致；密钥至少 32 UTF-8 bytes                   |
| `GUEST_SESSION_SECRET`                                    | 仅 Web 使用，与 ticket secret 独立，至少 32 UTF-8 bytes     |
| `GAME_SERVER_PUBLIC_URL`                                  | 浏览器可达的 Game Server 地址，默认 `http://127.0.0.1:2567` |
| `GAME_SERVER_ALLOWED_WEB_ORIGINS`                         | 包含实际打开的 Web origin，默认 `http://127.0.0.1:3000`     |
| `APP_ENV` / `GUEST_COOKIE_SECURE`                         | 本地 HTTP 使用 `development` / `false`；公网配置见部署指南  |

应用不会自动创建数据库或执行 migration。先创建空数据库，再把同一个开发 DSN 显式提供给根 migration 命令；根命令不会替你读取服务的 `.env.local`：

```sh
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/online_game_hub pnpm db:migrate
```

PowerShell 使用：

```powershell
$env:DATABASE_URL = 'postgresql://user:password@127.0.0.1:5432/online_game_hub'
pnpm db:migrate
Remove-Item Env:DATABASE_URL
```

示例 DSN 中的用户、密码和数据库名应替换为本机配置。不要提交 `.env.local`；不要将开发数据库用作测试数据库。

## 构建并启动

首次运行或更新游戏画面后，构建 workspace 并发布本地 Surface 静态文件：

```sh
pnpm build
pnpm surface:verify
pnpm surface:publish
```

在两个终端分别运行：

```sh
pnpm --filter @online-game-hub/game-server dev
```

```sh
pnpm --filter @online-game-hub/web dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，并确认 [Game Server health](http://127.0.0.1:2567/health) 返回成功。两名或更多玩家通过邀请进入同一房间，完成游戏设置并分别准备后开局。

Web 与 Game Server 分别加载自己的 `.env.local`。workspace 依赖通常通过构建产物消费；修改共享包后重新构建受影响包，必要时重启服务。Surface 源码不由 Next 编译，独立开发与版本更新流程见 [Game Surface 规范](./GAME_SURFACE_SPEC.md)。

## 开发与验证入口

- 新游戏先确定 runtime、规则和 replay 能力，再按 [Game Plugin 规范](./GAME_PLUGIN_SPEC.md) 接入。[create-game 工具](../tools/README.md) 可生成回合制 V6 Setup 与 Bridge V2 Surface 草稿；草稿可独立构建，正式登记与发布按生成的清单完成。
- 独立画面可在 [Surface Workbench](./GAME_SURFACE_SPEC.md#独立开发与-workbench) 中调试，无需启动 Web、Game Server 或数据库。
- 静态、Core、integration、数据库与浏览器检查按 [TESTING.md](./TESTING.md) 选择；首次 E2E 前安装 Chromium。

## 常见问题

| 现象                          | 排查                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Node/pnpm 版本不匹配          | 核对固定版本，重新运行 `corepack enable` 和 `corepack install`                               |
| migration 连接失败            | 确认 PostgreSQL 已启动、数据库已创建，终端 DSN 与服务配置一致                                |
| 网页可访问但无法创建/加入房间 | 检查 `/health`、浏览器可达的 Game Server URL、Web origin 和两端 issuer/secret                |
| 游戏画面不可用或摘要校验失败  | 检查 Surface 构建、版本锁和 exact deployment 映射，再执行 verify/publish；不要覆盖已发布版本 |
| 重启后对局消失                | 当前不恢复 live room 或权威 State；只有已持久化的 Match/replay/history 保留                  |

`localhost` 与 `127.0.0.1` 是不同 origin；修改端口或主机名时同步更新 URL 与 allowlist。
