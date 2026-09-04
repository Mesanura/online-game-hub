# Realtime Runtime 设计基线

> 状态：M8 已实现（单实例双人 Pong）
>
> 本文是“独立 realtime runtime 与 Phaser Pong”的权威设计边界。现有回合制契约仍以 [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)、[NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md) 和 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md) 为准。

## 1. 目标与范围

M8 只交付一个双人 `games/pong` 纵切，用它证明平台可以承载需要固定 tick 和持续输入的实时 2D 游戏。第一版采用固定整数单位的 60 Hz authoritative simulation；客户端以 Phaser 绘制服务器投影的视图，在两个服务器快照之间做显示插值。

本轮复用 Platform 的目录、ticket、身份、room code、stable slots、ready、reconnect、Round/Match lifecycle、账户归属和私有 replay 授权。它不复用回合制的 `GameDefinition`、`GameClientModule`、`game.action`、`match.snapshot`、`expectedRevision` 或 discrete replay verifier。

本轮明确不做：客户端预测或回滚、观战、公开 replay、Matchmaking、排行榜、AI、移动端虚拟摇杆、Redis、多实例 ownership、durable active-room recovery、共享 ECS、通用物理引擎和第二个 realtime 游戏。

## 2. 职责边界

### Platform

Platform 仍然决定 session、ticket、room membership、stable slot、owner、Round 启动条件、reconnect grace、关闭/离开、Match 状态和账户授权。Platform 不读取球的位置、碰撞或分数，也不根据 Phaser 帧率推进比赛。

### Realtime runtime

Realtime server runtime 维护单 room 的唯一 authoritative writer，运行固定 tick scheduler，按 server 接收顺序规范化 input、分配生效 tick、调用 simulation 一次并发送完整 projected snapshot。scheduler 使用 wall clock 只决定何时执行 tick；wall clock、socket 到达时间和浏览器时间戳不进入 simulation 或 replay 输入。

Realtime client host 负责 ticket/join、lifecycle、snapshot 顺序、重连、输入 sequence、rejection 和 transport teardown。它不推导 State、Outcome、碰撞或下一个 tick。

### Game

`games/pong` 的 simulation 是纯、deterministic、JSON-serializable TypeScript。它只接受已规范化的每 tick inputs，产生新的 State/RNG 和 Outcome，并通过 `projectView` 暴露公开字段。Phaser、React、DOM、Colyseus、WebSocket、数据库和系统时间只能出现在 client/app 或 server composition 边界。

## 3. 计划中的 package 边界

以下 package 是 M8 当前实现的 public API 边界：

| Package                        | 目标职责                                                                                               | 不得依赖                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `realtime-game-sdk`            | realtime manifest、simulation definition、tick/input/view/outcome 类型与纯 replay runner               | React、Phaser、DOM、Colyseus、WebSocket、数据库、`GameDefinition` |
| `realtime-game-server-runtime` | 固定 tick、input queue、单 writer、snapshot/rejection、reconnect adapter 与 realtime replay port       | `game-server-runtime`、具体游戏、Phaser、DOM                      |
| `realtime-game-client-sdk`     | realtime ticket/room host、snapshot interpolation clock、input sender 与 Phaser 无关的 client contract | `game-client-sdk` 的 turn-based host、具体游戏、数据库            |
| `games/pong`                   | Pong simulation、manifest、Phaser client、规则说明、golden/unit/client tests                           | 其他游戏；simulation 依赖 realtime SDK，client 可依赖 Phaser      |

只有 composition layer 可以同时看到 manifest、registry、两个 runtime 和 Platform ports。若复用身份/lifecycle 代码，先提取不含游戏规则、tick 和 transport 的最小 port，并同步更新依赖检查；不要以 `packages/shared` 或“未来通用”接口承载未经证明的抽象。

## 4. Simulation contract

概念契约如下，实际命名以实现和 contract tests 为准：

```ts
interface RealtimeGameDefinition<Config, State, Input, View, Outcome> {
  manifest: RealtimeGameManifest;
  configSchema: ZodType<Config>;
  inputSchema: ZodType<Input>;
  createInitialState(context: {
    config: Readonly<Config>;
    players: readonly PlayerSlotId[];
    rng: Readonly<RngState>;
  }): { state: State; rng: RngState };
  step(context: {
    state: Readonly<State>;
    tick: number;
    inputs: readonly { slotId: PlayerSlotId; input: Readonly<Input> }[];
    rng: Readonly<RngState>;
  }): { state: State; rng: RngState };
  projectView(context: { state: Readonly<State>; viewer: Viewer }): View;
  getOutcome(state: Readonly<State>): Outcome | null;
}
```

`tick` 从 `0` 开始且每次 `step` 恰好增加 `1`；输入数组按稳定 slot 顺序排列。State、Input、Config、RNG 均不可变，禁止 `Math.random()`、系统时间、环境 I/O 和浮点累积误差。Pong 使用固定整数坐标/速度，配置、边界、碰撞 tie-break、发球方向和得分终局均是 `pong@1.0.0` 的 replay 契约。

Pong 的最小规则为双人 paddle、上下方向 intent（`-1 | 0 | 1`）、球拍/场地边界碰撞、得分至目标分数、确定性发球、`RESIGN` 和 `WIN`/`RESIGNATION` Outcome。客户端不提交位置、速度、碰撞、分数、Outcome 或目标 tick；服务器从 slot 映射 actor 并在 Core 之外处理输入权限。

## 5. Realtime Protocol V1

Realtime Protocol V1 是独立 message family，不改写或宽松解析 Protocol V5。现有 ticket、room code、lifecycle 和 reconnect 继续沿用 V5 平台消息；只有进入 realtime room 后才使用以下消息：

```ts
interface RealtimeInputCommand {
  type: "realtime.input";
  realtimeProtocolVersion: 1;
  commandId: string;
  roundNumber: number;
  inputSequence: number;
  input: unknown;
}

interface RealtimeSnapshot {
  type: "realtime.snapshot";
  realtimeProtocolVersion: 1;
  gameId: string;
  gameVersion: string;
  roundNumber: number;
  tick: number;
  viewer: { kind: "player"; slotId: string };
  view: unknown;
  outcome: unknown | null;
  acknowledgedInputSequence: number;
}
```

服务端还提供严格的 `realtime.rejected` envelope，沿用安全的 platform/game error code 语义。客户端 input 不含 actor、slot、State、Outcome、client time 或 tick；服务端对每个 slot 要求 `inputSequence` 单调，重复/倒退 sequence、重复 command、schema-invalid 或非 active lifecycle 不进入 simulation。服务端在收到合法 input 后决定其生效 tick，并按每 tick 的稳定 slot 顺序调用 Core；snapshot 按固定 cadence 发送，且 `tick` 不得倒退。客户端不得以本地 tick 覆盖 server snapshot。

初版客户端不做预测或回滚。插值只影响视觉位置，不改变可发送 input、simulation、replay 或 Outcome。重连从当前完整 snapshot 和服务器 acknowledgement 收敛，不重放浏览器本地输入历史。

## 6. Replay 与持久化

M8 定义独立的 `Realtime Replay Format V1`，不能让 V1 离散 Action reader 猜测 realtime payload。Header 至少包含 `runtime: "realtime"`、`gameId`、`gameVersion`、固定 tick rate、canonical Config、seed 和有序 players；事件为服务端决定的 `{ sequence, tick, actorSlotId, input }`。

只记录规范化且 accepted 的 input change。被拒绝、重复、倒退、过期或连接断开前未接受的 command 不记录，也不推进 simulation。相同 header、seed、player order 和事件序列必须逐 tick 重建相同 State、RNG、score、Outcome 和最终 tick；事件必须有连续 sequence、非递减 tick，并拒绝跨版本/跨 runtime 读取。

Realtime Round 复用 Platform 的 Match/账户授权边界，但存储 adapter 必须显式区分 realtime replay format 与现有 Replay Format V1。实现前先完成数据库 schema/port 评估：不得只把 tick 藏在未验证的 JSON 字符串中；如现有表无法表达约束，增加最小迁移或 realtime 专用事件表。M8 的私有 replay API/页面只返回经 verifier 生成的、有大小和帧数上限的 projected frames；不返回 canonical input log、seed、raw State 或其他玩家私密数据。旧五游戏的 replay、history 和 golden fixture 必须完全不变。

## 7. Phaser client 边界

Phaser 只在 `games/pong` client package 中拥有。它从 realtime client host 接收 immutable View、connection/lifecycle 状态和 acknowledged input sequence，负责 canvas、键盘输入、视觉插值、胜负 HUD 和 reduced-motion 降级。Phaser scene 不创建 socket、不解析 ticket、不决定 actor、不写服务器 State，也不执行权威碰撞。

真实浏览器验收必须检查 canvas 非空、尺寸稳定、键盘输入可达、重连后视图收敛和终局画面；截图或像素断言不能被用来替代 server integration 的 authoritative 断言。

## 8. 版本与迁移

- 现有 turn-based manifest、Protocol V5、Replay Format V1、六款已支持游戏和其 public exports 保持兼容。
- `GameManifest.runtime` 扩展为 discriminated union、registry/runtime resolver、client host、replay API 或数据库 schema 的每一项修改都必须说明跨 package 价值、兼容性和迁移，并补 contract tests。
- 改变 Pong simulation、输入 schema、tick rate、整数单位、碰撞 tie-break、发球 RNG 或 replay event 解释时提升 `gameVersion`；改变 Realtime Protocol V1 envelope 时提升 realtime protocol version；改变 realtime replay envelope 时提升 realtime replay format version。
- M8 仍是单实例；进程重启不恢复 active realtime State，只按现有平台策略关闭/abandon，并保证已完成 archive/replay 可读取。

## 9. M8 Definition of Done

- 两个真实 browser contexts 可从统一目录创建/加入 Pong，完成 ready、实时对局、得分终局、投降、短暂断线恢复和关闭/离开；
- Core、server runtime、protocol、replay verifier、PostgreSQL adapter、Phaser client 和 registry 都有针对合法/非法/边界/隐私/确定性的测试；
- 伪造 actor、位置、速度、碰撞、分数、Outcome、tick 或 input sequence 不会改变权威结果；
- fixed seed + accepted input log 的 golden replay 可重复验证，旧 Replay Format V1 fixtures 全部通过；
- 受影响的 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm deps:check`、`pnpm test:integration`、`pnpm test:database` 和 `pnpm test:e2e` 均通过；
- 文档、迁移、registry 登记、package exports 和 Conventional Commit 均完成，没有把 Matchmaking、观战、预测/回滚、Redis、多实例或第二个 realtime 游戏带入本轮。
