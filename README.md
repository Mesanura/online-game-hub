# Online Game Hub

多人在线网页游戏平台，采用 TypeScript monorepo、Next.js 和 Colyseus。浏览器提交操作意图，服务器验证规则、推进状态并记录可验证的比赛回放。

支持井字棋、四子棋、五子棋、六贯棋、黑白棋、中国跳棋、乒乓对战（Pong）、火柴人羽毛球和坦克迷战，覆盖双人棋牌、2–6 人跳棋和 2–8 人实时对战。规则与版本见 [游戏索引](./games/README.md)。

- 游客无需注册即可创建私人房间、邀请好友、准备、对局、重连和重新开局。
- 用户名与密码账户提供私有比赛历史；登录不会认领此前的游客比赛。
- 棋牌支持参赛账户的私有回放；三款实时游戏目前只保存服务端记录和账户战绩。
- Game Core、逐局 Setup 和独立 Game Surface 分工明确，游戏通过显式注册接入平台。

## 运行

- **本地开发**：需要 Node.js `24.14.0`、pnpm `11.24.0` 和 PostgreSQL。按 [本地开发指南](./docs/DEVELOPMENT.md) 安装依赖、配置环境、迁移数据库并启动两个服务。
- **Docker 部署**：按 [Docker Compose 指南](./docs/DEPLOYMENT_DOCKER_COMPOSE.md) 拉取镜像并运行完整服务栈，无需在部署机器安装 Node.js。

默认 Web 地址为 [http://127.0.0.1:3000](http://127.0.0.1:3000)，Game Server 健康检查为 [http://127.0.0.1:2567/health](http://127.0.0.1:2567/health)。当前只支持单个 Game Server；重启会终止进行中的对局，已保存的比赛记录保留。

## 开发入口

| 内容               | 位置                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| Web 与 Game Server | [apps/web](./apps/web)、[apps/game-server](./apps/game-server)               |
| 平台契约与运行时   | [packages](./packages)、[系统架构](./docs/ARCHITECTURE.md)                   |
| 游戏规则与画面     | [games](./games/README.md)、[Game Surface 规范](./docs/GAME_SURFACE_SPEC.md) |
| 检查与测试         | [测试策略及命令](./docs/TESTING.md)                                          |
| 开发约束与当前阶段 | [AGENTS.md](./AGENTS.md)、[路线图](./docs/ROADMAP.md)                        |

完整文档导航见 [docs/README.md](./docs/README.md)。
