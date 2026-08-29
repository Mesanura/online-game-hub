# 开发路线图

> 状态：V1 路线  
> 本文是项目阶段顺序和里程碑退出条件的权威来源。里程碑按依赖排序，不承诺具体日期。

## 原则

- 完成当前里程碑的退出条件后再扩大范围。
- 每个阶段留下可运行检查和明确 public API。
- Tic-Tac-Toe 用于验证架构，不并行堆叠更多游戏。
- 基础设施只在当前产品需求或测量结果证明必要时引入。
- Roadmap 变化不得绕过 [PRODUCT.md](./PRODUCT.md) 的明确非目标和 [ARCHITECTURE.md](./ARCHITECTURE.md) 的依赖边界。

## M0：架构基线

交付：

- 产品、架构、插件、协议、replay、测试和路线图文档；
- 根 `AGENTS.md`；
- 已确定、暂缓和当前不做的决策清单；
- 推荐目录与依赖方向。

退出条件：八个 Markdown 文件通过范围、链接和一致性检查；没有生产代码、配置或依赖。

## M1：Repository 与 Monorepo 基础

> 实施状态：已完成（2026-08-30）。稳定根命令、干净安装和故意违规 fixture 已通过验证。

目标：建立可验证的工程外壳，不实现游戏或在线功能。

交付：

- 经用户确认后初始化 Git；
- pnpm workspace、Turborepo 和 pinned Node/pnpm 版本；
- strict TypeScript 基础配置；
- ESLint、格式化和 import boundary/cycle checks；
- `apps`、`packages`、`games`、`tooling` 的最小 workspace package manifests 与 public exports；
- 根 `lint`、`typecheck`、`test`、`build` 命令和最小 CI；
- 贡献说明或 README，指向本文档体系。

退出条件：空实现 package 能在干净环境安装、typecheck、lint、test 和 build；边界检查能用故意违规 fixture 证明有效。

不做：Next.js 页面、Colyseus room、Tic-Tac-Toe 规则、数据库或 UI。

## M2：Game SDK、Protocol 与 Tic-Tac-Toe Core

> 实施状态：已完成（2026-08-30）。Game/Protocol/registry public API、Tic-Tac-Toe 1.0.0 Core、内存 replay store/verifier 与 golden fixture 已通过全仓质量门禁。

目标：用纯逻辑证明插件和 replay 契约可实现。

交付：

- `game-sdk` 类型、JSON 约束和 deterministic RNG；
- `protocol` V1 Zod schemas 与 type tests；
- 显式 registry 的 manifest/server 基础；
- Tic-Tac-Toe manifest、Core、规则说明和局部 `AGENTS.md`；
- in-memory replay record/runner；
- Core、determinism、projection 和 golden replay tests。

退出条件：相同 replay 可重复重建相同 State、RNG cursor 和 Outcome；Core 禁止依赖检查通过；没有网络或 React 依赖。

## M3：Authoritative Game Server

> 实施状态：已完成（2026-08-30）。独立 Colyseus composition root、ticket/runtime ports、authoritative room、reconnect、replay commit 与真实双客户端 integration tests 已通过全仓质量门禁。

目标：建立两连接可使用的通用 server runtime。

交付：

- 独立 Colyseus Game Server；
- ticket verification port 与测试 issuer；
- 创建/加入房间、room code 和 stable slots；
- 串行 Action pipeline、revision、idempotency 和 per-viewer snapshot；
- in-memory `RoomStore`，并将 M2 `ReplayStore` 接入 authoritative room commit；
- 60 秒 reconnect 与 fake-clock integration tests；
- health check、结构化日志和最小指标。

退出条件：两个测试客户端可完成权威对局；伪造 actor、stale revision、重复命令和未授权重连测试通过。

## M4：Web Vertical Slice

> 实施状态：已完成（2026-08-30）。Next.js/guest/ticket/client host/Tic-Tac-Toe UI 已形成真实 Web vertical slice；双 browser-context Playwright 已验证胜局、平局、恶意 intent、reconnect、cookie 隔离、abandoned 和 canonical replay。

目标：完成用户可操作的 Tic-Tac-Toe 端到端链路。

交付：

- Next.js 首页、游戏目录和 Tic-Tac-Toe 页面；
- 匿名 guest session 和短期连接 ticket；
- 创建房间、房间码及邀请链接加入；
- `game-client-sdk` host 与 Tic-Tac-Toe Client Module；
- 连接、重连、错误和终局的最小 UI；
- 两 browser contexts 的 Playwright E2E。

退出条件：两名访客能在浏览器完成一场比赛；刷新后在宽限期内恢复；canonical replay 验证通过。

## M5：持久化与账号基础

开始条件：M4 稳定，产品确认需要跨重启历史。

候选交付：

- PostgreSQL + Drizzle 基础和 migrations；
- `User`、`Match`、`MatchPlayer`、`Replay` 的最小 schema；
- durable `ReplayStore` 和比赛历史读取；
- guest-to-account 身份迁移；
- 数据保留、删除和 replay 访问控制。

此阶段再决定事务/outbox、认证供应商和隐私政策，不在早期文档中虚构实现。

## M6：验证插件扩展性

按顺序增加少量规则类型不同的游戏：

1. Connect Four：验证不同棋盘和胜负扫描；
2. Gomoku：验证更大棋盘与规则变体 Config；
3. Reversi：验证翻转、无合法行动和跳过回合。

每新增一个游戏前复盘：需要修改多少平台文件、registry 步骤是否机械、SDK 是否出现游戏特例。只有流程稳定后才实现 `tools/create-game`。

## M7：按证据扩展平台

以下能力不预先排序，在产品需求和运行指标出现后单独立项：

- Matchmaking、排行榜、Rating、Friendship；
- 观战、观众延迟和公开 replay；
- Redis presence/driver、多 Game Server 实例和 room ownership；
- 长比赛 checkpoint 和服务重启恢复；
- 隐藏信息卡牌游戏及其 replay 权限；
- 独立 realtime runtime 与 Phaser 游戏；
- 多区域读取、容灾或更细服务拆分。

## 下一轮建议

M4 已完成。下一轮只执行 M5，并先确认产品确实需要跨重启历史：设计最小 PostgreSQL/Drizzle schema、migration/transaction 边界和 replay 访问控制，再实现 durable `ReplayStore`、比赛历史读取与 guest-to-account 迁移。认证供应商、outbox 和隐私/保留策略应在该轮基于实际持久化需求决定；不要混入 Lobby、Matchmaking、排行榜、观战、replay 播放器、Redis、多实例或 M6 新游戏。
