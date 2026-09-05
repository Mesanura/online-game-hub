# 测试策略

> 状态：Protocol V5/V6 双轨、Game Surface Bridge V1/V2、Setup Core 与 replay capability 测试策略
> 本文是测试层级、职责、最低场景和质量门禁的权威来源。具体业务范围见 [PRODUCT.md](./PRODUCT.md)。

M7-B 私有历史与回放测试覆盖：UserId + matchId 数据库授权、双账户共享同局、游客永久不可见、abandoned/incomplete 拒绝、损坏数据安全错误和跨连接读取；runtime revision 0..N frame reconstruction、exact historical definition、determinism、RNG/Outcome/sequence/actor/payload 篡改、projection 异常及帧数/响应大小上限；五款游戏 historical client module 独立解析和 replay read-only 不提交 Action；Web/API 的 401、not-found、unavailable、私有 headers、帧控制、slider、播放清理、移动端大棋盘容器和无 WebSocket。

账户资料测试额外覆盖：显示名 NFC、空白/控制字符、1–24 grapheme 边界、按首位顺序处理 Han/完整 emoji/普通字母数字（含 `1a2b`、`1你好2` 和 `🐷a`）头像生成；游客固定 `localStorage` 的刷新持久化与账户资料隔离；`PATCH /api/auth/profile` 的严格 body、同源、JSON、session 授权和失效 cookie 清理；PostgreSQL 旧用户迁移回填、注册默认值、更新持久化和新连接读取；ProfileMenu 的 hover/focus/click、Escape、外部关闭、游客/登录操作切换、跨浏览器资料读取及 room 身份变更确认。

## 1. 目标

测试体系必须让开发者和 Agent 快速回答：

- Game Core 的规则、确定性和不变量是否仍然成立；
- Game Server 是否真正 authoritative；
- 玩家、观众和重连连接是否只收到有权看到的数据；
- replay 是否仍能被对应 `gameVersion` 重建；
- PostgreSQL migrations、durable replay、match archive 和身份关联是否保持事务与授权不变量；
- 两个真实浏览器是否能完成创建、加入、对局和重连；
- package public API 和依赖方向是否被破坏。
- Surface 是否能脱离 Next/Game Server 构建测试，且 iframe/Bridge 不泄漏身份或权威数据。
- Setup accepted/rejected/stale/duplicate、逐玩家 ready 与完整重新对局复用是否保持一致。

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

### 3.1 `tools/create-game` Generator Tests

生成器测试只使用系统临时目录中的最小隔离 workspace，并注入本地 lockfile runner；不得写真实 `games/`、访问网络、启动数据库或调用外部服务。最低覆盖：

- 合法 gameId 产生精确 package/export/tsconfig/目录和显式 registry/Next 登记；不产生 manifest、Core 或 Client 假实现；
- 第二次运行返回成功且整个 fixture 零 diff，dependency、imports、catalog/definition/client arrays 与 transpile entry 都只出现一次；
- 大小写、空段、路径穿越、绝对路径、保留名、已有目录，以及 package/gameId/derived symbol 冲突全部在写入前拒绝；
- 已有文件内容冲突、重复登记和部分登记 fail closed，fixture 不新增任何写入；
- 固定 pnpm lockfile runner 失败后，package、registry、Next 与 lockfile 全部恢复，且不误删 preflight 前已存在的目录；
- `--help`、参数缺失、成功/失败退出码、人工清单顺序、LF 换行和输出格式保持稳定。

该 suite 验证机械生成器自身，不替代新游戏必须拥有的 Core、Client、golden、authoritative integration 和 Playwright 场景。generator-only 改动若未触及 database、Protocol、transport 或浏览器行为，按 change-to-test matrix 不要求运行真实 PostgreSQL、Colyseus integration 或 E2E。

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

井字棋至少覆盖所有获胜方向、平局、重复落子、错误回合、越界 cell、strict/off-turn `RESIGN`、resignation projection 和终局后 Action；frozen `1.0.0` fixture 必须继续拒绝 `RESIGN` 并 exact 重建。

四子棋至少覆盖重力、轮次切换、7 个满列、越界 column、非当前玩家、横向/纵向/双对角获胜、合法 42-action 平局、strict/off-turn `RESIGN`、resignation projection、终局拒绝、immutability、serialization、projection 和零 RNG cursor determinism；frozen `1.0.0` fixture 保持 exact。

五子棋至少覆盖 15×15/19×19 strict Config、默认 Config、初始化、轮次、越界/占用 cell、非当前玩家、横向/纵向/双对角胜局、连续五子以上长连、合法 225-action 满盘平局、strict/off-turn `RESIGN`、resignation projection、终局拒绝、Config/State/Action/RNG immutability、serialization、projection 和零 RNG cursor seeded determinism；frozen `1.0.0` fixture 保持 exact。

六贯棋至少覆盖 null Config、strict `PLACE_STONE | RESIGN`、固定 11×11 初始化、BLUE 先手、六方向邻接、四边/四角、禁止 row wrap、BLUE/RED 连接、未完成路径、canonical 最短路径与 tie-break、所有领域拒绝顺序、off-turn resignation、无 DRAW、终局拒绝、损坏 State 不变量、immutability、serialization、player/spectator projection 和零 RNG cursor seeded determinism。

黑白棋至少覆盖 null Config、标准 8×8 初始四子与 BLACK/WHITE slot 映射、八方向单线/多线同时翻转、边界/角落/禁止 row wrap、错误 slot/回合/越界/占用/无翻转落子、对方无行动时同 slot 续行、双方无行动的非满盘终局、满盘 BLACK/WHITE 胜局与平局、strict/off-turn `RESIGN`、resignation projection、终局拒绝、Config/State/Action/RNG immutability、serialization、player/spectator projection、服务器 View 的合法落点/棋子数/Outcome 和零 RNG cursor seeded determinism；frozen `1.0.0` fixture 保持 exact。

中国跳棋至少覆盖 2/3/6 人初始化、73 位坐标和六子营地、唯一 assignment、相邻移动、连续跳跃、越界/占用/错回合、完成/投降/阻塞排名、自动跳过、State/View/Action/Outcome immutability、JSON serialization、projection 和零 RNG cursor determinism；golden replay 必须验证 header assignment 可重建。

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
- Protocol V5 exact schemas 拒绝 V1–V4、缺字段和 extra fields；ticket 覆盖账户/游客 claim、伪造 UserId 与 extra fields；`room.control` 严格区分 starter/人数/assignment/ready/cancel/immediate rematch/close，拒绝非法 starter、人数、assignment 与 identity 字段；`room.lifecycle` 拒绝不一致 current/next Round、ready/closed 状态；Action/snapshot 的 `roundNumber` 必填并拒绝非法值；
- room discovery query/response 必须 strict、规范化 room code，并且只允许 `roomCode/gameId/gameVersion/setupProtocol/runtime`；额外 identity、ticket、slot、State、seed 或 replay 字段一律拒绝；
- platform error 与 `gameRuleCode` 的映射不混淆。

Protocol V6 另须覆盖 exact V5/V6 互拒、`game.setup` payload/identity/size、`expectedSetupRevision`、Setup rejection codes、viewer-specific `setupView`、readiness slot 集合与 current/next Round 不变量；确认 Realtime Input/Snapshot Protocol V1 的 schema 和语义未改变。

### 6.1 Game Surface Contract 与安全测试

- artifact 的 game/version/mode 必须 exact 匹配；缺失 entrypoint、重复版本、路径穿越、bridge 不兼容与摘要漂移 fail closed；
- nonce/source/window 校验、MessageChannel 单次移交、unknown/extra fields、重复 intent、dispose、crash 与 10 秒初始化超时；
- `host.command/RESIGN` 只在 exact deployment capability 允许时发送，命令不含 Action/Input payload 或 identity；Surface 以同一 `clientIntentId` 产生普通 intent，历史不支持投降的版本必须拒绝该能力；Surface 已有 intent 时 Host 拒绝并发平台命令，10 秒内未转化为 intent、retry、dispose 或 bridge failure 必须解除本地 pending 且不提交过期 intent；
- Host 消息与日志不包含 ticket、session、actor、raw State、seed 或 canonical replay；
- Bridge V1 拒绝 result-summary；Bridge V2 拒绝非法 tone、未知字段、超长 headline、超过六行或单行超长 details。Web 只显示与最近 completed play state sequence 匹配的摘要，并在 active、新 Round、retry 或 dispose 时清除；
- iframe 没有 `allow-same-origin`、表单、弹窗、下载或顶层导航能力，CSP 禁止直接联网；
- Surface 加载失败可重试，失败期间不会提交游戏 intent；
- 每个 Surface 的 conformance suite 无需启动 Next、Game Server 或数据库。

### 6.2 Setup Core 与 runtime 测试

- initialize/transition/project/finalize 的 schema、immutability、serialization、viewer privacy 与独立 seeded determinism；
- owner/player 权限、服务端 actor 推导、合法/非法 Setup Action、normalization、stale、duplicate、幂等与持久化失败重试；
- accepted 设置清空全部 ready；rejected/stale/duplicate 不清；只有 selected participant 可 ready；
- 参与者不完整、断线/重连、席位替换、playerOrder 排列、assignment 键冲突和 setup RNG 重试稳定；
- 下一轮复用完整 config/participant/playerOrder/assignment，但生成新 gameplay seed/RNG/revision/tick/Match/replay ID，并要求所有玩家分别重新 ready；
- V5/V6 房间并存、恢复、创建时 generation pinning、注册回滚只影响新房间与 V5 排空策略。
- Client Host 以 discovery generation 加入并在 ticket/request/reconnect 全链路固定；非法 generation 不发请求，加入 V6 后再创建仍恢复 deployment default V5。

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
- 房主加入前预选/提前 ready、非房主伪造选择、未选 starter 时拒绝 ready、随机先手只改变本轮 playerOrder 而不消费游戏 RNG、不同选择清全部 ready、重复选择保留 ready、断线/takeover 只清对应 ready、双方 ready 开新轮、双方在线时复用上一轮 playerOrder 的 immediate rematch、terminal outsider 拒绝、owner close、non-owner leave 和 5 分钟 terminal TTL 都由平台处理。
- 首局与后续轮都注入 Round 启动失败，验证 replay header 已创建而 Match archive 失败时保留相同 pending replay ID/seed/playerOrder，并以新 command ID 幂等重试。
- `GET /room-discovery` 对 turn-based/realtime 开放房间只返回最小白名单与固定 generation；小写 code 被规范化，未知/关闭/gameId 不匹配/双 runtime 同码返回 404，store 或损坏记录返回 503，所有响应禁用缓存。

Web 同源代理另以独立 route tests 覆盖 strict query、规范化转发、上游 404、上游 5xx/网络失败、非法或 game/code 不一致 payload、敏感 extra field 拒绝，以及 `no-store, private`。

### 7.3 Reconnect

- 断线后 60 秒内同一 session 能恢复原 slot 并获得当前完整 snapshot。
- 新有效连接接管后旧连接无法继续提交 Action。
- 不同 session 不能窃取保留 slot。
- 超时后执行房间策略，旧 reconnection token 不再恢复席位。
- V3 明确不测试进程重启后的 live room 恢复；只验证重启后已完成 replay、match history 仍可读取，并验证启动协调会把单实例遗留的旧 `waiting`/当前 `active` archive 标记为 `abandoned`。从未开始 Round 的 room 不应产生 archive。

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

真实 integration cases 覆盖：health/metrics 与 Protocol V5 ticket trust boundary；井字棋、四子棋、五子棋、六贯棋、黑白棋和中国跳棋 stable slots、无 snapshot setup、active/completed、invalid/rule-rejected commands、per-viewer snapshot 与 verified canonical replay；replay append failure 不确认/不提交；新 ticket + 新 reservation 的 reconnect、connection takeover、错误 session theft 和 fake-clock 60 秒 abandoned；逐局 starter/ready/cancel、随机 starter、复用 playerOrder 的 immediate rematch、跨轮 duplicate/错轮防护、terminal outsider、房主关闭、非房主 active leave 和 terminal TTL。中国跳棋额外覆盖 2–6 人人数控制、唯一营地权限、多人 playerOrder、排名和 assignment replay metadata。ticket verifier、ports、composition logger 另有无 transport 的 contract/unit tests。

Protocol V6 turn-based integration fixture 使用 V6 ticket/create/join/connected/lifecycle/Action 全链路，覆盖非 owner、伪造敏感字段、schema invalid、stale setup revision、duplicate ready、accepted 设置清 ready、Setup RoomStore 保存失败同 command 重试、finalized RANDOM setup 在 archive 失败后的原 command 重试、revision 0 active snapshot，以及第二局完整复用 config/order/assignments 但生成独立 gameplay seed/replay。`tic-tac-toe@1.1.0` 的 production deployment 默认使用 V6；既有 V5 suites 显式固定 V5 resolver，持续验证两代房间并存。

黑白棋 integration 额外覆盖本轮 BLACK/WHITE role、schema-invalid/伪造 actor、错回合与无翻转拒绝不推进 revision/replay、权威翻转、revision 18 后 WHITE 强制连续行动、25-action 非满盘终局、PASS-free canonical replay，以及同房间第二轮 revision 重置、独立 Match/replay 与 11-action 非满盘终局。

四个 current `1.1.0` 游戏另以 table 覆盖一个正常 accepted Action 后同 actor off-turn `RESIGN`：revision 只加到 `2`、比赛 completed、对手 `RESIGNATION` WIN、replay 恰有一条 `RESIGN` 且 exact verification 通过。六贯棋连接轮使用必须经过 `(+1,-1)` 邻格的 21-action BLUE canonical path，并覆盖终局拒绝；Core 另以 accepted Action 同时回归 BLUE/RED 两个第三轴方向。

## 9. PostgreSQL Integration Tests

`packages/database/tests/database.integration.test.ts` 和 `apps/game-server/tests/database.integration.test.ts` 连接真实 PostgreSQL，不使用 SQLite，也不 mock Drizzle driver。根 `pnpm test:database` 会先构建依赖 package，再执行这两组 tests；缺少显式的测试 DSN 时 fail closed，不会回退或连接默认开发数据库。这个 fail-closed 行为用于防止误连，不是跳过数据库测试的理由。

### 9.1 本地 Agent 的临时 PostgreSQL

本地不要求预先配置 `TEST_DATABASE_URL`，也不要把它写入 `.env`。当环境没有该变量时，Agent 必须在完成开发后用 Docker 启动一次性的 `postgres:17.6-alpine3.22` 容器：只发布 loopback 随机端口、不挂载数据目录，等待 `pg_isready` 成功后，把临时 DSN 注入需要运行的测试命令。按 change-to-test matrix 运行所有受影响的 `pnpm test:database`、PostgreSQL-backed `pnpm test:e2e` 或其他真实数据库检查；同一个容器可供同一轮检查复用。

Bash 示例：

```bash
set -eu
container="ogh-test-postgres-$RANDOM-$$"
docker run --detach --rm --name "$container" \
  --env POSTGRES_DB=postgres \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=postgres \
  --publish 127.0.0.1::5432 \
  postgres:17.6-alpine3.22
cleanup() { docker rm --force "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
host_port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${host_port}/postgres"
pnpm test:database
# 按改动矩阵需要时，在同一临时容器中继续运行：
# pnpm test:e2e
```

PowerShell 等价流程：

```powershell
$container = "ogh-test-postgres-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
docker run --detach --rm --name $container `
  --env POSTGRES_DB=postgres `
  --env POSTGRES_USER=postgres `
  --env POSTGRES_PASSWORD=postgres `
  --publish 127.0.0.1::5432 `
  postgres:17.6-alpine3.22
try {
  $published = docker port $container 5432/tcp
  $hostPort = [int](($published -split ':')[-1])
  $ready = $false
  1..60 | ForEach-Object {
    if ($ready) { return }
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true } else { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "Temporary PostgreSQL did not become ready." }
  $env:TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$hostPort/postgres"
  pnpm test:database
  # 按改动矩阵需要时，在同一临时容器中继续运行：pnpm test:e2e
} finally {
  Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
  docker rm --force $container *> $null
}
```

测试结束必须执行 cleanup，即使测试失败也不能留下容器或复用临时数据库。若 Docker daemon 不可用，数据库检查应报告为 blocked；不得以未配置 `TEST_DATABASE_URL` 为理由跳过或标记通过。测试输出、日志和制品仍不得包含完整 DSN。

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
- 匿名 `/api/matches` 返回 401；账户历史只按 UserId 返回最近 50 条安全 metadata，不能查询其他账户，也不泄漏 replay ID/seed/State/session ID；
- 匿名 Round 的 `match_players.user_id` 永久为 null；注册/登录、归档重试不回填；登录后新 Round 正确记录 UserId；
- `users.display_name` 迁移从凭证回填用户名、无凭证回填“游客”；注册默认显示名等于用户名，更新只影响目标 UserId，新数据库连接可读取更新结果；
- adapter/connection shutdown 后无遗留 client；数据库错误经稳定 code 清洗，不泄漏 SQL、DSN、session、ticket、State、seed 或 canonical replay。
- realtime room 的 V5/V6 generation 可在新 adapter/connection 重读，save 不得改代际；旧行省略列时默认 V5，数据库 constraint 拒绝其他整数，损坏 generation 由 adapter 以稳定 `DATABASE_DATA_INVALID` fail closed。

## 10. Playwright E2E

`tooling/e2e/tests/web-vertical-slice.spec.ts` 使用两个隔离且已登录的 browser contexts 验证账户归属与既有房间行为；`auth-vertical-slice.spec.ts` 另以双浏览器先完成游客局，再注册并完成账户局：

1. A 创建井字棋 V6 room 后在独立 Setup Surface 选择“房主先手”，B 以规范化 room code 加入；所需参与者到齐后双方分别 ready，自动切换至独立 Play Surface，并获得不同 stable slots、相同 room code/revision 和各自完整 View；
2. 确认非当前玩家的 Surface 棋格被禁用；伪造 actor、schema-invalid、stale 与 duplicate intent 的权威拒绝由 Protocol V6 integration 覆盖，均不得推进 revision、棋盘或 replay action；
3. 两者完成第 1 局 5-revision 胜局并验证 WIN；临时断线仍以同一账户身份和 PlayerSessionId、新 ticket/new reservation 恢复原 slot；
4. completed 后进入同一 Setup Surface，默认复用上一局完整 finalized setup；A 再选择“另一位玩家先手”，ready、cancel、再次 ready，B ready 后在同一 room code 和 stable slots 进入新 `playerOrder`，页面显示轮次且 revision 重置为 `0`；
5. 两者以交换后的 X/O 角色完成第 2 局 9-revision 平局并验证 DRAW；两轮各有独立 Match/replay/history，Replay header 顺序相反且均通过 `verifyReplay`，history 返回 `roundNumber`；
6. 第三 context 猜到 completed room code 仍被 `ROOM_NOT_JOINABLE` 拒绝；另一账户查询不到 A/B history；
7. completed room 由房主关闭并返回入口；另一个尚未开始首局的 room 由房主无确认关闭，且不产生 abandoned Match；
8. active room 中非房主确认离开后当前 Match abandoned、双方返回入口；取消确认不会离开；
9. 另一 active room 用 fake clock 前进 60,001 ms，验证 `RECONNECT_TIMEOUT` abandoned 并关闭 live room；
10. 关闭并重建 database adapter 后，两轮 history metadata 和 completed canonical replays 仍存在；浏览器只看到安全 metadata，不看到数据库或 replay 细节。

Web E2E 同时验证三阶段 App Router：创建/加入和 canonical 邀请进入等待页，旧 `?roomCode=` 兼容入口规范化，双方 ready 后自动进入 `/play`，active 刷新/reconnect 回到 `/play`，completed 保留最终棋盘并通过“调整设置”返回等待页，closed 返回入口并显示原因。井字棋还验证 exact Setup/Play/Replay Surface entrypoint、iframe 内交互、只读历史回放和 production V6；复制邀请覆盖 Clipboard 成功状态与 API 失败后的可操作手动复制后备。各游戏从默认收起的覆盖式 HUD 执行通用投降/关闭/离开，验证 Web 不加载 legacy module、投降取消不产生 Action、确认经 `host.command` 只产生一个 exact `RESIGN` intent/revision、双方收敛到 `RESIGNATION` WIN 且 PostgreSQL replay exact verification 通过；中国跳棋额外覆盖 3 人营地选择、排名和 assignment replay metadata。

`auth-vertical-slice.spec.ts` 还验证右上角 ProfileMenu：游客显示“游客”并可修改显示名、实时更新头像且刷新后仍保留；登录后下半部切换为历史/设置/退出，账户更新由另一 browser context 读取，退出后恢复为独立游客资料；键盘 Escape、外部点击和 live room 中身份变化确认均有效。

`tooling/e2e/tests/connect-four-vertical-slice.spec.ts` 保留上述真实 Next/PostgreSQL/Colyseus harness，独立验证：

1. 两个 account contexts 从统一目录进入四子棋，并以同一通用游戏页创建/加入真实 room；
2. 越过非当前玩家 disabled column 操作提交真实恶意 intent，双方 revision/棋盘保持 `0`；
3. 双方完成 7-revision 权威横向胜局，浏览器只显示服务器 View；
4. 房主再次选择先手，双方 ready 后在相同 room code/stable slots 进入第 2 局并再次完成胜局；
5. 两轮使用不同 Match/replay，均由新 PostgreSQL connection 读取并通过 exact registry verifier；
6. 两个账户的 history 只含各自 slot 的安全平台 metadata，第三账户与伪造 query 无法读取；认证纵切同时验证游客 API 401、游客局不认领、退出失效与同账户另一设备恢复历史。

`tooling/e2e/tests/gomoku-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录卡片、页面标题与棋盘无障碍名称统一显示“五子棋”，URL 为 `/games/gomoku`；
2. 通用 Web 从 manifest 传递默认 `{ boardSize: 15, winLength: 5 }`，两个 account contexts 创建/加入，在独立 Setup iframe 选择先手并 ready 后切换至独立 225-cell Play iframe 与不同 stable slots；
3. 非当前玩家在独立 Surface 中只能看到 disabled cell 且 revision/棋盘保持 `0`；伪造 actor、schema-invalid、stale 与 duplicate intent 的权威拒绝继续由 Protocol V6 integration 覆盖；
4. 双方完成 9-revision 权威横向胜局，浏览器只显示服务器 View；
5. completed replay 从 PostgreSQL 新 connection 重读并由 exact registry 验证，双方 private history 只返回安全 metadata，历史页使用 exact Replay Surface。

`tooling/e2e/tests/hex-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录、页面、独立 Setup/Play/Replay iframe、11×11 菱形棋盘、四条红蓝边、A–K/1–11 坐标和本轮 BLUE/RED roles；
2. RED 错轮 cell 在独立 Surface 内保持 disabled 且 revision 为 `0`；伪造 actor、schema-invalid、stale 与 duplicate intent 的权威拒绝由 Protocol V6 integration 覆盖；
3. 第一轮完成 21-revision BLUE 连接胜局，11-cell canonical path 只以白色模糊发光边框高亮；
4. 双方点击“重新对局”直接复用上一局完整 finalized setup，在同一 room/stable slots 开始第二轮且角色保持不变；RED 在 BLUE 回合从共用 HUD 取消投降确认时不产生 Action；
5. RED 再次确认投降后产生 1-revision RESIGNATION WIN，不显示连接路径 glow；
6. 两轮独立 Match/replay 从 PostgreSQL 新 connection 重读并验证，双方 private history 返回两条安全 metadata，历史页按 exact `gameVersion` 加载只读 Replay Surface。

`tooling/e2e/tests/chinese-checkers-vertical-slice.spec.ts` 使用三个隔离账户和相同真实 harness，独立验证：

1. 房主在独立 Setup Surface 选择 3 人和 OWNER 首位，三位玩家分别为自己的稳定席位选择唯一 `N`、`S`、`NE` 营地并分别 ready；
2. V6 RoomStore 保存 canonical Setup State，Play Surface 精确显示 73 格、37 个中心格、六个 6 格营地与 18 枚棋子，非当前玩家没有可操作棋位；
3. 当前玩家只通过服务器 projected `legalMoves` 完成一次两阶段移动，随后另外两位玩家 off-turn 投降，形成三人 canonical 排名；
4. 下一局复用上一局目标人数、参与席位、实际 `playerOrder` 和全部营地，不重新随机且三位玩家必须分别点击“重新对局”；两轮各自使用新的 gameplay seed、Match 和 replay；
5. 两轮 replay 由新的 PostgreSQL connection 重读并通过 exact registry verifier，三个账户历史一致；Replay Surface 验证首帧、末帧、最终排名和全棋盘只读。

`tooling/e2e/tests/reversi-vertical-slice.spec.ts` 使用相同真实 harness，独立验证：

1. 目录卡片、中文标题、`/games/reversi`、独立 Setup/Play iframe、8×8 可访问棋盘、本轮 BLACK/WHITE roles、棋子数和服务器合法落点；
2. 两个隔离 account contexts 创建/加入真实 V6 room；WHITE 只能看到 disabled 合法落点且 revision、棋盘和棋子数保持不变，伪造 intent 的权威拒绝由 Protocol V6 integration 覆盖；
3. 两方完成 11-revision 真实对局，验证落子后的权威翻转，以及 WHITE 被清空时仍有 49 个空格的非满盘终局；
4. completed replay 从新 PostgreSQL connection 重读并通过 exact registry verifier，RNG cursor 为 0；
5. 双方 private history 只含完全相同的安全 metadata key 集合，不返回 Config、Action、Outcome、seed 或 canonical replay。

Harness 为 Web 预留随机 loopback port，并用 `port: 0` 启动正式 ticket verifier/CORS composition 的真实 Colyseus Server；随后启动真实 Next production server 和 Chromium。M5/M6 E2E 使用测试 owner 创建的隔离 PostgreSQL database 和正式 adapters，只注入 fake clock、deterministic IDs 与测试 logger 等已有可控 ports，不 mock 数据库、浏览器、ticket route、matchmaking、WebSocket 或 Action pipeline，也不访问外部服务。活动 RoomStore 仍在内存中，因此该测试只验证 archive/replay 跨 adapter 重建，不声称恢复活动 room。

断言优先使用可访问 role/test id 和用户可见文本；legacy Client Module 的恶意 intent case 只保留在兼容组件/Host 测试，不再代表 Web 渲染路径；sandboxed Surface 不通过篡改 iframe 内框架私有属性制造攻击，权威负例由 Bridge contract 与 V6 integration 覆盖。Web unit contract 还须以源码边界断言 live room/replay 不导入 legacy loader、公共 CSS 不含游戏专属 selector。Playwright trace/video 关闭，避免 bearer ticket 进入测试制品；失败 screenshot 只包含不显示 credential 的 UI。harness 在 `afterAll` 对两个进程执行停止清理。

## 11. Change-to-Test Matrix

| 改动                    | 最低检查                                                              |
| ----------------------- | --------------------------------------------------------------------- |
| 单游戏 Core             | 该游戏 unit + determinism + replay fixtures + typecheck               |
| Game manifest/client    | registry contract + client component + relevant E2E                   |
| `game-sdk`              | 全部游戏 Core/replay + public API type tests + dependency checks      |
| `protocol`              | protocol contract + server integration + multiplayer/E2E smoke        |
| `game-setup`            | contract/unit + 两套 runtime integration + replay header invariants   |
| `game-surface-bridge`   | schema/handshake/security contract + Host + Surface conformance       |
| Surface artifact        | 独立 test/build/contract + digest/copy + viewport E2E                 |
| `game-server-runtime`   | server integration + multiplayer + replay store tests                 |
| database/schema         | migrations + real PostgreSQL integration + restart reads + shutdown   |
| match/history/identity  | PostgreSQL integration + API authorization/privacy + relevant E2E     |
| session/ticket          | auth contract + join/reconnect + security negative cases              |
| replay format/version   | reader compatibility + all supported golden replays                   |
| replay capability       | registry + history/API matrix + exact playback Surface                |
| build/dependency config | full typecheck/lint/unit + affected build graph                       |
| `tools/create-game`     | package test/typecheck/build + registry contract + root quality gates |

Surface 包的独立契约门禁由 `pnpm contract-test` 进入 Turbo graph。全仓 `pnpm build` 后必须依次运行 `pnpm surface:verify` 与 `pnpm surface:publish`：前者验证所有显式发布 workspace 的 manifest、mode entrypoint、源码锁与 canonical digest，并拒绝未提升 `surfaceVersion` 的内容漂移；后者验证不可覆盖的 immutable 复制。相同 digest 的重复发布只能是 no-op，不得重写目标文件。

Web iframe Host 的组件测试至少验证 sandbox 不含 same-origin/form/popup/top-navigation 权限，静态路径具备 immutable/CORS/CSP headers 且绕过 session proxy；Web production build 必须实际加载 `next.config.ts`，防止只在测试对象中成立而部署配置无效。握手、nonce、exact V1/V2 协商、非法消息、重复 intent、timeout、retry、dispose 与 V2 result-summary 长度/行数限制继续由 `game-surface-bridge` 的 fake-channel contract tests 覆盖。

Tic-Tac-Toe Surface 以 `surfaceVersion 1.0.3` 和 Bridge V2 同时覆盖 `gameVersion 1.0.0`/`1.1.0`；contract/model tests 必须证明历史版本只接受普通 WIN/DRAW 与落子 intent，而 current 版本另可显示 `RESIGNATION` WIN 并响应平台投降命令。历史版本仍保留 V5 Setup/lifecycle 与 frozen Core/golden replay，不得因表现层共用而放宽 Action 或 Outcome。

Workbench contract tests必须覆盖 Setup/Play/Replay mode、active/terminal projected payload 的 strict Bridge parse、敏感 key 扫描、完整 viewport 矩阵及 `surfaceArtifact: false`/唯一 workspace dependency。其 `test`、`typecheck`、`build` 与 `contract-test` 均可在不启动 Next 或 Game Server 时独立运行。

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

`pnpm lint` 包含格式、ESLint、本地 Markdown 链接与依赖边界检查。`pnpm test` 纳入 Game SDK、Protocol、井字棋/四子棋/五子棋/六贯棋/黑白棋 Core/client/golden、registry、ticket authority、Web guest/config、runtime/replay stores、Game Server unit tests、create-game 隔离 fixture 和 repository-check 的全部故意违规 fixture tests。`pnpm test:integration` 执行真实 Colyseus SDK tests。`pnpm test:e2e` 先执行完整 workspace build、Surface verify/publish，再执行 PostgreSQL-backed Playwright。`pnpm test:database` 执行真实 PostgreSQL tests；这些命令都不是空脚本。

`pnpm db:check` 是只读 migration/schema 一致性检查。`pnpm db:migrate` 只在调用者显式提供 `DATABASE_URL` 时应用 checked-in migrations；应用 import 或 production startup 都不会自动 migration。本地创建、迁移与停止 PostgreSQL 的命令见根 README。测试必须使用独立 database/schema，禁止对默认 development `DATABASE_URL` 执行 destructive reset。

## 13. M8 Realtime Runtime 测试要求

本节是 M8 已实现的验收矩阵。realtime runtime 或 `games/pong` 的改动至少新增并实际运行：

- 纯 simulation tests：固定整数 60 Hz tick、输入生效顺序、球拍/边界碰撞、得分/发球、终局/投降、immutability、JSON serialization、viewer projection，以及相同 seed/input log 的逐 tick determinism；
- realtime replay tests：server-assigned tick 的 input change log 可 exact 重建；tick/sequence gap、错 actor、schema-invalid input、重复或倒退 `inputSequence`、被拒绝 command 和篡改 Outcome 可靠失败；既有 Replay Format V1 golden fixtures 持续通过；
- realtime protocol/runtime integration：真实 Colyseus WebSocket + fake monotonic scheduler 验证 forged state/tick/score 拒绝、input rate/size 限制、单 writer ordering、快照顺序、viewer input acknowledgement、takeover reconnect 和 60 秒 abandonment；
- PostgreSQL integration：realtime Match、input replay 和账户归属可由新 connection 重读并验证；私有 replay 授权不泄漏 raw State、seed、input log 或其他玩家数据；按数据库规则使用临时 Docker PostgreSQL；
- Playwright E2E：两个隔离 browser contexts 经过目录、独立 Setup Surface、ready、独立 Phaser Play Surface、完成、reconnect 与只读 Replay Surface；检查 canvas 非空、800×400 逻辑尺寸、视口矩阵及 2560×1440 的 100%/150% 缩放等效视口下的 2:1 FIT、安全留白和四边边界可辨识性、键盘输入可用、reduced motion 和终局 UI，不以客户端位置推断权威结果；
- 全仓 `lint`、`typecheck`、`test`、`build`、`deps:check`，以及受影响的 `test:integration`、`test:database` 和 `test:e2e`。Phaser 依赖必须由 legacy `games/pong` client 或独立 `game-surfaces/pong` 明确拥有，Core 和 server runtime 的依赖检查必须继续拒绝 Phaser/DOM。

Connect Four Surface `1.0.3` 额外保持 `1.0.0`/`1.1.0` projected View 的同一 artifact contract；current E2E 必须覆盖 Setup iframe、42 格/7 列 Play iframe、`7:6` 棋盘及 2560×1440 的 100%/150% 缩放等效视口 containment、完整设置复用的第二局、平台投降和 Replay iframe。历史 `1.0.0` golden replay 继续用 frozen Core exact 验证。

Gomoku Surface `1.0.2` 同时覆盖 `1.0.0`/`1.1.0` projected View；current E2E 必须覆盖保留 15×15 Config 的 Setup iframe、225 格暖木 Clay 棋盘、容器尺寸适配、当前棋色 hover/focus 预览、平台投降和 Replay iframe。19×19 Config、长连和历史 `1.0.0` exact 行为继续由 Core、Setup 与 golden tests 覆盖。

Reversi Surface `1.0.4` 以同一 artifact 覆盖 `1.0.0`/`1.1.0` projected View；current E2E 必须覆盖 Setup iframe、64 格暖木 Clay 棋盘、八行八列等大正方形及落子前后几何稳定性、teal 合法落点、服务器 `legalMoves`、翻转与非满盘终局、平台投降和 Replay iframe。Surface 不得自行扫描夹线、判断强制跳过或产生 PASS。

Hex Surface 迁移以一个 artifact 精确覆盖 `1.0.0`；E2E 必须覆盖 Setup/Play/Replay iframe、121 格菱形棋盘、四条连接边、44 个坐标标签、上一局完整设置复用、平台投降和服务器 canonical `winningPath` 高亮。Surface 只验证并显示 projected path，不自行运行 BFS、推断连接或生成 Outcome。

Chinese Checkers Surface `1.0.4` 精确覆盖 `1.0.0`；E2E 必须覆盖三人 Setup/Play/Replay iframe、73 格对称六芒星、162 条相邻棋位连线、中央 37 格、六个 `3+2+1` 营地、棋子跨营地后保持玩家颜色、服务器 `legalMoves`、三人排名和下一局完整设置复用。Surface 不得搜索连续跳跃路径、推导当前玩家或自行生成排名/Outcome。

所有当前支持 `gameVersion` 的 golden replay：

```text
pnpm --filter @online-game-hub/tic-tac-toe test:golden
pnpm --filter @online-game-hub/connect-four test:golden
pnpm --filter @online-game-hub/gomoku test:golden
pnpm --filter @online-game-hub/hex test:golden
pnpm --filter @online-game-hub/reversi test:golden
pnpm --filter @online-game-hub/chinese-checkers test:golden
```

首次本机运行 E2E 前执行 `pnpm exec playwright install chromium`。CI 在 frozen-lockfile install 后以 `pnpm exec playwright install --with-deps chromium` 安装与 Playwright 1.62.1 精确匹配的浏览器，使用固定 PostgreSQL 17.6 service，然后运行 lint、typecheck、unit、database、integration、build 和 E2E。

新增 package 必须接入 Turbo task graph，而不是要求 Agent 记忆私有脚本。

`tools/create-game` 可单独检查：

```text
pnpm --filter @online-game-hub/create-game test
pnpm --filter @online-game-hub/create-game typecheck
pnpm --filter @online-game-hub/create-game build
pnpm --filter @online-game-hub/game-registry test
```

## 14. Definition of Done

功能或架构变更只有在以下条件满足时完成：

- 行为测试覆盖成功路径和关键拒绝路径；
- 受影响的 typecheck、lint、unit 和 integration checks 通过；
- 失败测试可重复，不依赖 sleep 或外部公共服务；
- 没有跳过、删除或弱化既有测试来掩盖失败；
- public API、protocol、game/replay version 和文档影响已评估；
- 最终汇报列出实际运行的检查及未运行原因。
