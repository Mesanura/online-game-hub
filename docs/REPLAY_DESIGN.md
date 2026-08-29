# Replay 设计

> 状态：V1 设计（M3 authoritative room 写入已实现）  
> 本文是 canonical replay 内容、确定性重建、版本兼容和存储端口的权威来源。Core 随机性规则见 [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)。

## 1. 目标

Canonical replay 是服务器记录的、可确定性重建一场比赛的最小事件日志。它服务于：

- 自动化 replay 测试与 bug 复现；
- 断线或服务恢复能力的未来基础；
- 比赛回放；
- 举报审查与安全调查；
- 数据分析和历史记录。

V1 只要求生成、保存到内存、读取并验证 replay。PostgreSQL、公开 replay API 和回放 UI 不在范围内。

## 2. Canonical Record

```ts
interface ReplayHeader {
  replayFormatVersion: 1;
  gameId: string;
  gameVersion: string;
  rng: {
    algorithm: string;
    seed: string;
  };
  initialConfig: JsonValue;
  players: readonly {
    slotId: string;
    participantRef?: string;
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

持久化 wrapper 可以另行保存 `replayId`、`matchId`、创建/结束时间、可见性和索引字段。这些 metadata 不作为 Core 输入，不得影响重建结果。

## 3. 字段语义

### 3.1 Version

- `replayFormatVersion` 描述 replay envelope 格式，V1 固定为整数 `1`。
- `gameId + gameVersion` 精确选择用于重建的 `GameDefinition`。
- `protocolVersion` 不属于 replay；transport 升级不应改变 canonical game history。

### 3.2 RNG

- Game Server 为比赛生成 seed，header 记录 seed 和 exact RNG algorithm version。
- 重建从 cursor `0` 开始，依次执行初始化和 accepted actions。
- Rejected、duplicate 和 stale commands 不记录，也不消耗 replay RNG。
- 对隐藏信息游戏，seed 在比赛进行中属于服务器秘密。

### 3.3 Players

- 重建只依赖 `PlayerSlotId` 和固定 slot 顺序。
- `participantRef` 是可选、可脱敏的平台引用，不得成为规则输入。
- 显示名称、头像和账号资料属于 match metadata，不进入 canonical input。

### 3.4 Actions

- 只写入已经通过 Zod 解析、规范化并被 Core accepted 的 Action。
- `sequence` 从 `1` 开始连续递增，并与 resulting match revision 对齐。
- actor 使用 slot，不使用 connection/session/account ID。
- 不记录客户端原始 payload、actor claim、网络重试、拒绝或人类可读错误。

### 3.5 Outcome

- 活跃或 abandoned 且无规则结果的 replay 可以暂时为 `null`。
- completed match 保存 Core `getOutcome` 的 JSON 结果作为验证值。
- `recordedOutcome` 是完整性检查，不替代从 actions 重新计算 Outcome。
- `recordedRngCursor` 在完成时保存最终 cursor，用于检测随机消费顺序漂移；未完成记录可以为 `null`。

## 4. 写入顺序与原子性

对于每个 room，M3 runtime 以同一个 Promise queue 串行 join、leave、timeout 和 Action，是唯一 authoritative writer。Action 按以下顺序构造并提交候选结果：

1. 验证平台 envelope、session、slot 和 revision；
2. 解析规范化 Action；
3. 调用 Core `transition`；
4. 构造包含新 State、RNG cursor、revision 和 `ReplayAction` 的 accepted candidate；
5. 以当前 revision 作为 `expectedSequence` 先 append canonical action；
6. append 成功后才更新 room aggregate 的 State/RNG/revision，保存 `RoomStore`；终局再以最终 RNG cursor 和 Core Outcome complete replay；
7. 所有写入成功后缓存 command outcome，并按 viewer 投影、发送完整 snapshot。

Schema-invalid、platform rejected、Core rejected、stale 或 duplicate command 不产生 `ReplayAction`，也不改变 revision 或 RNG cursor。

`append` 失败时 M3 不更新 aggregate/`RoomStore`，返回 `INTERNAL_ERROR`，不缓存或发送 accepted snapshot，并增加 replay append failure 指标。终局 `complete` 失败同样不确认 accepted，而被视为 internal room failure。

M3 的 `RoomStore` 与 `ReplayStore` 都是单进程内存 adapter；上述操作受同一 room writer critical section 保护，但两个 port 调用不是 durable database transaction，也不能为未来跨存储故障提供 rollback。持久化 adapter 必须使用数据库事务或 outbox，并继续用 `expectedSequence`/唯一约束保证幂等；不能把 M3 的调用顺序直接宣称为跨存储原子性。

## 5. Replay Store Port

存储端口属于 `game-server-runtime`，不属于 Game Core。

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

- V1 `InMemoryReplayStore` 实现该端口，进程重启后数据丢失。
- `append` 必须拒绝缺口、重复或乱序 sequence。
- `complete` 只接受非 `null` 的 terminal Outcome；相同 cursor/Outcome 的重复调用幂等，且不得允许另一个结果覆盖已完成记录。
- PostgreSQL adapter 将来实现相同语义，不要求 Core 或 room 改变。

M3 room 创建时在 Core 初始化完成后创建 replay header，其中保存 exact game/version、规范化 Config、服务器生成的 stable slot 顺序和初始 RNG algorithm/seed。每次 accepted transition 追加一个规范化 action；比赛进入 `completed` 时保存最终 RNG cursor 与 Core Outcome。`abandoned` 没有伪造游戏 Outcome，record 可以保持未完成状态。

## 6. 确定性重建

Replay runner 执行：

1. 按 `gameId + gameVersion` 从 server registry 解析 definition；
2. 验证 `replayFormatVersion`、header、Config、slots 和 RNG algorithm；
3. 使用 header seed 和 cursor `0` 调用 `createInitialState`；
4. 按连续 sequence 验证每个 actor slot 和 Action schema；
5. 依次调用 `transition`，要求每个记录事件再次得到 accepted；
6. 验证最终 RNG cursor；
7. 调用 `getOutcome` 并与 `recordedOutcome` 深度比较。

任意 schema error、未知版本、sequence gap、rejected transition 或 Outcome 不一致都使 replay verification 失败，并返回结构化诊断；runner 不静默跳过事件或自动改写历史。

M2 由 `game-server-runtime` 根 public entry 导出 `REPLAY_FORMAT_VERSION`、record 类型、`ReplayStore`、`InMemoryReplayStore` 和 `verifyReplay(input, resolver)`；M3 authoritative room 直接消费同一 port。Verifier 接受一个按 exact `gameId + gameVersion` 返回 `UnknownGameDefinition` 的 resolver port，因此 runtime 不依赖 registry 或具体游戏；结构化失败结果覆盖 envelope/header、Config/Action schema、canonical normalization、sequence、actor、Core rejection、RNG cursor 和 Outcome。

## 7. Version Compatibility

- 破坏重建结果的规则修改发布新 `gameVersion`。
- Server registry 必须按 exact version 加载旧 definition；“latest”只用于创建新房间。
- 每个保留版本至少拥有一个 golden replay fixture。
- 删除旧 definition 前，必须把其 replay 迁移为经验证的稳定归档格式，或明确结束该版本的读取承诺并经过产品/架构审批。
- Replay envelope 不兼容变化提升 `replayFormatVersion`，reader 应显式分派版本，不原地猜测字段。

Bug fix 是否提升版本以“相同 replay 是否可能得到不同 State、RNG cursor 或 Outcome”为判断标准，而不是以改动大小判断。

当前支持版本及 fixture：

- `tic-tac-toe@1.0.0`：`games/tic-tac-toe/tests/fixtures/tic-tac-toe-1.0.0-win.json`

## 8. Hidden Information 与访问控制

Canonical replay 是服务器内部记录，可能通过 seed、Action 或 Config 暴露牌序、秘密目标和所有玩家私有信息。

- 比赛进行中不得向客户端发送完整 canonical replay 或 seed。
- `projectView` 不等于 replay 导出策略；公开 replay 需要独立的授权与脱敏设计。
- 日志、监控和错误响应不得包含完整 replay payload。
- 举报审查、玩家下载和公开分享可能拥有不同访问级别，具体策略暂缓。
- V1 Tic-Tac-Toe 没有隐藏信息，但仍按内部 canonical record 处理。

## 9. Checkpoint

V1 不把 State snapshot/checkpoint 作为 canonical replay 的必要字段。未来长比赛可加入派生 checkpoint 以加速恢复或拖动时间轴，但必须满足：

- checkpoint 可以由 header + actions 重新生成；
- checkpoint 带 game/replay version、sequence 和 state digest；
- checkpoint 验证失败时回退到完整重建；
- checkpoint 不取代 accepted action log，也不允许绕过 Core。

## 10. Replay 验收标准

- 相同 replay 在重复运行中得到深度相等的 State、RNG cursor 和 Outcome；
- 修改 action 顺序、actor、payload、seed 或版本时验证可靠失败或产生明确不同结果；
- rejected、duplicate、stale command 不出现在 canonical actions；
- replay runner 无 React、Colyseus、WebSocket、数据库或系统时钟依赖；
- 旧 `gameVersion` 的 golden replay 在新代码中持续通过；
- 隐藏 State、seed 和私密 Action 不通过 snapshot 或普通日志泄漏。

更完整的自动化分层见 [TESTING.md](./TESTING.md)。
