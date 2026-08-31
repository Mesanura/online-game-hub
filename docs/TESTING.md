# 测试策略

> 状态：Protocol V2 测试策略（逐局先手与 Room/Round 分离已纳入）
> 本文是测试层级、职责、最低场景和质量门禁的权威来源。具体业务范围见 [PRODUCT.md](./PRODUCT.md)。

## 1. 目标

测试体系必须让开发者和 Agent 快速回答：

- Game Core 的规则、确定性和不变量是否仍然成立；
- Game Server 是否真正 authoritative；
- 玩家、观众和重连连接是否只收到有权看到的数据；
- replay 是否仍能被对应 `gameVersion` 重建；
- PostgreSQL migrations、durable replay、match archive 和身份关联是否保持事务与授权不变量；
- 两个真实浏览器是否能完成创建、加入、对局和重连；
- package public API 和依赖方向是否被破坏。

优先把规则覆盖放在快速、无网络的 Core tests；只把跨 package、transport 或浏览器行为放入较慢层级。

## 2. 测试层级

```text
                 Playwright E2E
              Multiplayer integration
             PostgreSQL integration
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

井字棋至少覆盖所有获胜方向、平局、重复落子、错误回合、越界 cell 和终局后落子。

四子棋至少覆盖重力、轮次切换、7 个满列、越界 column、非当前玩家、横向/纵向/双对角获胜、合法 42-action 平局、终局拒绝、immutability、serialization、projection 和零 RNG cursor determinism。

五子棋至少覆盖 15×15/19×19 strict Config、默认 Config、初始化、轮次、越界/占用 cell、非当前玩家、横向/纵向/双对角胜局、连续五子以上长连、合法 225-action 满盘平局、终局拒绝、Config/State/Action/RNG immutability、serialization、projection 和零 RNG cursor seeded determinism。

六贯棋至少覆盖 null Config、strict `PLACE_STONE | RESIGN`、固定 11×11 初始化、BLUE 先手、六方向邻接、四边/四角、禁止 row wrap、BLUE/RED 连接、未完成路径、canonical 最短路径与 tie-break、所有领域拒绝顺序、off-turn resignation、无 DRAW、终局拒绝、损坏 State 不变量、immutability、serialization、player/spectator projection 和零 RNG cursor seeded determinism。

黑白棋至少覆盖 null Config、标准 8×8 初始四子与 BLACK/WHITE slot 映射、八方向单线/多线同时翻转、边界/角落/禁止 row wrap、错误 slot/回合/越界/占用/无翻转落子、对方无行动时同 slot 续行、双方无行动的非满盘终局、满盘 BLACK/WHITE 胜局与平局、终局拒绝、Config/State/Action/RNG immutability、serialization、player/spectator projection、服务器 View 的合法落点/棋子数/Outcome 和零 RNG cursor seeded determinism。

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
- Protocol V2 exact schemas 拒绝 V1、缺字段和 extra fields；`room.control` 严格区分 starter 选择/ready/cancel/close，拒绝非法 starter 与 identity 字段；`room.lifecycle` 拒绝不一致 current/next Round、ready/closed 状态；Action/snapshot 的 `roundNumber` 必填并拒绝非法值；
- platform error 与 `gameRuleCode` 的映射不混淆。

## 7. Game Server Integration Tests

Server integration tests 位于 `apps/game-server/tests/game-server.integration.test.ts`，使用 `port: 0` 启动真实 `game-server-runtime`、Colyseus room、WebSocket transport 和 in-memory stores。两个独立 `@colyseus/sdk` 客户端走真实 matchmaking/WebSocket；只把 clock、ID、ticket authority 和故障注入 store 作为可控 ports，不 mock 被验证的 room/Action pipeline。

### 7.1 Authoritative 与安全

- 伪造 actor 字段不会改变服务器从 session 推导的 actor；最好由 schema 直接拒绝多余字段。
- 非成员连接、错误 slot、过期 ticket 和无效 reservation 不能操作房间。
- schema-invalid Action 不进入 Core。
- stale `expectedRevision` 被拒绝并返回最新 snapshot。
- 同一 `commandId` 重试返回原结果，不重复推进 revision/RNG/replay。
- 第二轮 revision 重置后，旧轮 duplicate 仍返回原 outcome 但不进入新轮；缺失/错轮命令 fail closed，旧轮 snapshot 不覆盖当前轮。
- 两个同时到达的命令按单一顺序处理，不产生双写。
- Game rule rejection 保持 State、revision、RNG 和 replay 不变。

### 7.2 View 与 Lifecycle

- 每个连接只收到 `projectView` 产生的 View。
- M3 使用两个 viewer slot 验证每个 snapshot 都来自 `projectView`，且不含 State、RNG seed 或 Core-only 字段。第一个隐藏信息游戏加入时，再提供最小 fixture 证明不同 slots 不会互相看到秘密字段；不为 M3 虚构新游戏。
- 首局允许 `currentRound = null` 且没有 snapshot；满足全部设置条件后直接创建 active Round，active → completed/abandoned 合法且不可逆；同 live room 下一轮创建新的 Match/replay/RNG/revision 序列，不重写上一轮。
- Outcome 只由 Core 产生，断线状态只由平台 lifecycle 处理。
- 房主加入前预选/提前 ready、非房主伪造选择、未选 starter 时拒绝 ready、不同选择清全部 ready、重复选择保留 ready、断线/takeover 只清对应 ready、双方 ready 开新轮、terminal outsider 拒绝、owner close、non-owner leave 和 5 分钟 terminal TTL 都由平台处理。
- 首局与后续轮都注入 Round 启动失败，验证 replay header 已创建而 Match archive 失败时保留相同 pending replay ID/seed/playerOrder，并以新 command ID 幂等重试。

### 7.3 Reconnect

- 断线后 60 秒内同一 session 能恢复原 slot 并获得当前完整 snapshot。
- 新有效连接接管后旧连接无法继续提交 Action。
- 不同 session 不能窃取保留 slot。
- 超时后执行房间策略，旧 reconnection token 不再恢复席位。
- V2 明确不测试进程重启后的 live room 恢复；只验证重启后已完成 replay、match history 仍可读取，并验证启动协调会把单实例遗留的旧 `waiting`/当前 `active` archive 标记为 `abandoned`。从未开始 Round 的 room 不应产生 archive。

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

真实 integration cases 覆盖：health/metrics 与 Protocol V2 ticket trust boundary；井字棋、四子棋、五子棋、六贯棋和黑白棋双客户端 stable slots、无 snapshot setup、active/completed、invalid/rule-rejected commands、per-viewer snapshot 与 verified canonical replay；replay append failure 不确认/不提交；新 ticket + 新 reservation 的 reconnect、connection takeover、错误 session theft 和 fake-clock 60 秒 abandoned；逐局 starter/ready/cancel、相反 `playerOrder`、跨轮 duplicate/错轮防护、terminal outsider、房主关闭、非房主 active leave 和 terminal TTL。井字棋还覆盖房主预选/提前 ready、权限伪造、选择清 ready、首局/后续轮 archive 失败重试；四子棋继续覆盖满列、横向胜局、42-action 平局、两轮独立 replay 与 abandoned 无伪造 Outcome；五子棋以 19×19 Config 覆盖创建/加入、361-cell View、错误回合、占用 cell、9-action 五连胜与 canonical replay；六贯棋覆盖本轮 BLUE/RED role、schema-invalid、错轮、stale、占用、duplicate、21-action canonical path 胜局、再次选择同一先手的第二轮与 RED off-turn `RESIGN` replay。ticket verifier、ports、composition logger 另有无 transport 的 contract/unit tests。

黑白棋 integration 额外覆盖本轮 BLACK/WHITE role、schema-invalid/伪造 actor、错回合与无翻转拒绝不推进 revision/replay、权威翻转、revision 18 后 WHITE 强制连续行动、25-action 非满盘终局、PASS-free canonical replay，以及同房间第二轮 revision 重置、独立 Match/replay 与 11-action 非满盘终局。

## 9. PostgreSQL Integration Tests

`packages/database/tests/database.integration.test.ts` 和 `apps/game-server/tests/database.integration.test.ts` 连接真实 PostgreSQL，不使用 SQLite，也不 mock Drizzle driver。根 `pnpm test:database` 会先构建依赖 package，再执行这两组 tests；缺少显式的测试 DSN 时 fail closed，不会回退或连接默认开发数据库。

测试 owner 必须创建带随机名称的独立 database，并在连接前验证名称前缀；cleanup 只删除该测试自己创建的 database，且先终止属于该 database 的测试连接。Windows 本地开发可用 WSL/Docker 中的精确 PostgreSQL 版本，但测试不得依赖公共固定端口或外部托管服务。CI 使用 `postgres:17.6-alpine3.22` service container，并只把 workflow 创建的测试 credential 注入相关 steps；应用日志、错误和测试制品不得包含 DSN。

最低覆盖：

- 空 database 应用 checked-in migrations，随后由 `db:check` 验证 schema/migration metadata 无漂移；
- replay create/append/complete/get 可由新 connection 和新 adapter 重建，并通过 exact registry 的现有 `verifyReplay`；
- sequence gap、重复/冲突 payload、并发 append 和冲突 completion fail closed；相同重试幂等；
- schema-invalid、stale、duplicate、game-rule rejected command 不增加 `replay_actions`；
- Match/MatchPlayer waiting、active、completed、abandoned archive 及 final revision 正确；completed 必须关联已完成 replay，abandoned 不伪造 Outcome；
- 创建但未开始首局的 live room 没有 Match/MatchPlayer；首局真正启动时直接创建 active Match，旧 waiting rows 继续兼容；
- 同一 `runtime_room_id` 可有连续正整数轮次，但 `(runtime_room_id, round_number)` 唯一；后续轮只接受与 completed 前轮相同 game/version/slot/session 的参与者，并持有独立 replay；
- participants 集合不随 `playerOrder` 反转；两轮 Replay header 的有序 players 与各自 Core 初始化顺序一致；
- guest history 只返回当前 server-verified guest 的安全 metadata，猜测其他 guest 的 match ID 不泄漏参与关系；
- guest-to-account association 在事务中幂等，且不能把已关联记录覆盖到另一 User；
- adapter/connection shutdown 后无遗留 client；数据库错误经稳定 code 清洗，不泄漏 SQL、DSN、session、ticket、State、seed 或 canonical replay。

## 10. Playwright E2E

`tooling/e2e/tests/web-vertical-slice.spec.ts` 使用两个隔离 browser contexts，代表两个匿名访客：

1. A 创建井字棋 room 后在无 snapshot 页面预选“我先”，B 以规范化 room code 加入；双方 ready 后才获得不同 stable slots、相同 room code/revision 和各自完整 View；
2. 越过 disabled affordance 提交非当前玩家 intent 和重复点击，真实 Server 不产生额外 revision、棋盘或 replay action；
3. 两者完成第 1 局 5-revision 胜局并验证 WIN；临时断线仍以同一 guest、新 ticket/new reservation 恢复原 slot；
4. A 为第 2 局选择“对方先”，ready、cancel、再次 ready，B ready 后在同一 room code 和 stable slots 进入新 `playerOrder`，页面显示轮次且 revision 重置为 `0`；
5. 两者以交换后的 X/O 角色完成第 2 局 9-revision 平局并验证 DRAW；两轮各有独立 Match/replay/history，Replay header 顺序相反且均通过 `verifyReplay`，history 返回 `roundNumber`；
6. 第三 guest 猜到 completed room code 仍被 `ROOM_NOT_JOINABLE` 拒绝；A/B 的 HttpOnly guest cookies 与私有 history 授权继续隔离；
7. completed room 由房主关闭并返回入口；另一个尚未开始首局的 room 由房主无确认关闭，且不产生 abandoned Match；
8. active room 中非房主确认离开后当前 Match abandoned、双方返回入口；取消确认不会离开；
9. 另一 active room 用 fake clock 前进 60,001 ms，验证 `RECONNECT_TIMEOUT` abandoned 并关闭 live room；
10. 关闭并重建 database adapter 后，两轮 history metadata 和 completed canonical replays 仍存在；浏览器只看到安全 metadata，不看到数据库或 replay 细节。

Web E2E 同时验证三阶段 App Router：创建/加入和 canonical 邀请进入等待页，旧 `?roomCode=` 兼容入口规范化，双方 ready 后自动进入 `/play`，active 刷新/reconnect 回到 `/play`，completed 保留最终棋盘并通过“下一局设置”返回等待页，closed 返回入口并显示原因。复制邀请覆盖 Clipboard 成功状态与 API 失败后的可操作手动复制后备；active 房间的关闭/离开操作必须从菜单触发并保留确认。

`tooling/e2e/tests/connect-four-vertical-slice.spec.ts` 保留上述真实 Next/PostgreSQL/Colyseus harness，独立验证：

1. 两个 guest contexts 从统一目录进入四子棋，并以同一通用游戏页创建/加入真实 room；
2. 越过非当前玩家 disabled column 操作提交真实恶意 intent，双方 revision/棋盘保持 `0`；
3. 双方完成 7-revision 权威横向胜局，浏览器只显示服务器 View；
4. 房主再次选择先手，双方 ready 后在相同 room code/stable slots 进入第 2 局并再次完成胜局；
5. 两轮使用不同 Match/replay，均由新 PostgreSQL connection 读取并通过 exact registry verifier；
6. 两个 guest 的 history 只含各自 slot 的安全平台 metadata，第三 guest 与伪造 query 无法读取。

`tooling/e2e/tests/gomoku-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录卡片、页面标题与棋盘无障碍名称统一显示“五子棋”，URL 为 `/games/gomoku`；
2. 通用 Web 从 manifest 传递默认 `{ boardSize: 15, winLength: 5 }`，两个 guest 创建/加入、选择先手并 ready 后同步 225-cell View 与不同 stable slots；
3. 越过 disabled cell 的非当前玩家 intent 被真实 Server 拒绝且 revision/棋盘保持 `0`；
4. 双方完成 9-revision 权威横向胜局，浏览器只显示服务器 View；
5. completed replay 从 PostgreSQL 新 connection 重读并由 exact registry 验证，双方 private history 只返回安全 metadata。

`tooling/e2e/tests/hex-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录、页面、11×11 菱形棋盘、四条红蓝边、A–K/1–11 坐标和本轮 BLUE/RED roles；
2. 越过 disabled cell 的 RED 错轮 intent 被真实 Server 拒绝且 revision 保持 `0`；
3. 第一轮完成 21-revision BLUE 连接胜局，11-cell canonical path 只以白色模糊发光边框高亮；
4. 房主再次选择自己先手，双方在同一 room/stable slots 开始第二轮，因此该测试中角色保持不变；RED 在 BLUE 回合取消投降确认时不产生 Action；
5. RED 再次确认投降后产生 1-revision RESIGNATION WIN，不显示连接路径 glow；
6. 两轮独立 Match/replay 从 PostgreSQL 新 connection 重读并验证，双方 private history 返回两条安全 metadata。

`tooling/e2e/tests/reversi-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录卡片、中文标题、`/games/reversi`、8×8 可访问棋盘、本轮 BLACK/WHITE roles、棋子数和服务器合法落点；
2. 两个隔离 guest 创建/加入真实 room，越过 WHITE 的 disabled UX 提交错回合 intent，服务器拒绝且 revision、棋盘和棋子数保持不变；
3. 两方完成 11-revision 真实对局，验证落子后的权威翻转，以及 WHITE 被清空时仍有 49 个空格的非满盘终局；
4. completed replay 从新 PostgreSQL connection 重读并通过 exact registry verifier，RNG cursor 为 0；
5. 双方 private history 只含完全相同的安全 metadata key 集合，不返回 Config、Action、Outcome、seed 或 canonical replay。

Harness 为 Web 预留随机 loopback port，并用 `port: 0` 启动正式 ticket verifier/CORS composition 的真实 Colyseus Server；随后启动真实 Next production server 和 Chromium。M5/M6 E2E 使用测试 owner 创建的隔离 PostgreSQL database 和正式 adapters，只注入 fake clock、deterministic IDs 与测试 logger 等已有可控 ports，不 mock 数据库、浏览器、ticket route、matchmaking、WebSocket 或 Action pipeline，也不访问外部服务。活动 RoomStore 仍在内存中，因此该测试只验证 archive/replay 跨 adapter 重建，不声称恢复活动 room。

断言优先使用可访问 role/test id 和用户可见文本；恶意 intent case 明确调用实际 React click handler 以绕过 UX disable，但仍通过真实 client host/transport/server。Playwright trace/video 关闭，避免 bearer ticket 进入测试制品；失败 screenshot 只包含不显示 credential 的 UI。harness 在 `afterAll` 对两个进程执行停止清理。

## 11. Change-to-Test Matrix

| 改动                    | 最低检查                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| 单游戏 Core             | 该游戏 unit + determinism + replay fixtures + typecheck             |
| Game manifest/client    | registry contract + client component + relevant E2E                 |
| `game-sdk`              | 全部游戏 Core/replay + public API type tests + dependency checks    |
| `protocol`              | protocol contract + server integration + multiplayer/E2E smoke      |
| `game-server-runtime`   | server integration + multiplayer + replay store tests               |
| database/schema         | migrations + real PostgreSQL integration + restart reads + shutdown |
| match/history/identity  | PostgreSQL integration + API authorization/privacy + relevant E2E   |
| session/ticket          | auth contract + join/reconnect + security negative cases            |
| replay format/version   | reader compatibility + all supported golden replays                 |
| build/dependency config | full typecheck/lint/unit + affected build graph                     |

## 12. Root Commands

M5 提供以下稳定根命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm deps:check
pnpm test:integration
pnpm test:e2e
pnpm db:check
pnpm db:migrate
pnpm test:database
```

`pnpm lint` 包含格式、ESLint、本地 Markdown 链接与依赖边界检查。`pnpm test` 纳入 Game SDK、Protocol、井字棋/四子棋/五子棋/六贯棋/黑白棋 Core/client/golden、registry、ticket authority、Web guest/config、runtime/replay stores、Game Server unit tests 和 repository-check 的全部故意违规 fixture tests。`pnpm test:integration` 执行真实 Colyseus SDK tests。`pnpm test:e2e` 先执行完整 workspace build，再执行 PostgreSQL-backed Playwright。`pnpm test:database` 执行真实 PostgreSQL tests；这些命令都不是空脚本。

`pnpm db:check` 是只读 migration/schema 一致性检查。`pnpm db:migrate` 只在调用者显式提供 `DATABASE_URL` 时应用 checked-in migrations；应用 import 或 production startup 都不会自动 migration。本地创建、迁移与停止 PostgreSQL 的命令见根 README。测试必须使用独立 database/schema，禁止对默认 development `DATABASE_URL` 执行 destructive reset。

所有当前支持 `gameVersion` 的 golden replay：

```text
pnpm --filter @online-game-hub/tic-tac-toe test:golden
pnpm --filter @online-game-hub/connect-four test:golden
pnpm --filter @online-game-hub/gomoku test:golden
pnpm --filter @online-game-hub/hex test:golden
pnpm --filter @online-game-hub/reversi test:golden
```

首次本机运行 E2E 前执行 `pnpm exec playwright install chromium`。CI 在 frozen-lockfile install 后以 `pnpm exec playwright install --with-deps chromium` 安装与 Playwright 1.62.1 精确匹配的浏览器，使用固定 PostgreSQL 17.6 service，然后运行 lint、typecheck、unit、database、integration、build 和 E2E。

新增 package 必须接入 Turbo task graph，而不是要求 Agent 记忆私有脚本。

## 13. Definition of Done

功能或架构变更只有在以下条件满足时完成：

- 行为测试覆盖成功路径和关键拒绝路径；
- 受影响的 typecheck、lint、unit 和 integration checks 通过；
- 失败测试可重复，不依赖 sleep 或外部公共服务；
- 没有跳过、删除或弱化既有测试来掩盖失败；
- public API、protocol、game/replay version 和文档影响已评估；
- 最终汇报列出实际运行的检查及未运行原因。
