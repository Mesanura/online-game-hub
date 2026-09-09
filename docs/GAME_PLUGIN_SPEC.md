# Game Plugin 规范

本文定义回合制 Core、游戏 Setup、序列化、注册与规则版本契约。平台依赖边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)，独立画面见 [GAME_SURFACE_SPEC.md](./GAME_SURFACE_SPEC.md)。

## 1. 适用范围

回合制 Game Plugin 面向“客户端提交离散 Action、服务器产生下一个 State”的游戏。当前以棋牌实现验证；卡牌和骰子可以使用同类接口，但不表示相关产品能力已经开放。

固定 tick 的实时游戏使用独立 [Realtime Runtime](./REALTIME_RUNTIME_DESIGN.md)，不把 realtime input、tick 或 snapshot 字段加入 `GameDefinition`、回合制 Host 或 Action envelope。Setup、显式注册与版本原则适用于两类游戏。

## 2. 设计原则

- Core 是纯 TypeScript 领域逻辑，不读取网络、数据库、系统时间或进程环境。
- 相同版本、输入和 RNG 状态必须产生相同输出。
- 平台验证“谁、在哪个房间、是否可行动”；Core 验证“该游戏动作是否合法”。
- 客户端只持有 View，不持有或提交 authoritative State。
- 正常的规则拒绝使用 tagged result，不抛异常。
- 所有跨边界数据必须是 JSON 可序列化数据。
- 一个游戏的 Core 不得依赖另一个游戏。

## 3. 基础类型

以下接口省略部分 readonly/泛型细节，完整 public API 由 [game-sdk](../packages/game-sdk/src/index.ts) 导出并由 contract tests 约束。

```ts
type GameId = string & Brand<"GameId">;
type GameVersion = string & Brand<"GameVersion">;
type PlayerSlotId = string & Brand<"PlayerSlotId">;
type GameRuleErrorCode = string;

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Viewer = { kind: "player"; slotId: PlayerSlotId } | { kind: "spectator" };

interface GameManifest {
  id: GameId;
  gameVersion: GameVersion;
  title: string;
  description: string;
  defaultConfig: JsonValue;
  minPlayers: number;
  maxPlayers: number;
  runtime: "turn-based";
  capabilities: {
    hiddenInformation: boolean;
    deterministicRandomness: boolean;
    replay: "none" | "record-only" | "player-playback";
    playerAssignment?: {
      kind: "camp" | "seat";
      options: readonly string[];
    };
  };
}
```

约束：

- `GameId` 使用稳定的 lowercase kebab-case，例如 `tic-tac-toe`；它同时用于包名、URL、wire 和 replay，不因展示名翻译而修改。
- `GameVersion` 使用精确 semver 字符串；registry 和 replay 不使用范围匹配。
- `title` 是面向玩家的简体中文正式展示名；新游戏加入 registry 前必须由产品确认译名，manifest 与中文文档统一使用该名称。
- `description` 使用面向玩家的简体中文，不暴露内部架构或协议术语。
- `defaultConfig` 是通用 Web 创建房间时使用的 JSON-safe 默认 Config，必须已是对应 `configSchema` 接受且不会进一步规范化为不同值的 canonical 数据；它不替代服务端 schema 校验，也不限制其他合法 Config。
- `capabilities.replay` 对 exact `gameVersion` 必填。`record-only` 保存并验证 canonical journal，但不提供玩家回放；`player-playback` 额外提供 Replay Surface；`none` 已保留类型，但当前 runtime 拒绝注册/启动。完整语义见 [Replay 设计](./REPLAY_DESIGN.md)。
- 技术标识、代码符号和必要的英文诊断可以保留英文；不得把英文技术标识当作玩家展示名。
- `PlayerSlotId` 表示比赛中的稳定席位，不是账号、session、connection 或数据库 ID。
- `game-sdk` 使用 `defineGameId`、`defineGameVersion` 和 `definePlayerSlotId` 构造上述 branded string；brand 只存在于类型系统，wire/replay 中仍是普通字符串。
- `State`、`Action`、`View`、`Outcome` 和 `Config` 必须符合 `JsonValue` 语义。
- 禁止 `Date`、`Map`、`Set`、`BigInt`、class instance、function、`undefined`、`NaN` 和 `Infinity`。

## 4. Deterministic RNG

随机游戏不得调用 `Math.random()`、系统时间或第三方全局随机源。Game Server 使用安全随机源为比赛生成 seed；`game-sdk` 提供版本化的纯 RNG helpers。

```ts
interface RngState {
  algorithm: string;
  seed: string;
  cursor: number;
}

interface RandomStep<T> {
  value: T;
  next: RngState;
}

declare function nextInt(
  rng: Readonly<RngState>,
  maxExclusive: number,
): RandomStep<number>;
```

RNG helper 不修改传入对象。Core 必须显式使用返回的 `next`。Runtime 在 accepted transition 时提交新的 `RngState`，在 rejected transition 时丢弃所有候选随机结果并保留原 cursor。

V1 的 `algorithm` 固定为 `fnv1a32-counter-v1`：以 JavaScript UTF-16 code unit 的低字节、高字节顺序对 `seed + NUL + decimal cursor` 执行 32-bit FNV-1a 与固定 avalanche，并用 rejection sampling 生成无 modulo bias 的整数。每次 candidate 消费一个 cursor，`nextInt` 可能为了 rejection 消费多个 cursor。`algorithm` 是 replay 兼容契约的一部分；改变算法、随机消费顺序或 seed 解释方式属于可能破坏 replay 的规则变更，并需要评估新的 `gameVersion`。

固定向量：seed `m2-seed` 从 cursor `0` 连续执行 `nextInt(rng, 10)` 得到 `[1, 5, 9, 7, 6, 1, 7, 0]`，最终 cursor 为 `8`。

V1 保证服务器控制随机性和确定性重建，不实现 commit-reveal 或密码学可验证公平协议。

## 5. Game Definition

```ts
import type { ZodType } from "zod";

interface InitialContext<Config> {
  config: Readonly<Config>;
  players: readonly PlayerSlotId[];
  playerAssignments?: readonly string[];
  rng: Readonly<RngState>;
}

interface Initialized<State> {
  state: State;
  rng: RngState;
}

interface TransitionContext<State, Action> {
  state: Readonly<State>;
  actorSlotId: PlayerSlotId;
  action: Readonly<Action>;
  rng: Readonly<RngState>;
}

type Transition<State> =
  | { status: "accepted"; state: State; rng: RngState }
  | { status: "rejected"; code: GameRuleErrorCode };

interface ViewContext<State> {
  state: Readonly<State>;
  viewer: Viewer;
}

interface GameDefinition<Config, State, Action, View, Outcome> {
  manifest: GameManifest;
  configSchema: ZodType<Config>;
  actionSchema: ZodType<Action>;
  createInitialState(context: InitialContext<Config>): Initialized<State>;
  transition(context: TransitionContext<State, Action>): Transition<State>;
  projectView(context: ViewContext<State>): View;
  getOutcome(state: Readonly<State>): Outcome | null;
}
```

该接口的泛型在单个游戏 package 内保持完整类型安全。异构 registry 在运行时以 `GameId + GameVersion` 查找 definition，先通过对应 Zod schema 将 `unknown` 解析为该游戏的类型，再进入泛型 Core。

`game-sdk` 的 `eraseGameDefinition` 只供 registry/runtime 将已类型检查的具体 definition 转为 `UnknownGameDefinition`；类型擦除不得绕过该 definition 自身的 Config/Action schema，游戏内部与直接消费者继续使用完整泛型类型。

### 5.1 `createInitialState`

- 输入已规范化的 Config、本轮按 `playerOrder` 固定排列的 slots 和初始 RNG 状态。需要固定位置/营地的游戏可通过可选 `playerAssignments` 接收与 slots 等长的元数据；Platform 可以在同一 live room 的不同 Round 传入不同顺序，但单轮 Core 初始化、State 与 Replay header 必须使用完全相同的顺序；Game 不读取房主身份或待开局设置。
- 必须返回新 State 和消费后的 RNG 状态。
- 不读取账号资料、显示名称、连接信息或系统时间。
- 同一输入必须产生深度相等的 State 和 RNG 状态。

### 5.2 `transition`

- 同时判断游戏规则合法性并产生新 State，避免 `validateAction` 与 `applyAction` 逻辑漂移。
- 不修改输入 State、Action 或 RNG 对象。
- accepted result 必须包含完整的新 State 和最终 RNG 状态。
- rejected result 不携带候选 State；runtime 保持 State、revision 和 RNG 不变。
- 程序不变量被破坏可以抛异常，并由 server 记录为内部故障；用户的非法操作不得抛异常。

### 5.3 `getOutcome`

- 活跃比赛返回 `null`。
- 终局返回 JSON 可序列化 Outcome，仅引用 slot，不引用账号或连接。
- 终局 State 不得再接受改变比赛结果的 Action。

### 5.4 `projectView`

- 是 authoritative State 离开服务器前的唯一游戏级投影入口。
- 公开棋盘游戏可让所有 viewer 得到相同内容，但仍必须经过该函数。
- 隐藏信息游戏按 `PlayerSlotId` 隐藏其他玩家手牌、秘密目标或未公开随机结果。
- spectator 是预留 viewer 类型，不表示 V1 已开放观战连接。
- 返回值不得包含服务端秘密、连接 token、内部审计信息或完整 RNG seed。

## 6. 错误模型

`GameRuleErrorCode` 是稳定、机器可读的游戏领域代码，例如：

```ts
type TicTacToeRuleErrorCode =
  "NOT_YOUR_TURN" | "CELL_OCCUPIED" | "MATCH_ALREADY_FINISHED";
```

- Game Plugin 只返回领域错误，不返回 HTTP、WebSocket 或 Colyseus 错误。
- 平台错误和 wire error envelope 由 [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md) 定义。
- 服务端不得依赖人类可读 message 做分支；本地化文案属于客户端展示层。
- 规则错误码改变语义时应视为 public API 变更。

## 7. Action 设计

Action 表示 intent，而不是结果或 State patch。

正确示例：

```ts
type Action = { type: "PLACE_MARK"; cell: number };
```

错误示例：

```ts
type Action = {
  type: "SET_BOARD";
  board: string[];
  winner: string;
};
```

规则：

- 使用 discriminated union 和稳定的 `type`。
- 只包含完成意图所需的最小数据。
- 不包含 actor；actor 由服务器连接映射。
- 骰子 Action 表达 `ROLL`，不携带客户端生成的点数。
- schema 应拒绝未知或越界字段，并将合法输入规范化后再写入 replay。

## 8. 客户端边界

游戏表现使用 [独立 Surface](./GAME_SURFACE_SPEC.md)，严格解析公开 View 并通过 Bridge 提交最小 intent。旧 Client Module、React 组件契约、类型擦除 helper 与 registry loader 已移除，游戏包不再公开 `/client`。

两类连接 SDK 继续提供 Host、连接状态、ticket、重连、房间资料同步与实时插值。Web Host 添加 commandId、revision 或 input sequence 等 transport 元数据；Surface 不导入这些 SDK，不提交 actor、State 或 Outcome。SDK 不要求 React peer dependency。

客户端的合法操作提示不构成权威判断；服务器 Core 始终重新验证 Action/Input。投降支持由 exact deployment 的 `platformControls` 与 Surface schema 决定，不能让旧 Core 接受新 Action。

删除旧渲染路径不等于退役 Protocol V5。仍登记 V5 的历史版本继续使用原有 envelope、房间生命周期和重连契约，历史 Core、golden 与 exact replay 读取继续保留。

## 9. Round Setup Definition

游戏可用 `@online-game-hub/game-setup` 声明纯 TypeScript `RoundSetupDefinition<Config, State, Action, View>`。Setup 与 Gameplay Core 一样必须 deterministic、immutable、JSON-serializable，不能依赖 React、DOM、网络、数据库、系统时间或环境 I/O。它接收平台提供的 stable slot facts 与服务端推导的 actor slot，负责规则设置、参与者选择、顺序、阵营和最终配置；不能处理 session、socket、ready、重连或关闭房间。

`FinalizedRoundSetup` 包含 canonical `config`、`participantSlotIds`、实际 `playerOrder` 与逐参与者 assignment。Platform 只验证参与者来自 occupied slots、人数在 manifest 范围、顺序为严格排列、assignment 键集合完整。游戏若需要随机 setup，必须只通过传入的独立 setup RNG，并返回推进后的 RNG；持久化重试复用已固化结果。Gameplay `createInitialState` 只接收 finalize 后的 config、playerOrder、assignment 与新的 gameplay RNG。

首轮 `initialize` 使用 `{ kind: "defaults", config: manifest.defaultConfig }`；重新对局使用 `{ kind: "previous-round", setup }`，完整复用上一局最终设置。平台不会默认生成先手 UI，也不把具体规则字段解释为通用控件。

## 10. Game Surface Artifact

新表现层位于独立 `game-surfaces/<game-id>` workspace，只通过 Bridge 接收 projected View 并提交 intent。Setup 与 Play entrypoint 必填，`player-playback` 另需 Replay entrypoint；当前所有支持版本均按 exact deployment 解析为 Surface，Web 不提供 legacy 渲染 fallback。

Artifact schema、摘要锁、Bridge V1/V2、平台投降、终局摘要、安全限制、Workbench 与发布步骤统一由 [Game Surface 规范](./GAME_SURFACE_SPEC.md) 定义。游戏负责人必须同步规则版本支持范围与 deployment 能力，不能仅靠 UI 禁用放宽旧 Core 或隐藏服务端权限。

## 11. Manifest 与 Export Map

`src/manifest.ts` 是单一 manifest 来源，必须无副作用且不导入 client 或 server runtime。避免同时维护 `game.json` 与 TypeScript manifest 造成重复。

新游戏 package 公开且仅公开必要子路径，以下源码路径仅为示意：

```json
{
  "exports": {
    "./manifest": "./src/manifest.ts",
    "./core": "./src/core/index.ts",
    "./setup": "./src/setup/index.ts"
  }
}
```

实际 export map 使用各包构建后的 dist 路径，只公开仍被消费的 manifest/Core/Setup 入口。Web 页面不得通过 registry server entry 导入 Core，Surface 不导入任何游戏 package。

## 12. Versioning

以下变化必须评估并通常提升 `gameVersion`：

- State transition、胜负或计分规则变化；
- Config 或 Action schema 的不兼容变化；
- 初始 State 或玩家 slot 解释变化；
- RNG 算法、seed 处理或消费顺序变化；
- 会改变旧 action log 重建结果的 bug fix。

只改变表现层 CSS、动画或文案，不需要提升 `gameVersion`，但产物变化须提升 `surfaceVersion` 并更新 artifact digest。纯文档修改或不改变重建结果的 Core 等价优化不因此要求提升 Surface 版本。

五种版本互不替代：`gameVersion` 固定规则与 replay 重建；`surfaceVersion` 固定静态表现 artifact；`bridgeVersion` 固定 iframe 消息协议；`protocolVersion` 固定 Web/Game Server envelope；`replayFormatVersion` 固定 canonical record envelope。一次变更只提升实际被破坏的边界。

Registry 必须能够按 exact `gameVersion` 读取旧 replay 所需的 definition。“current”先由 catalog manifest 选定版本，再走同一 exact resolver；不得依赖 definition 登记顺序。旧实现可以在迁移为稳定归档后退役，具体策略见 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md)。

## 13. Plugin Definition of Done

一个游戏只有满足以下条件才可加入 registry：

- manifest（含显式 replay mode）、Core、Setup definition、Surface artifact、`GAME_SPEC.md` 和局部 `AGENTS.md` 完整；
- Core 没有禁止依赖和非确定性 API；
- Config/Action schema 能拒绝不可信输入；
- 合法、非法、终局、不变性和 replay determinism 测试通过；
- `projectView` 的信息泄漏测试通过；
- package 只通过声明的 public subpath exports 被消费；
- Surface 可在不启动 Next 或 Game Server 时独立构建、运行 fixture、完成 contract test，并通过 artifact digest、Bridge 与 iframe 安全检查。

接入还须验证 registry、权威 integration、真实数据库和浏览器链路，完整矩阵见 [TESTING.md](./TESTING.md)。现有 [脚手架](../tools/README.md) 尚未覆盖全部要求，其输出不等于完成接入。
