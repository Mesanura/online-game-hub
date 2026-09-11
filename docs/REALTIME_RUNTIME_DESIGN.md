# Realtime Runtime 设计

本文定义固定 tick simulation、输入交付、实时协议和客户端职责。当前消费者为 Pong、火柴人羽毛球与坦克迷战；游戏规则和版本见 [游戏索引](../games/README.md)。共享房间协议见 [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md)，记录格式见 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md)。

## 范围与职责

实时管线与回合制 Action 管线并列，复用平台的目录、身份、ticket、room code、stable slots、准备、重连、Round/Match 和账户授权；不复用 `GameDefinition`、回合制 Host、`game.action`、`match.snapshot` 或 `expectedRevision`。

| Owner                   | 职责                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Platform                | 身份、room membership、owner、参与者、Setup/ready、关闭/离开、重连与账户归属                    |
| Realtime server runtime | 单 room writer、固定 tick scheduler、输入排序/规范化、生效 tick、完整 projected snapshot 和记录 |
| Realtime client host    | ticket/join、协议代际、snapshot 顺序、input sequence/ack、重连、拒绝与 transport teardown       |
| Game Core               | 纯 simulation、输入效果、持续控制有效期、物理、计分、Outcome 与 `projectView`                   |
| Game Surface            | 输入采集、公开视图渲染、显示插值、终局摘要与可访问性                                            |

wall clock 只决定 scheduler 何时执行 tick；系统时间、网络到达时间和浏览器时间戳不进入 Core 或 replay 输入。当前不实现客户端预测/回滚、通用 ECS、多实例 ownership 或 active-room recovery。

## Package 边界

- `realtime-game-sdk`：manifest、simulation、纯 RNG、实时 canonical 类型和 replay runner；不依赖 DOM、Phaser、transport、数据库或回合制 definition。
- `realtime-game-server-runtime`：输入队列、scheduler、room adapter、snapshot/rejection 和存储 ports；不依赖具体游戏或 `game-server-runtime` 实现。
- `realtime-game-client-sdk`：与 React/Phaser 无关的 Host、input sender、连接状态、资料同步和显示插值时钟；不依赖回合制 Host、具体游戏或数据库。
- `games/<id>`：各自的整数 simulation、manifest、Setup 与 golden tests；Pong 的旧 Client 已移除，所有实时表现均在独立 Surface 中实现。
- `game-surfaces/<id>`：独立画面；Pong/羽毛球使用 Phaser，坦克迷战使用 SVG，均只依赖 Bridge 和自身渲染栈。

只有 composition layer 同时看到 registry、两个 runtime 和平台 adapters。共享代码先证明实际复用，再提取职责明确的纯契约；不建立泛化 shared 包。完整依赖约束见 [系统架构](./ARCHITECTURE.md)。

## Simulation 契约

下面省略 readonly 与 JSON 泛型约束，完整类型见 [realtime-game-sdk](../packages/realtime-game-sdk/src/index.ts)：

```ts
interface RealtimeGameDefinition<Config, State, Input, View, Outcome> {
  manifest: RealtimeGameManifest;
  configSchema: ZodType<Config>;
  inputSchema: ZodType<Input>;
  createInitialState(context: {
    config: Readonly<Config>;
    players: readonly RealtimePlayerSlotId[];
    rng: Readonly<RealtimeRngState>;
  }): { state: State; rng: RealtimeRngState };
  step(context: {
    state: Readonly<State>;
    tick: number;
    inputs: readonly { slotId: RealtimePlayerSlotId; input: Input }[];
    rng: Readonly<RealtimeRngState>;
  }): { state: State; rng: RealtimeRngState };
  projectView(context: {
    state: Readonly<State>;
    viewer: { kind: "player"; slotId: RealtimePlayerSlotId };
  }): View;
  getOutcome(state: Readonly<State>): Outcome | null;
}
```

当前 tick rate 固定为 60 Hz。simulation 从 tick `0` 开始，runner 顺序执行到 `finalTick - 1`；无输入的 tick 仍执行 `step`。State、Input、Config 与 RNG 均不可变、JSON-safe。禁止全局随机、时钟和环境 I/O；游戏自行固定整数单位、碰撞顺序和必要的中间量化规则，避免浮点累积漂移。

输入只表达操作意图，不携带 actor、位置、速度、命中、分数、Outcome 或目标 tick。服务器从连接推导 actor，具体输入效果由 exact Core 裁定。持续移动、按键边沿与输入过期时长属于游戏规则，不由 runtime 猜测。

### 多人参与者

Realtime manifest 的 `minPlayers/maxPlayers` 允许 2–8。runtime 按 manifest 分配 stable slots，由 finalized Setup 固定实际参与者与 playerOrder；V6 lifecycle/readiness 上限为 8。Pong、羽毛球的 manifest 仍限定双人。历史规则版本继续按各自 manifest 和 Core 重建。

RoomStore、archive 和 replay reader 同时校验参与者唯一性与 exact manifest 人数范围。扩展使用现有 JSONB/关联表，不把坦克颜色、地图或小局规则加入平台 schema。

### 同 tick 输入交付

`manifest.inputDelivery` 由 exact 游戏版本定义：

| 值              | 交给 `step` 的内容                                                          |
| --------------- | --------------------------------------------------------------------------- |
| 省略或 `latest` | 同 tick 每名玩家最后一个 accepted input；按 playerOrder 排列                |
| `events`        | 保留同 tick 全部 accepted inputs；先按 playerOrder 分组，同玩家保持接收顺序 |

canonical journal 保存规范化且 accepted 的事件。服务器、验证器和投影帧重建器使用相同策略；`latest` 的历史语义不变。`events` 使按次 FIRE 不会被同 tick 的移动输入覆盖，平台不需要识别具体 Action。

没有新输入时，Core 决定是否继续先前控制。Surface 应在释放、失焦、触控取消、断线或 dispose 时清理输入，并按游戏约定刷新持续控制；有输入租期的游戏还由 Core 在到期后归零。不能把某款游戏的有效期强加给历史规则。

## Realtime Protocol V1

平台 ticket、matchmaking、room lifecycle、Setup 和 reconnect 只接受 V6；实时 Input/Snapshot 使用独立 `realtimeProtocolVersion: 1`。平台 V5 退役不改变实时 envelope、tick/ack 或 replay 格式；历史 realtime metadata 的 V5 读取边界见 [网络协议](./NETWORK_PROTOCOL.md#32-共享-api-迁移与历史兼容)。

Colyseus realtime room 名称为 `realtime-game`；输入 channel 为 `realtime.input`，服务端实时消息 channel 为 `realtime`，平台消息仍按 [网络协议](./NETWORK_PROTOCOL.md) 分派。

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

完整 schema 与错误码见 [protocol](../packages/protocol/src/index.ts)。Input 必须 JSON-safe，序列化后最多 1 KiB，并通过游戏 `inputSchema`；runtime 还检查身份、active Round、单调 inputSequence、command 幂等和速率限制。拒绝命令不进入日志、不消费 gameplay RNG；scheduler 的正常 tick 推进独立于命令是否被拒绝。

`realtime.rejected` 含可选 commandId、稳定 code、retryable，以及可选 acknowledgement/snapshot。客户端以本 viewer 的确认序号和当前完整 snapshot 收敛，不提交或覆盖 server tick，不在重连后重放浏览器旧输入。

## 记录、存储与播放

实时记录使用独立 Realtime Replay Format V1，按服务端 tick 归档 accepted inputs，保存 exact game/version、tick rate、canonical Config、seed、有序 slots 与 finalTick。序列连续、tick 非递减，输入交付策略由 exact definition 决定，不能交给离散 Action reader 猜测。

数据库有实时专用 replay/event、room/player 和 Match/player 表及 adapters。room metadata 可持久化，但不保存可恢复的 simulation State；启动协调按单实例策略处理遗留 archive。

所有当前实时游戏及其支持历史版本都是 `record-only`。账户战绩和服务器验证继续可用，玩家播放在授权之后返回不支持；保留的通用投影帧重建能力不代表这些游戏提供播放入口。完整格式、失败语义和权限见 [Replay 设计](./REPLAY_DESIGN.md)。

## Surface 与版本维护

Phaser/SVG 只显示公开视图并采集 intent。插值仅改变视觉位置；新 Round、重连、阶段变化和终局按游戏约定直接收敛，不执行本地权威碰撞。尺寸、reduced-motion、音效解锁和触屏布局属于 Surface；协议、安全及 artifact 发布见 [Game Surface 规范](./GAME_SURFACE_SPEC.md)。

改变 simulation、Input schema、tick rate、单位、碰撞 tie-break、RNG 或 inputDelivery 解释时，评估新的 `gameVersion` 并保留旧 Core/golden。改变实时 wire 或 replay envelope 时分别评估对应协议/格式版本；仅修改表现层提升 `surfaceVersion`。

验证须覆盖纯 simulation、逐 tick determinism、exact golden、输入权限/顺序/幂等、reconnect、真实数据库重读和多人浏览器；具体命令与场景统一见 [TESTING.md](./TESTING.md)。
