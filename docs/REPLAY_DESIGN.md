# Replay 设计

本文定义 canonical record、存储端口、写入顺序、确定性重建和读取权限。回合制 Core/RNG 见 [Game Plugin](./GAME_PLUGIN_SPEC.md)，实时输入交付见 [Realtime Runtime](./REALTIME_RUNTIME_DESIGN.md)，支持版本见 [游戏索引](../games/README.md)。

## 能力与用途

Canonical replay 是服务器内部可重建一轮比赛的最小日志，用于确定性验证、问题复现和受控历史读取。一个 live room 可有多轮，每轮拥有独立记录；记录不等同于活动房间恢复能力，也不直接发给浏览器。

每个 exact 游戏版本必须显式声明 replay capability：

| 模式              | 服务器行为                           | 玩家行为                                                           |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `player-playback` | 保存、验证 canonical journal         | 授权后通过 Replay Surface 查看 projected frames                    |
| `record-only`     | 同样保存和验证 journal               | 无播放入口，已授权播放请求返回 `409 PLAYER_PLAYBACK_NOT_SUPPORTED` |
| `none`            | 类型保留；当前 runtime 拒绝注册/启动 | 尚无受支持游戏或无记录数据库语义                                   |

当前棋牌及其历史版本支持播放，三款实时游戏及其历史版本均为 record-only。能力调整须按 exact version 审查，不删除旧 canonical 记录，不用 UI 隐藏替代服务端授权。公开 replay、下载、分享和观战尚未提供。

## 两类记录格式

两类格式分别标记版本 `1`，拥有独立类型与 reader；整数相同不表示 envelope 相同。Wrapper 可保存 replayId、matchId、时间和索引 metadata，这些值不进入 Core，不影响重建。

### 回合制 Replay Format V1

由 [game-server-runtime](../packages/game-server-runtime/src/index.ts) 定义：

```ts
interface ReplayHeader {
  replayFormatVersion: 1;
  gameId: string;
  gameVersion: string;
  rng: { algorithm: string; seed: string };
  initialConfig: JsonValue;
  players: readonly {
    slotId: string;
    participantRef?: string;
    assignment?: string;
  }[];
}

interface ReplayAction {
  sequence: number;
  actorSlotId: string;
  action: JsonValue;
}

interface CanonicalReplay {
  header: ReplayHeader;
  actions: readonly ReplayAction[];
  recordedRngCursor: number | null;
  recordedOutcome: JsonValue | null;
}
```

- `sequence` 从 1 连续递增，与 accepted Action 后的 match revision 对齐。
- 只记录 schema 解析、规范化且被 Core accepted 的 Action；不记录原始 payload、客户端 actor claim、重试、拒绝或错误文本。
- actor 使用 stable slot，不使用 connection、session 或 account ID。
- 有序 `players` 与该轮 Core 初始化顺序完全一致；assignment 为游戏需要的位置/营地元数据。
- `participantRef` 仅为可脱敏的平台引用，不能成为规则输入。显示名与头像不进入 canonical input。

### Realtime Replay Format V1

由 [realtime-game-sdk](../packages/realtime-game-sdk/src/index.ts) 定义：

```ts
interface RealtimeReplayHeader {
  replayFormatVersion: 1;
  runtime: "realtime";
  gameId: string;
  gameVersion: string;
  tickRate: 60;
  rng: { algorithm: string; seed: string };
  initialConfig: JsonValue;
  players: readonly { slotId: string }[];
}

interface RealtimeReplayEvent {
  sequence: number;
  tick: number;
  actorSlotId: string;
  input: JsonValue;
}

interface RealtimeCanonicalReplay {
  header: RealtimeReplayHeader;
  events: readonly RealtimeReplayEvent[];
  recordedRngCursor: number | null;
  recordedOutcome: JsonValue | null;
  finalTick: number;
}
```

事件记录服务端确定生效 tick 的 accepted input；sequence 连续，tick 非递减。`finalTick` 是执行步数，重建逐 tick 执行 `0..finalTick-1`，不能只处理有事件的 tick。客户端 inputSequence、到达时间和目标时间不进入 canonical event。

有序 players 支持 2–8 个互异席位，并须符合 exact manifest 的人数范围。`inputDelivery` 省略或为 `latest` 时，每 tick 每玩家仅最后输入生效；为 `events` 时保留该 tick 全部事件，按 playerOrder 分组，同玩家保持接收顺序。服务器、verifier 与投影帧 runner 必须一致；旧版本继续使用自己的输入语义。

坦克迷战的地图小局属于同一平台 Match，因此写入同一记录。其具体地图、物理与弹药变化属于游戏规则版本，不扩展公共 replay envelope。

### 公共语义

- `gameId + gameVersion` 精确选择 definition，不能用 current/latest 解释历史。
- 每轮新 seed，重建从 RNG cursor 0 开始，依次执行初始化与 Action/tick。algorithm、seed 解释和随机消费顺序都是兼容契约。
- recordedOutcome 与 recordedRngCursor 是完成后的完整性验证值，不能替代重新计算；未完成或 abandoned 记录可以保持 null，不伪造胜负。
- `protocolVersion`、Setup State/Action、setup seed、ready 和网络重试不属于 gameplay replay。
- V6 finalized Config、有序 slots 与已支持的 assignment 字段必须完整表达 Core 初始化输入。实时 header 只有 slots，不能擅自添加回合制 assignment 字段；新增初始化信息先评估对应格式。

## 写入顺序与原子性

### Round 启动

同一 room 的 join、leave、timeout、control 与 gameplay 操作通过唯一 writer 串行处理。创建房间不初始化 Core，也不创建 Match/replay。满足开局条件后：

1. 从已固化的 `FinalizedRoundSetup` 构造 pending candidate，固定 roundNumber、playerOrder、replay ID 与 gameplay seed。
2. 使用相同 Config、顺序和 seed 初始化 Core 并创建 replay header。
3. 通过 MatchArchive 幂等创建 active Match，再保存候选 RoomStore record。
4. 所有外部写入成功后才提交内存 aggregate。

失败保留 candidate，重试不重新生成 replay ID、seed 或 playerOrder。Setup 持久化失败允许同 command 重试。下一轮默认复用完整设置，但生成新的游戏状态、seed、Match 与 replay，并要求重新 ready。在线 V5 退役不改写已有 replay header、规则版本、RNG 或 Outcome，全部历史 golden 与 exact reader 继续验证。

### 回合制 Action 提交

1. 验证平台 envelope、session、slot、round 和 expectedRevision。
2. 解析规范化 Action，调用 `transition`，构造新 State/RNG/revision 与 ReplayAction 候选。
3. 以当前 revision 为 expectedSequence 先 append event。
4. 终局 complete replay，再保存候选 RoomStore。
5. 全部成功后提交内存、缓存命令结果，并逐 viewer 投影发送 snapshot。

Schema-invalid、platform/Core rejected、错轮、stale 和 duplicate 不追加 event，不增加 revision 或消费 RNG。append、complete 或 room save 失败时不提前提交内存或发送 accepted snapshot，返回安全错误并记录 persistence failure；相同规范化内容可幂等重试，冲突内容失败。

### 数据库边界

回合制 PostgreSQL header create 独立幂等；append 在事务内写 `replay_actions` 并推进 Match final revision，terminal complete 在事务内保存 cursor/Outcome 并完成 Match。Replay row lock 与 `(replay_id, sequence)` 主键维护并发顺序。

实时 runtime 按规范化 tick frame 写 accepted input events，再按固定步骤推进 simulation；专用 replay/event 表保存 tick、format 和完成状态，由 realtime adapters 校验。它使用独立 port/reader，不伪装成离散 Action。

后续 Round 通过 `(runtime_room_id, round_number)` 唯一约束和 advisory lock 验证上一轮 completed、连续轮次、exact game/version 与参与者身份集合。playerOrder 可以改变，不要求参与者插入顺序相同。

ReplayStore、MatchArchive 与内存权威 State 没有跨存储原子事务。当前由单 writer、pending candidate、数据库事务、唯一约束和幂等操作控制失败窗口；不提供 active State rollback/recovery，也不引入 outbox。单实例重启只把遗留 waiting/active archive 标记 abandoned；未开始首局的房间没有 Match 可标记。

## 存储端口

回合制端口属于 `game-server-runtime`，不属于 Core：

```ts
interface ReplayStore {
  create(replayId: string, header: ReplayHeader): Promise<void>;
  append(
    replayId: string,
    expectedSequence: number,
    event: ReplayAction,
  ): Promise<void>;
  complete(
    replayId: string,
    expectedSequence: number,
    finalRngCursor: number,
    outcome: JsonValue,
  ): Promise<void>;
  get(replayId: string): Promise<CanonicalReplay | null>;
}
```

- 同时保留 InMemoryReplayStore 与生产 PostgresReplayStore，数据库 client 显式注入并关闭。
- 相同 header 的 create、相同 sequence/content 的 append、相同 cursor/Outcome 的 complete 均幂等；缺口、乱序或冲突内容失败。
- complete 只接受非 null terminal Outcome，不允许覆盖已完成结果。
- get 使用 repeatable-read 读取一致 header/events/completion；JSONB 视为 unknown 重新校验，污染数据返回稳定安全错误。

实时端口由 `realtime-game-server-runtime` 拥有，消费 RealtimeReplayHeader/Event，并以 finalTick 完成记录；其公共类型与回合制端口分开维护。

## 重建与版本兼容

回合制 verifier 按 exact resolver 取得 definition，验证 header、canonical Config、players、RNG 和连续 sequence；从 cursor 0 初始化，再逐条验证 actor/schema、调用 transition 并要求 accepted，最后比较 RNG cursor 与 Outcome。

实时 verifier 另检查 runtime/tick rate、事件 tick 和 finalTick，按 exact inputDelivery 构造每个 tick 的输入并执行 step。未知版本、非法 actor、非 canonical payload、sequence gap、无效 tick、规则拒绝或结果不一致均失败，不跳过事件或改写历史。纯 verifier 通过 resolver port 访问 definition，不依赖 registry、数据库、Colyseus 或系统时间。

影响相同日志重建结果的规则、schema、RNG 或 bug fix 必须评估新 gameVersion；envelope 不兼容变化提升对应 replayFormatVersion。旧 Core 独立冻结，不能 alias current。删除旧 definition 前，须迁移为经验证的稳定归档，或明确结束读取承诺并经过产品/架构审批。

每个支持版本至少有一份 golden fixture，位于各游戏 `tests/fixtures/`，由各包 `test:golden` 执行。游戏规则与历史差异只维护在 [游戏目录](../games/README.md)，本文不重复列易漂移的 fixture 文件名。不能覆盖 fixture 来掩盖意外行为变化。

## 授权播放与隐私

Canonical record 可通过 seed、Config 或 Actions 暴露隐藏信息，始终作为服务器内部数据处理。`projectView` 是游戏投影入口，不自动等同于公开导出授权。

- `GET /api/matches` 只返回当前账户安全 metadata；replayAvailable 仅当 exact definition 为 player-playback 且记录完整时为 true。
- `GET /api/matches/[matchId]/replay` 先验证账户和参赛归属，再判断版本、能力与完成状态。未登录返回 401，未参赛/不存在遵循安全 404；record-only 返回 409，未知或不可验证版本返回 REPLAY_UNAVAILABLE。
- 只为 completed Match 与 completed record 重建有帧数/响应大小上限的 projected frames；浏览器不接收 canonical header/events、seed、raw State 或其他玩家私密数据。
- 授权 viewer 由服务器根据账户参赛关系推导，不能由 query 指定。历史 frozen definition 与 exact Replay Surface 独立解析，播放严格只读且不建立游戏 WebSocket。
- 游客 Round 的账户关联永久为空，注册/登录、归档重试和 session 轮换均不回填。
- 所有响应保持 private/no-store；日志、错误和监控不得包含完整记录或 credential。

当前没有隐藏信息游戏的玩家回放授权产品；未来公开分享、下载或审查权限须单独设计。

## Checkpoint 与验收

当前 canonical record 不依赖 State checkpoint。未来 checkpoint 必须能由完整日志重建，携带 game/replay version、sequence/tick 与 digest；校验失败回退完整重建，不取代 accepted event log，也不绕过 Core。

Replay 变更至少验证重复重建、State/RNG/Outcome 一致、事件篡改失败、拒绝命令不入日志、全部历史 golden、数据库跨连接读取与玩家权限。record-only 仍须验证 create/append/complete/verify。实际命令与受影响层级见 [TESTING.md](./TESTING.md)。
