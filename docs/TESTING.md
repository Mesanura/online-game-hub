# 测试策略

本文定义改动对应的最低检查、各层职责和测试环境。业务规则以 [游戏规格](../games/README.md) 为准，架构边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。测试要求描述应长期成立的不变量，不记录某次任务的通过日志。

## 按改动选择检查

优先在纯 Core/Setup 中覆盖规则组合，在 integration 中覆盖跨 package 与 transport，在 E2E 中验证关键用户旅程。修改同时影响多行时取检查并集，不能只运行改动文件的 happy path。

| 改动                       | 最低检查                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| 仅文档                     | format:check + docs:check；核对涉及的命令、类型、状态与源码                |
| 单游戏 Core                | 该游戏 unit、determinism、所有支持版本 golden、typecheck                   |
| Manifest / deployment      | registry contract、exact Surface 映射与相关 E2E                            |
| `game-sdk`                 | 全部游戏 Core/replay、public API type tests、依赖检查                      |
| `realtime-game-sdk`        | 全部实时 simulation/replay、两种输入交付、public API/type 与依赖检查       |
| `protocol`                 | exact schema contract、server integration、multiplayer/E2E smoke           |
| `game-setup`               | contract/unit、两类 runtime integration、replay header 不变量              |
| `game-surface-bridge`      | schema/handshake/security、Host 与各 Surface conformance                   |
| Surface artifact           | 独立 test/typecheck/build/contract、digest/publish、viewport E2E           |
| 回合制 server runtime      | server integration、multiplayer、replay/store tests                        |
| 实时 server/client runtime | simulation/replay、输入排序/ack、scheduler、真实 integration、受影响 E2E   |
| Database/schema            | migration/db:check、真实 PostgreSQL、跨连接重读与 shutdown                 |
| Match/history/identity     | PostgreSQL、API authorization/privacy、相关 E2E                            |
| Session/ticket             | auth contract、join/reconnect、关键安全负例                                |
| Replay format/version      | reader compatibility、所有支持版本 golden、相关持久化检查                  |
| Replay capability          | exact registry、history/API 权限矩阵、对应播放或拒绝 E2E                   |
| Web 路由/交互              | 相关组件、Host 与真实浏览器流程；涉及历史/身份时包含 PostgreSQL            |
| Build/dependency config    | 全仓 typecheck/lint/unit、受影响 build graph                               |
| `tools/create-game`        | 生成器 test/typecheck/build、隔离 workspace 实际生成/安装/构建、根质量门禁 |

新增游戏必须完成 Plugin Definition of Done，覆盖 Core、Setup、Surface、registry、真实 integration、PostgreSQL 和浏览器链路。公共契约、数据库与 replay 变更不得只验证单个消费者。

## 命令入口

所有命令从仓库根运行，实际脚本见 [package.json](../package.json)。

| 命令                    | 范围/前提                                                                    |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pnpm format:check`     | Prettier，只检查不修改                                                       |
| `pnpm docs:check`       | 本地 Markdown 链接目标；不检查外部 URL 或 heading anchor                     |
| `pnpm deps:check`       | Public exports、依赖边界与循环依赖                                           |
| `pnpm lint`             | format:check、ESLint、docs:check、deps:check                                 |
| `pnpm typecheck`        | Turbo 图中的各包 TypeScript 检查                                             |
| `pnpm test`             | 各包 unit、Core、Setup、client、golden、Host、store、工具与故意违规 fixtures |
| `pnpm contract-test`    | Surface/Workbench 的独立契约门禁                                             |
| `pnpm build`            | 完整 workspace build                                                         |
| `pnpm surface:verify`   | 校验已构建的发布型 Surface、entrypoint、版本锁与 canonical digest            |
| `pnpm surface:publish`  | 校验后 immutable 复制到 Web 静态目录；相同摘要重复发布为 no-op               |
| `pnpm test:integration` | 真实 Colyseus SDK/WebSocket，使用内存 stores 与可控 clock                    |
| `pnpm test:database`    | 先构建服务端依赖，再运行 database 与 game-server 真实 PostgreSQL suites      |
| `pnpm test:e2e`         | 先 build、Surface verify/publish，再执行 PostgreSQL-backed Playwright        |
| `pnpm db:check`         | 只读 schema/migration metadata 一致性检查                                    |
| `pnpm db:migrate`       | 显式 `DATABASE_URL` 的运维 migration，不能代替测试环境隔离                   |

运行所有游戏 golden 可使用：

```sh
pnpm --filter "./games/*" -r test:golden
```

单包检查使用 `pnpm --filter @online-game-hub/<package> <script>`。直接运行某个 E2E 文件前，仍须完成 build、surface verify/publish，并提供下文的临时数据库；不能因绕过根包装命令而省略前置条件。

首次本机 E2E 安装浏览器：

```sh
pnpm exec playwright install chromium
```

CI 使用 [workflow](../.github/workflows/ci.yml) 中固定的 PostgreSQL service，并安装 Playwright 匹配的 Chromium；依次执行 lint、typecheck、test、contract-test、database、integration、build、Surface verify/publish 和 E2E。新增包须进入 Turbo graph，不要求维护者记忆私有测试入口。

## 静态与工具检查

静态检查覆盖 strict TypeScript、ESLint、public exports、依赖/cycle、Core 禁止 API、格式和 Markdown 本地路径；lockfile 通过 frozen install 校验。文档中的 anchor、命令示例和当前状态需要额外核对，不能只凭 docs:check 通过断言内容正确。

create-game unit tests 使用系统临时目录中的隔离 workspace 和本地 lockfile runner，不写真实游戏目录、访问网络或启动服务。最低覆盖双目录/双包输出、两个 importer、幂等零写入、非法 ID/路径/保留名、包名与 symbol 冲突、残缺目标、用户修改、链接拒绝、写入和 lockfile 失败后的完整回滚，以及业务登记文件不变、退出码和稳定输出。

模板变更还须在隔离的真实 workspace 中使用固定 pnpm 生成、安装并构建草稿，运行静态检查和既有测试，确认草稿不进入 catalog，也不出现在 Surface 发布结果中。草稿不提供虚假 test 命令；该验收不代替新游戏正式接入所需的 unit/golden/contract/浏览器验证。

## Core、Setup 与确定性

### Core 公共要求

| 类别       | 最低场景                                                                  |
| ---------- | ------------------------------------------------------------------------- |
| 初始化     | 同 Config、slots、seed 得到同 State/RNG；非法 Config 拒绝                 |
| 合法操作   | 每种 Action/Input 的合法路径、顺序和状态推进                              |
| 非法操作   | 错 slot/回合、越界、占用、终局后操作；拒绝不改变候选 State/RNG            |
| Outcome    | 各获胜/平局/排名/投降路径、非终局与终局不可继续                           |
| 不变性     | State、Action/Input、Config 和 RNG 入参不被修改                           |
| 序列化     | State/View/Action/Input/Outcome JSON-safe，无 class/Date/BigInt/undefined |
| Projection | 每个 viewer 只见授权字段，不发送 raw State 或 seed                        |
| 确定性     | 固定 seed 和事件序列得到相同 State/RNG/Outcome；实时逐 tick 验证          |

优先使用 table-driven cases；property tests 必须能复现失败 seed。纯测试不启动网络、浏览器或数据库，不依赖真实时钟和随机执行顺序。历史 definition 独立冻结，每个支持版本至少一份 golden；不能改写 fixture 来掩盖回归。

### 单游戏回归重点

下表补充公共要求；完整规则、数值与历史差异由链接的 GAME_SPEC 定义，已有回归用例继续保留。

| 游戏                                               | 最低特有覆盖                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [井字棋](../games/tic-tac-toe/GAME_SPEC.md)        | 全部获胜方向、平局、重复落子、错轮、off-turn RESIGN；历史版本拒绝新 Action                                                                                                                                                                                                                                                                                                    |
| [四子棋](../games/connect-four/GAME_SPEC.md)       | 重力、所有满列、横纵双对角、完整平局、投降、历史 exact replay                                                                                                                                                                                                                                                                                                                 |
| [五子棋](../games/gomoku/GAME_SPEC.md)             | 两种棋盘 Config、默认值、长连、满盘平局、边界/占用/错轮、投降与历史 fixture                                                                                                                                                                                                                                                                                                   |
| [六贯棋](../games/hex/GAME_SPEC.md)                | 六方向邻接含第三轴、四边/角落、禁止 row wrap、双颜色连接、BFS 最短路径/tie-break、无 DRAW、投降与损坏 State                                                                                                                                                                                                                                                                   |
| [黑白棋](../games/reversi/GAME_SPEC.md)            | 八方向翻转、边角、无翻转拒绝、同 slot 续行、双方无行动的非满盘终局、计数/合法落点投影、PASS-free replay                                                                                                                                                                                                                                                                       |
| [中国跳棋](../games/chinese-checkers/GAME_SPEC.md) | 2/3/6 人、唯一营地、相邻/连续跳跃、完成/阻塞/投降排名、自动跳过；新版逐格几何与 ASCII 图一致、旋转对称、等距邻接，旧编号/拓扑隔离                                                                                                                                                                                                                                             |
| [Pong](../games/pong/GAME_SPEC.md)                 | 准备期、球拍/边界碰撞、两侧连续回球加速与上限、非终局得分重置、投降优先级、RNG 和各历史计分/投降 golden                                                                                                                                                                                                                                                                       |
| [羽毛球](../games/badminton/GAME_SPEC.md)          | 各比分 Config、半场/跳跃、输入有效期、三类击球/冷却/重复触球、球网高速拦截/落地/出界、领先两分与封顶；手动/空中发球、非发球方拒绝、长按不连发、起手时序/前脚对齐、阻力和历史自动发球；左右网前挑球脱困与退守接回、多种起跳/挥拍时机、历史低弧线过网、固定吊球弧线/落点、中后场延迟反应后上前接回与网前吊球的起跳扣杀反击、扣杀上下行/身前/高度/角度降级、方向落点和触球后回收 |
| [坦克迷战](../games/tank-maze/GAME_SPEC.md)        | 2/3/8 人最小地图分散出生、地图权重边界/全部尺寸/主区域与人数无关的分布、全部朝向前后等速、推挤/墙体；events 同 tick 多次 FIRE，各弹药容量/寿命/反弹/自伤与盾边界、导弹延迟/换目标/绕墙/封闭区域/转向上限/不穿墙；全灭/幸存/超时/目标分/投降、小局清理与各历史八人多小局 golden、各起始 tick 相位整周转向与 JSON 重建                                                          |
| [气垫球](../games/air-hockey/GAME_SPEC.md)         | 5／7／11 分、房主固定为 P1、指定方及同 tick 发球权限、快慢撞击/速度上限、静止挡球、扫掠球门柱/角落/夹球、完整越线计分、目标租期与换球清理、逐 tick JSON 确定性和全部计分/投降 golden                                                                                                                                                                                          |

像素炸弹人额外覆盖 2／3／4 人、镜像砖块/隐藏道具与安全出生、半格转弯预算与提前转向阻挡、玩家与炸弹碰撞、初始属性/道具上限、三命及无敌到期边界、受击继续移动/放弹、方向火焰分别过期、阻挡快照与连锁爆炸、同 tick 全灭/自伤/拾取争抢、180 秒超时和永久投降。掉落覆盖有效加成合计与取整、各属性守恒、占用排除/无重复落点/空间不足、同时及重复受击、无敌与投降不掉落、最后一命、重新拾取/销毁、容量降低后已有炸弹和 seeded determinism。每个人数保留全部支持版本的 golden，当前规则另保留合法拾取后受击散落的中间快照和完整终局；较大测试地图与额外席位验证内部集合及容量扩展。公开投影不得包含隐藏/待显现道具、RNG 或控制租期。规则见 [GAME_SPEC](../games/bomberman/GAME_SPEC.md)。

### Setup

- initialize/transition/project/readiness/finalize 的 strict schema、不变性、序列化、viewer privacy 与独立 seeded determinism。
- owner/player 权限由服务端 actor 推导；合法/非法、normalization、stale、duplicate 和保存失败重试。
- 可配置项覆盖全部合法值、默认值、越界/小数/额外字段与同值提交；单项修改保留其他设置，并验证 finalized Config 实际进入 Core 初始化与 replay header。
- accepted 设置清空全部 ready，rejected/stale/duplicate 不清；只有 selected participants 可 ready。
- 参与者不足、人数上限、离线/重连、席位替换、playerOrder 排列、assignment 完整唯一与随机结果重试稳定。
- 下一局复用完整 Config/participants/order/assignments，生成新 gameplay seed、State、revision/tick、Match/replay，并要求全员重新 ready。

历史结果额外覆盖各游戏支持版本与 golden 中保存的 Outcome、席位方向、胜负/平局/投降、名次并列跳位、未知/损坏结果降级。数据库 `tests/history.database.test.ts` 验证两类 history adapter 的账户隔离和跨连接重读；API 校验 DTO 白名单，浏览器覆盖三类结果、record-only 无播放入口、空列表、失败状态和窄屏。

## Replay 与 Protocol

Replay tests 使用 exact definition 和内存 fixtures，验证重建 State/RNG/Outcome、sequence gap/重复、未知版本、非法 actor/schema、非 canonical payload、规则拒绝、输入交付差异与结果篡改。Rejected/duplicate/stale 不进入日志；append/complete 幂等且冲突失败。实时还覆盖 tick/finalTick、空输入 tick 和 latest/events 的一致性。两种格式的历史 golden 均须持续通过。

Protocol contract 至少验证：

- V6 exact schema、V1–V5 request/ticket/message 拒绝、缺字段/extra fields/非法 discriminator、大小限制和序列化 round trip。
- Ticket 的账户/游客 claims、伪造 UserId、过期、issuer/audience 和代际一致性；payload 不含未授权身份或秘密。
- 房间显示资料扩展覆盖规范化显示名、可选字段与旧客户端形状；资料更新只接受同一席位身份的新签名 ticket，拒绝伪造 slot、账户切换和过期 ticket，不改变准备或游戏状态。
- roundNumber、revision、inputSequence、readiness 集合与 current/next Round 不变量。
- 平台 control 只允许 ready/cancel/close；旧 starter/人数/assignment/immediate-rematch control 拒绝，opaque Setup 由游戏 schema 解析；Realtime V1 不与平台 envelope 混用。
- Ticket HTTP API 必须显式声明 V6，空 body/缺版本返回 400 invalid，V1–V5 返回 400 unsupported；Host/Web 能安全传递错误并提示刷新，不降级。
- Discovery 只允许 roomCode/gameId/gameVersion/setupProtocol/runtime，规范化 code，拒绝敏感 extra fields，并验证历史 V5 的 400 unsupported、404/503/private cache 行为。
- Platform error 与 opaque gameRuleCode 分开，响应不泄漏 stack、DSN、ticket、seed、State 或 canonical record。

## Server 与多人 integration

[apps/game-server/tests](../apps/game-server/tests) 以 `port: 0` 启动真实 Colyseus/SDK/WebSocket；只把 clock、scheduler、ID、ticket authority 与故障注入 stores 作为可控 ports，不 mock 被验证的 room/Action pipeline。

### 权威与提交

- 伪造 actor/slot/State/tick/分数、非法 schema、非成员、过期 ticket、错轮与 stale revision 在进入 Core 前拒绝。
- 同 command 重试返回原结果，不重复推进 revision/RNG/replay；跨轮旧 duplicate 不进入新轮，旧 snapshot 不覆盖新轮。
- 并发命令串行提交；replay append/complete 或 RoomStore 失败时不提前确认候选 State。
- Round 启动失败保留 replay ID、seed、实际 playerOrder；V6 finalized RANDOM、取消后再次准备和同 command 重试不重新随机。
- 各 viewer 的 snapshot 均来自 projectView。隐藏信息游戏加入时必须提供不同玩家秘密隔离 fixture，不能仅以公开棋盘证明私密投影安全。

### 生命周期与重连

- 创建/加入获得不同 stable slots；首局 Setup 没有 gameplay snapshot、Match 或 replay。
- 设置、逐人 ready/cancel、accepted 清 ready、断线/takeover 清对应 ready、完整设置重开均遵守 V6；重复设置规则拒绝不清 ready，重新对局不能替其他玩家确认。
- active/completed/abandoned、terminal outsider 拒绝、owner close、non-owner leave、60 秒 reconnect timeout 与 5 分钟 terminal TTL。
- 同 session 与账户身份通过新 ticket/new reservation 恢复，错误 session 不能窃取 slot，新连接接管后旧连接不能写入。
- V6 从 create 固定到 ticket/join/lifecycle/reconnect；异步旧连接尝试不能污染新目标，V5 在各入站 channel 被拒绝且不改变 State/revision/ready/RNG/replay。
- Discovery 覆盖两类 runtime、开放/关闭/未知房间、gameId 不匹配、同码歧义、store 故障和损坏 generation。
- `/metrics.liveRooms` 覆盖两个 runtime 的等待、满员/locked、completed 保留、断线宽限与关闭后消失；缺失/非法代际计入 unknown，数据库历史行不计入存活房间。

时间边界用 fake clock，不真实等待一分钟。重启测试只验证 archive/replay/history 仍可读取与遗留 active 标记 abandoned，不声称恢复 live State。

### 实时与多人

真实双客户端验证 scheduler 单 writer、输入速率/大小限制、sequence/ack、拒绝与重复、快照顺序、输入释放、takeover 和重连收敛。latest 与 events 两种交付均需验证，拒绝命令不能改变输入队列或日志，正常 tick 推进不因此停机。

中国跳棋增加人数、营地权限、playerOrder、排名和 assignment metadata；坦克迷战使用 2/3/8 客户端覆盖容量、输入权限/幂等、多小局和重开。羽毛球覆盖逐球发球到计分终局、两轮 exact record 与旧版本兼容。气垫球覆盖指定方开球、同 tick 接触、指针目标隐私、稳定蓝橙席位、逐球终局、重连和保留设置的两轮 exact record。所有游戏继续验证投降、终局拒绝和历史规则。

像素炸弹人使用真实 2／3／4 客户端验证人数设置/准备、权限与 schema 拒绝、同 tick 有序 MOVE/PLACE_BOMB、容量不足不补放、duplicate/stale/错轮不入 record、投影隐私、剩余生命/无敌与稳定席位重连、三次受击后的单场终局、投降及完整设置重开。真实双客户端还通过合法移动、炸砖和拾取触发受击散落，验证两端属性/道具收敛与连接接管后的恢复，以及 accepted events 和 RNG 的 exact 重建。临时 PostgreSQL 验证全部支持版本及掉落 golden 的归档、跨连接 exact record 重建、账户隔离及胜/负/平战绩。

## 真实 PostgreSQL

`packages/database/tests/database.integration.test.ts` 与 `apps/game-server/tests/database.integration.test.ts` 使用真实 PostgreSQL 和正式 adapters，不用 SQLite 或 mock Drizzle。缺少测试 DSN 时命令 fail closed，不能据此跳过或声称通过。

### 本地临时数据库

不要求预先配置 `TEST_DATABASE_URL`，也不写入 `.env`。凡矩阵要求 database 或 PostgreSQL-backed E2E，本地 Agent 必须启动一次性 `postgres:17.6-alpine3.22`：仅发布 loopback 随机端口，不挂载数据目录，等待 pg_isready，再在测试进程注入 DSN。同一轮检查可复用该临时容器。

Bash：

```bash
set -eu
test_container="ogh-test-postgres-$RANDOM-$$"
cleanup() { docker rm --force "$test_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker run --detach --rm --name "$test_container" \
  --env POSTGRES_DB=postgres \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=postgres \
  --publish 127.0.0.1::5432 \
  postgres:17.6-alpine3.22
test_port="$(docker port "$test_container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$test_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
test "$ready" = true
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${test_port}/postgres"
pnpm test:database
# 矩阵要求浏览器检查时，在同一容器中继续执行：
# pnpm test:e2e
```

PowerShell：

```powershell
$testContainer = "ogh-test-postgres-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
$previousTestDatabaseUrl = $env:TEST_DATABASE_URL
try {
  docker run --detach --rm --name $testContainer `
    --env POSTGRES_DB=postgres `
    --env POSTGRES_USER=postgres `
    --env POSTGRES_PASSWORD=postgres `
    --publish 127.0.0.1::5432 `
    postgres:17.6-alpine3.22
  if ($LASTEXITCODE -ne 0) { throw 'Temporary PostgreSQL could not start.' }
  $publishedPort = docker port $testContainer 5432/tcp
  if ($LASTEXITCODE -ne 0) { throw 'Temporary PostgreSQL port is unavailable.' }
  $testPort = [int](($publishedPort -split ':')[-1])
  $ready = $false
  for ($attempt = 0; $attempt -lt 60 -and -not $ready; $attempt++) {
    docker exec $testContainer pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true } else { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw 'Temporary PostgreSQL did not become ready.' }
  $env:TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$testPort/postgres"
  pnpm test:database
  if ($LASTEXITCODE -ne 0) { throw 'Database tests failed.' }
  # 矩阵要求浏览器检查时，在此运行 pnpm test:e2e 并检查 $LASTEXITCODE。
} finally {
  if ($null -eq $previousTestDatabaseUrl) {
    Remove-Item Env:TEST_DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:TEST_DATABASE_URL = $previousTestDatabaseUrl
  }
  docker rm --force $testContainer *> $null
}
```

无论成功或失败都必须清理容器。Docker daemon 不可用时明确报告数据库检查 blocked；不得以未配置变量为由跳过，不得使用开发 DATABASE_URL、固定共享库、SQLite 或外部托管数据库替代。测试输出、日志和制品不包含完整 DSN。

测试 owner 在临时实例中创建随机命名的独立 database，连接前校验名称前缀；cleanup 只终止并删除本测试的连接/数据库。CI 使用 workflow 创建的固定版本 service 和测试凭据，不连接开发数据。

### 最低数据库场景

- 空库应用 checked-in migrations，db:check 无 schema/metadata 漂移。
- Replay create/append/complete/get 可跨 adapter/connection 读取并 exact verify；gap、冲突、并发和幂等均正确，拒绝命令不增加 events。
- Round 启动才创建 Match/players；完成关联 completed replay，abandoned 不伪造 Outcome；多轮唯一、连续、参与者集合固定且 playerOrder 正确。
- 用户归属只在开局快照，旧游客永久不回填；私有历史最多 50 条，不泄漏其他参与者、identity、seed 或记录。
- 密码/session/显示名迁移与更新可跨连接读取，旧资料回填正确，最长组合 emoji 显示名可存储和重读，错误与 shutdown 无 credential 或连接泄漏。
- 在线 room generation 只允许 V6 创建/保存且不可改变；真实 SQL 构造的旧 realtime 行默认 V5，跨连接重读仍为 V5，不能在线写入或静默重标为 V6；非法整数/损坏记录 fail closed。
- 多人 room/archive/replay 校验覆盖 2–8 人与 exact manifest；坦克迷战包含八人归档、重开和重读。

## Surface、Host 与 E2E

### Bridge 与 artifact

- game/version/mode 精确匹配，缺失 entrypoint、重复版本、路径穿越、Bridge 不兼容与 digest 漂移失败。
- nonce/source/window、单次 MessageChannel、exact V1/V2、strict fields、重复 intent、timeout/crash/retry/dispose 和发送异常。
- 受限 RESIGN 只在 deployment 允许时触发，复用 clientIntentId；并发 pending、超时和失效命令清理，不把 payload/identity 放进 host.command。
- V2 摘要的 tone、headline/行数/行长与最新 completed sequence；V1/过期/active/Setup/Replay 拒绝，retry/新局/dispose 清除。
- iframe 无 same-origin/form/popup/download/top-navigation 权限，CSP 禁止直接联网；静态 headers 与 session proxy 豁免由实际 Next production build 验证。
- Web live room/replay 不导入 legacy loader，公共 CSS 不含游戏专属 selector；加载失败不转发 intent。
- 每个 Surface 与 Workbench 都能脱离 Next/Game Server 完成 test/typecheck/build/contract；公开 fixtures 不含敏感 key。
- Setup 反馈验证 SDK 的命令关联与 Web 的 accepted/rejected/stale 映射，Bridge 只携带状态和错误码；未知异常安全降级。全部 Surface 的隔离浏览器检查经真实 MessageChannel 注入公开投影与延迟结果，覆盖不相关/迟到确认、过期、权限和连接失败、断线重试、新局与只读状态的 pending 清理。

完整 build 后依次 surface:verify、surface:publish；重复同 digest 必须 no-op，不重写目标。Workbench 覆盖各 mode、connection/read-only/terminal、revision/tick、reduced-motion、viewport 与 fullscreen/focus mode。

### 浏览器旅程

[tooling/e2e/tests](../tooling/e2e/tests) 使用真实 Next production、Colyseus、Chromium 与临时 PostgreSQL，随机 loopback ports 和隔离账户 contexts。除已有 clock/ID/logger 等 ports 外，不 mock 数据库、ticket、matchmaking、WebSocket 或规则管线；结束时清理服务和连接。

公共旅程覆盖目录/邀请、独立 Setup、逐人 ready、独立 Play、合法对局、终局、取消/确认投降、调整设置、完整设置重开、刷新/reconnect、第三方拒绝、关闭/离开、timeout 与跨数据库连接的 replay/history。私有回放验证 exact Replay Surface、逐帧/播放/暂停/slider、只读和无游戏 WebSocket；record-only 验证无播放入口、授权 API 409 和服务器记录仍可验证。

目录检查验证首页与目录的游戏顺序和链接一致、回合制/实时类型与固定/范围人数正确，并可从卡片进入游戏后通过浏览器返回目录。搜索覆盖中文、英文大小写、首尾空白与无结果；组合类型/人数覆盖人数边界、非法枚举降级、清空、URL 刷新/返回恢复与不增加历史条目。桌面、平板和手机横竖屏验证筛选控件不溢出、键盘焦点可见与至少 44px 操作目标。

全部 Setup 旅程验证服务器确认前不更新选择摘要与示意、提交中防重复、拒绝后恢复选择、快照更新保留有效键盘焦点，以及手机横竖屏的滚动与 44px 操作目标。五子棋尺寸与 Pong 目标分数覆盖真实开局、重连、replay header 和完整设置重开；随机顺序在下一局保留实际结果。中国跳棋验证营地占用、人数拒绝和指定首位失效，坦克迷战验证颜色占用与超员提示；羽毛球按 exact 规则版本验证发球说明与对应比分封顶。

认证旅程先完成游客局，再注册完成账户局，验证不认领旧比赛、账户隔离、退出失效和跨设备历史。资料菜单覆盖 NFC/grapheme/头像边界、游客 localStorage 与账户隔离、同源 strict PATCH、Escape/外部关闭和 live room 身份变更确认。

历史筛选覆盖最近 50 条范围提示、游戏/状态组合、服务端顺序、历史游戏与非法参数、空历史和无匹配结果、URL 刷新/返回恢复，以及筛选不重复请求接口。真实归档之后才注入 HTTP 故障，验证失败重试保留条件、重复点击只发起一次请求、离开页面取消请求与迟到响应不覆盖新页面；继续覆盖 401、账户隔离、棋牌回放与实时 record-only。桌面、平板和手机横竖屏验证筛选控件、键盘焦点、44px 目标和无横向溢出。

等待页在回合制和实时房间验证账户/游客显示名与头像、空席位、断线与重连、保存后的双客户端同步，以及改名保留 ready。桌面、平板和手机均显示头像，最长显示名换行后不溢出卡片。

路由回归使用生产实时 scheduler，确保连续快照期间仍能从准备页导航到 active `/play`，邀请重连、终局调整设置后再次全员 ready 也正常；不能仅用暂停 tick 的 scheduler 验证。

单游戏 E2E 保留相应差异：双人棋类的权威胜局/平局/翻转/连接路径，三人中国跳棋的营地/排名/完整重开，羽毛球的逐球发球计分与键盘/真实多指触控，坦克迷战的八浏览器 SVG、多小局、刷新、输入和归档重读。伪造 payload、stale 和 duplicate 的权威负例由 Bridge/Protocol/integration 验证，不通过篡改 iframe 内框架私有对象制造攻击。

### 布局与画面回归

E2E 优先断言可访问 role/test id、用户文本和自然 DOM/SVG 几何，不使用 `toHaveScreenshot()` 或维护整页像素基线；不得注入固定宽高或克隆棋盘来掩盖错误。少量 canvas 内容/显隐采样只验证渲染，不替代权威结果断言。

- 覆盖桌面、平板、手机横竖屏、reduced-motion、全屏失败后 focus mode、焦点/ESC、44px 操作目标与舞台不被 HUD 挤压。
- 棋盘验证格数、行列、颜色、落点/路径投影、边界与跨缩放稳定性；大视口包含 2560×1440 的 100%/150% 等效布局。
- 中国跳棋逐格验证新版 13 行、73 格、180 条等距线、圆形按钮/SVG 端点、自然营地几何及旧拓扑隔离；390×844 与 844×390 下保留触屏目标并能滚动到各角。
- Pong 验证 800×400、2:1 FIT、边界留白、准备期箭头显隐/reduced-motion、倒计时重连，以及持续输入确认不重写连接提示。全部规则版本验证触屏左侧 ↑／右侧 ↓ 的横竖屏布局、64px 目标、键盘与多指共存、相反方向抵消、释放/取消/失焦停止，以及断线、只读和换局后的旧触点失效；真实对局验证触控方向进入权威记录。
- 羽毛球验证 1000×600、5:3 FIT、按键/多指/取消/失焦释放、发球 latch、人物/球拍/接触点/网高投影、动画不误重启、粒子清理、音效解锁/静音/去重与重连不补播。全部规则版本覆盖起跳在左右键上方、右侧两行击球、旧自动发球版隐藏发球键，以及横屏两侧/竖屏下方布局、56px/窄屏 48px 按钮和全屏按钮避让。
- 坦克迷战验证道具图标居中、321 倒计时、击毁轻震幅度/复位、HUD 不震、重复快照不重复触发和 reduced-motion。手机横竖屏、平板、桌面覆盖左右分区、方向说明、56px/窄屏 48px 按钮与八人 HUD/全屏按钮避让；真实触控事件验证前后/左右滑换、滑出释放/重入、多指与键盘共存、实际方向高亮、150ms 续租、取消/失焦/断线/换小局后的旧触点失效。FIRE 仅直接按下一次触发，长按、移动和滑过发射区均不额外开火。

坦克迷战的墙体反馈还覆盖贴墙姿态插值、黑烟去重/扩散/停止/清理、断线和重连不补播、reduced-motion，以及新旧规则的护盾半径与炮口包围几何。Core 同时覆盖四面墙前后移动、内外角、墙边推挤不重叠、移动护盾相对扫掠、边界入射和盾内自伤，浏览器不自行推断权威碰撞。

Playwright 保留 only-on-failure 截图用于排障；trace/video 关闭，避免 bearer ticket 进入制品。截图不是通过条件。

气垫球浏览器检查覆盖 P1/P2 同色球拍与球门、仅上下镜像、桌面/平板/手机横竖屏完整等比球场、鼠标场外持续追踪/沿边移动/静止续租与 Chromium 真实单指拖动、半场夹紧/多指忽略/取消释放、换球与重连后旧触点失效、权威插值收敛、音效解锁/静音/事件去重、边框流光与 reduced-motion。账户旅程完成计分终局、投降保留真实比分、设置复用与跨连接重读；record-only 无播放入口且授权播放 API 返回 409。持续生产 tick 下仍须完成准备页到 Play、重连与下一局设置导航。

像素炸弹人的独立浏览器契约验证完整 13×11 像素地图、最近邻缩放、四人生命/倒计时/结果摘要及历史胜场；Canvas 验证方向火焰、人物居中与无敌闪烁/reduced-motion、受击后散落道具的显现与拾取消失，能力栏接受容量降低后暂时超额的在场炸弹。原生 Web Audio 验证泡泡去重、持续爆炸/连锁续接、到期及失焦/静音/重连/销毁停止。键盘覆盖最后按下方向、Space 边沿和 150ms 续租；Chromium 真实多指覆盖摇杆死区/主轴、与放弹同时按下、滑入按钮不触发、释放/取消/失焦/断线/阶段/场次/销毁清理，受击不清控制、零命才清理。各支持版本的 Setup 核对初始属性、三命/胜场与掉落说明，横竖屏检查自然几何、实际点击命中、焦点框不覆盖状态/能力栏、44px 目标和平台全屏按钮避让。四浏览器账户旅程完成三命终局、刷新恢复、下一场与私有历史，record-only 没有播放入口。

## 完成标准

- 成功路径和关键拒绝路径有覆盖，受影响的静态、unit、contract、integration 与 E2E 检查通过。
- 测试可重复，不依赖任意 sleep、外部公共服务或未清理的共享环境。
- 不跳过、删除或弱化既有测试来掩盖失败。
- 评估 public API、规则/协议/replay/Surface 版本及文档影响。
- 最终交付列出实际命令、结果，以及未执行或阻塞的检查与原因。
