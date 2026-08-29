# 测试策略

> 状态：V1 策略（M3 server integration 已实现，M4 browser E2E 待实现）  
> 本文是测试层级、职责、最低场景和质量门禁的权威来源。具体业务范围见 [PRODUCT.md](./PRODUCT.md)。

## 1. 目标

测试体系必须让开发者和 Agent 快速回答：

- Game Core 的规则、确定性和不变量是否仍然成立；
- Game Server 是否真正 authoritative；
- 玩家、观众和重连连接是否只收到有权看到的数据；
- replay 是否仍能被对应 `gameVersion` 重建；
- 两个真实浏览器是否能完成创建、加入、对局和重连；
- package public API 和依赖方向是否被破坏。

优先把规则覆盖放在快速、无网络的 Core tests；只把跨 package、transport 或浏览器行为放入较慢层级。

## 2. 测试层级

```text
                 Playwright E2E
              Multiplayer integration
             Server/Protocol integration
            Replay compatibility tests
              Game Core unit tests
          Static types / dependency checks
```

越靠下运行越快、失败定位越直接，应覆盖更多组合。E2E 只验证关键用户旅程，不复制所有规则排列。

## 3. Static 与 Architecture Checks

当前 Monorepo 基线提供：

- strict TypeScript typecheck；
- ESLint 及 import boundary 规则；
- package export map 检查；
- 循环依赖检查；
- 禁止 Core 使用 `Math.random()`、DOM、React、Next.js、Colyseus、WebSocket、ORM、Redis 或跨游戏 import；
- 格式与 Markdown link 检查；
- `pnpm-lock.yaml` 与 workspace manifest 一致性检查。

依赖边界以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准。检查必须自动化，不能只依赖 code review 记忆。

## 4. Game Core Unit Tests

每个游戏在自己的 package 中使用 Vitest 测试，不启动浏览器、网络或数据库。

### 4.1 必测类别

| 类别            | 最低场景                                                                |
| --------------- | ----------------------------------------------------------------------- |
| Initialization  | 同一 Config、slots、seed 产生相同 State/RNG；非法 Config 被 schema 拒绝 |
| Legal actions   | 每种 Action 的合法路径、轮次推进和预期 State                            |
| Illegal actions | 错误 slot、错误回合、越界输入、占用位置、终局后动作；State/RNG 不变     |
| Outcome         | 每种获胜路径、平局、未结束状态和终局不可继续                            |
| Immutability    | 输入 State、Action、Config 和 RNG 不被修改                              |
| Serialization   | State/View/Action/Outcome 是 JSON-safe，无 class/Date/BigInt/undefined  |
| Projection      | 每种 viewer 只得到被授权字段，State 不直接泄漏                          |
| Determinism     | 相同输入重复运行得到深度相等的 State、RNG 和 Outcome                    |

Tic-Tac-Toe 至少覆盖所有获胜方向、平局、重复落子、错误回合、越界 cell 和终局后落子。

### 4.2 Property 与 Table-driven Tests

- 对有限规则优先使用 table-driven cases 表达规则矩阵。
- 对棋盘不变量、动作序列和序列化可加入 property-based tests，但只有在能稳定复现失败 seed 时才引入额外依赖。
- 测试使用固定 seed；禁止依赖真实时钟、随机测试顺序或网络。

## 5. Replay Compatibility Tests

Replay tests 使用真实 Game Definition 和 in-memory fixtures，不启动 Colyseus。

最低场景：

- 从 header 和 accepted actions 重建与记录相同的 Outcome、最终 State 和 RNG cursor；
- 同一 replay 多次运行结果完全一致；
- sequence gap、重复 sequence、未知 game/version、错误 actor、schema-invalid Action 和被 Core 拒绝的历史可靠失败；
- rejected、duplicate 和 stale command 不进入 canonical actions；
- `ReplayStore.append` 拒绝乱序并保持已有记录不变；
- `complete` 幂等，且拒绝冲突 Outcome；
- 每个仍受支持的 `gameVersion` 至少保留一个 golden replay。

Golden fixture 只在确认规则或版本策略变化后更新。不能通过覆盖 fixture 来隐藏意外行为变化。

## 6. Protocol Contract Tests

对 `protocol` 的 Zod schemas 和序列化进行独立测试：

- 接受当前 `protocolVersion` 的合法 envelope；
- 拒绝缺字段、未知 discriminator、超大 payload、非法 revision 和不支持版本；
- 确认 `action` 在通用层保持 `unknown`，并由选中的 game schema 再解析；
- server response 不包含 stack、ticket、cookie、完整 State 或 RNG seed；
- encode/decode round trip 保持稳定字段；
- platform error 与 `gameRuleCode` 的映射不混淆。

## 7. Game Server Integration Tests

Server integration tests 位于 `apps/game-server/tests/game-server.integration.test.ts`，使用 `port: 0` 启动真实 `game-server-runtime`、Colyseus room、WebSocket transport 和 in-memory stores。两个独立 `@colyseus/sdk` 客户端走真实 matchmaking/WebSocket；只把 clock、ID、ticket authority 和故障注入 store 作为可控 ports，不 mock 被验证的 room/Action pipeline。

### 7.1 Authoritative 与安全

- 伪造 actor 字段不会改变服务器从 session 推导的 actor；最好由 schema 直接拒绝多余字段。
- 非成员连接、错误 slot、过期 ticket 和无效 reservation 不能操作房间。
- schema-invalid Action 不进入 Core。
- stale `expectedRevision` 被拒绝并返回最新 snapshot。
- 同一 `commandId` 重试返回原结果，不重复推进 revision/RNG/replay。
- 两个同时到达的命令按单一顺序处理，不产生双写。
- Game rule rejection 保持 State、revision、RNG 和 replay 不变。

### 7.2 View 与 Lifecycle

- 每个连接只收到 `projectView` 产生的 View。
- M3 使用两个 viewer slot 验证每个 snapshot 都来自 `projectView`，且不含 State、RNG seed 或 Core-only 字段。第一个隐藏信息游戏加入时，再提供最小 fixture 证明不同 slots 不会互相看到秘密字段；不为 M3 虚构新游戏。
- waiting → active → completed/abandoned 转换合法且不可逆。
- Outcome 只由 Core 产生，断线状态只由平台 lifecycle 处理。

### 7.3 Reconnect

- 断线后 60 秒内同一 session 能恢复原 slot 并获得当前完整 snapshot。
- 新有效连接接管后旧连接无法继续提交 Action。
- 不同 session 不能窃取保留 slot。
- 超时后执行房间策略，旧 reconnection token 不再恢复席位。
- V1 明确不测试进程重启后的活动房间恢复。

使用 fake clock 驱动 60 秒超时，测试不得真实等待一分钟。

## 8. Multiplayer Tests

Multiplayer integration 使用两个独立客户端连接同一真实 room，验证：

- 创建者和加入者获得不同稳定 slots；
- 两方看到一致 revision 和各自 View；
- 只有合法玩家可在正确时机行动；
- accepted Action 对双方只产生一次 snapshot 更新；
- 一方断线时另一方收到正确 lifecycle 信息；
- 重连客户端从服务器 snapshot 收敛，而不是依赖本地 action history。

这些测试覆盖网络时序，不承担穷举游戏规则的职责。

M3 的四个真实 integration cases 覆盖：health/metrics 与 ticket trust boundary；双客户端 stable slots、waiting/active/completed、伪造 actor、invalid/stale/duplicate/concurrent/rule-rejected commands、per-viewer snapshot 与 verified canonical replay；replay append failure 不确认/不提交；新 ticket + 新 reservation 的 reconnect、connection takeover、错误 session theft 和 fake-clock 60 秒 abandoned。ticket verifier、ports、composition logger 另有无 transport 的 contract/unit tests。

## 9. Playwright E2E

关键 E2E 使用两个隔离 browser contexts，代表两个匿名访客：

1. 玩家 A 打开主页并进入 Tic-Tac-Toe；
2. A 创建房间并获得房间码/邀请链接；
3. 玩家 B 通过邀请链接加入；
4. 双方交替落子，UI 与 revision 同步；
5. 非当前玩家的操作不能改变服务器状态；
6. 完成一场胜局和一场平局；
7. 一方刷新页面，在宽限期内恢复原 slot 和当前棋盘；
8. 两个 contexts 的 cookie/session 隔离，不可互相接管席位。

E2E 断言用户可见行为和关键网络结果，不依赖 CSS class、内部 React state 或固定端口。测试数据由公开测试 helper 创建，测试结束后清理自己的房间。

## 10. Change-to-Test Matrix

| 改动                    | 最低检查                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| 单游戏 Core             | 该游戏 unit + determinism + replay fixtures + typecheck          |
| Game manifest/client    | registry contract + client component + relevant E2E              |
| `game-sdk`              | 全部游戏 Core/replay + public API type tests + dependency checks |
| `protocol`              | protocol contract + server integration + multiplayer/E2E smoke   |
| `game-server-runtime`   | server integration + multiplayer + replay store tests            |
| session/ticket          | auth contract + join/reconnect + security negative cases         |
| replay format/version   | reader compatibility + all supported golden replays              |
| build/dependency config | full typecheck/lint/unit + affected build graph                  |

## 11. Root Commands

M3 已提供以下稳定根命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm deps:check
pnpm test:integration
```

`pnpm lint` 包含格式、ESLint、本地 Markdown 链接与依赖边界检查。`pnpm test` 纳入 Game SDK、Protocol、Tic-Tac-Toe Core、registry、runtime/replay stores、Game Server unit tests 和 repository-check 的故意违规 fixture tests。`pnpm test:integration` 执行上述真实 Colyseus tests，根 CI 在 unit tests 后、build 前运行它；该命令不是空脚本。

所有当前支持 `gameVersion` 的 golden replay：

```text
pnpm --filter @online-game-hub/tic-tac-toe test:golden
```

浏览器层在真正存在后再建立，不提供空脚本：

```text
pnpm test:e2e          # M4
```

新增 package 必须接入 Turbo task graph，而不是要求 Agent 记忆私有脚本。

## 12. Definition of Done

功能或架构变更只有在以下条件满足时完成：

- 行为测试覆盖成功路径和关键拒绝路径；
- 受影响的 typecheck、lint、unit 和 integration checks 通过；
- 失败测试可重复，不依赖 sleep 或外部公共服务；
- 没有跳过、删除或弱化既有测试来掩盖失败；
- public API、protocol、game/replay version 和文档影响已评估；
- 最终汇报列出实际运行的检查及未运行原因。
