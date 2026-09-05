# Game Plugin 规范

> 状态：V1 权威 Core + Game-defined Setup + 独立 Surface 迁移规范；M8 realtime simulation 保持独立
> 本文是游戏 Core、Setup、Surface、序列化与版本契约的权威来源。平台依赖边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. 适用范围

V1 Game Plugin 面向棋盘、卡牌和骰子等“客户端提交离散 Action、服务器产生下一个 State”的游戏。井字棋是首个规范验证实现。

Phaser 实时 2D 游戏通常需要 tick、输入缓冲、插值、预测或回滚，不强行复用本规范。M8 已确认使用独立 realtime runtime，具体 API、输入、快照、replay 与 Phaser 边界以 [REALTIME_RUNTIME_DESIGN.md](./REALTIME_RUNTIME_DESIGN.md) 为准。它仍复用平台目录、身份、房间和比赛生命周期，但不得把 realtime input、tick 或 snapshot 字段加入本规范的 `GameDefinition`、`GameClientModule` 或 turn-based Action envelope。

## 2. 设计原则

- Core 是纯 TypeScript 领域逻辑，不读取网络、数据库、系统时间或进程环境。
- 相同版本、输入和 RNG 状态必须产生相同输出。
- 平台验证“谁、在哪个房间、是否可行动”；Core 验证“该游戏动作是否合法”。
- 客户端只持有 View，不持有或提交 authoritative State。
- 正常的规则拒绝使用 tagged result，不抛异常。
- 所有跨边界数据必须是 JSON 可序列化数据。
- 一个游戏的 Core 不得依赖另一个游戏。

## 3. 基础类型

以下接口用于说明 V1 public API；实现时由 `game-sdk` 导出等价的 strict TypeScript 类型。

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
- `capabilities.replay` 对 exact `gameVersion` 必填。`record-only` 保存并验证 canonical journal，但不提供玩家回放；`player-playback` 额外提供 Replay Surface；`none` 已保留类型，但在首轮 runtime 中稳定拒绝注册/启动。
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

## 8. Legacy Client Module

游戏 Client Module 是保留的兼容 API 与组件测试路径，可以依赖 React 和 `game-client-sdk`，但不得导入服务端 State 或自行实现 authoritative 规则。当前 Web 的 live room 与 replay 均不再加载 Client Module；新游戏使用下一节的独立 Surface，不再新增 Client Module。

概念契约：

```ts
interface GameClientProps<View, Action> {
  view: Readonly<View>;
  revision: number;
  connectionState:
    "idle" | "loading" | "connecting" | "connected" | "reconnecting" | "closed";
  submitAction(action: Action): Promise<void>;
}

interface GameClientModule<View, Action> {
  gameId: GameId;
  gameVersion: GameVersion;
  parseView(input: unknown): View;
  createResignAction?: () => Action;
  Component: React.ComponentType<GameClientProps<View, Action>>;
}
```

该兼容 contract 中，通用 host 负责添加 `commandId` 和 `expectedRevision`、管理连接和处理重连；具体游戏组件只渲染 View、采集意图并调用 `submitAction`。可选 `createResignAction` 必须返回 exact gameVersion 的最小投降 Action，但现在只用于 API/组件兼容测试，平台 HUD 不再读取该 factory。

客户端可以重复实现提示性逻辑以改善 UX，但提示不是权威；服务器 Core 始终重新验证 Action。

井字棋、四子棋、五子棋与黑白棋 current `1.1.0` 的兼容 module 仍暴露 `createResignAction`；各自 frozen `1.0.0` definition 继续只解析原落子 Action。六贯棋与中国跳棋的兼容 module 也保持各自既有契约。任何 client factory 都不属于 replay 或 wire envelope，不能让旧 Core 接受新 Action；Surface 是否支持平台投降只由 exact deployment 的 `platformControls` 与 Surface schema 决定。

## 9. Round Setup Definition

游戏可用 `@online-game-hub/game-setup` 声明纯 TypeScript `RoundSetupDefinition<Config, State, Action, View>`。Setup 与 Gameplay Core 一样必须 deterministic、immutable、JSON-serializable，不能依赖 React、DOM、网络、数据库、系统时间或环境 I/O。它接收平台提供的 stable slot facts 与服务端推导的 actor slot，负责规则设置、参与者选择、顺序、阵营和最终配置；不能处理 session、socket、ready、重连或关闭房间。

`FinalizedRoundSetup` 包含 canonical `config`、`participantSlotIds`、实际 `playerOrder` 与逐参与者 assignment。Platform 只验证参与者来自 occupied slots、人数在 manifest 范围、顺序为严格排列、assignment 键集合完整。游戏若需要随机 setup，必须只通过传入的独立 setup RNG，并返回推进后的 RNG；持久化重试复用已固化结果。Gameplay `createInitialState` 只接收 finalize 后的 config、playerOrder、assignment 与新的 gameplay RNG。

首轮 `initialize` 使用 `{ kind: "defaults", config: manifest.defaultConfig }`；重新对局使用 `{ kind: "previous-round", setup }`，完整复用上一局最终设置。平台不会默认生成先手 UI，也不把具体规则字段解释为通用控件。

## 10. Game Surface Artifact

新表现层位于独立 `game-surfaces/<game-id>` workspace，可自行选择 React、Vue、Svelte、Phaser、Canvas、WebGL、WASM 或其他浏览器技术；契约不是 React component。每个 Surface 独立提供 dev/build/test/contract-test，并输出通过 `SurfaceArtifactManifestV1` 校验的静态 artifact：Setup 与 Play entrypoint 必填，Replay entrypoint 只在 `player-playback` 时需要。

发布型 Surface 在 package manifest 中声明 `onlineGameHub.surfaceArtifact: true`，提交 `surface.config.json` 与 `surface.lock.json`，并把 `surface.manifest.json`、`setup/`、`play/`、可选 `replay/` 输出到 `dist`。仓库级 artifact CLI 负责 build 收尾和显式锁更新，不能成为 Surface 的 workspace 依赖。普通 build 不改锁，只有先提升 `surfaceVersion` 后才能显式更新内容摘要。`pnpm surface:verify` 检查 schema、gameId、mode 目录、entrypoint、锁和 canonical digest；`pnpm surface:publish` 只把校验通过的内容幂等复制到 Web 静态目录，并拒绝同一 `surfaceVersion` 的内容漂移。Workbench 等不发布 artifact 的 workspace 必须显式声明 `false`，不能靠缺失 manifest 被静默跳过。

Surface 只实现 `@online-game-hub/game-surface-bridge` 的 JSON 消息协议。它解析 projected payload、渲染全部游戏专属信息并发送最小 intent；不得读取 Core、ticket、session、actor、raw State、RNG、canonical replay 或 WebSocket。平台 HUD 不解释比分、棋子、阵营、当前回合、排名或 Outcome。需要由平台统一呈现的控制必须在 exact deployment 的 `platformControls` 显式声明；未声明时平台不得猜测游戏能力。

JavaScript Surface 可选用 `GameSurfaceBridge` helper：实例只接受指定 parent window/origin 的一次 `host.hello`，随后只通过移交的 `MessagePort` 收发 strict message，并在 timeout、非法消息或 dispose 后关闭。平台侧 `SurfaceBridgeHost` 在 ready 前拒绝发消息，负责 timeout/crash/retry 与重复 `clientIntentId` 抑制。两者都是 transport helper，不解释游戏 intent，也不补写 command ID、actor、round、revision 或 input sequence；这些仍只属于平台 Host SDK。Bridge V1 的 `host.command/RESIGN` 只是无游戏 payload 的 UX 触发：Surface 必须按 exact `gameVersion` 决定是否生成自己的 `RESIGN` Action/Input，并以命令携带的 `clientIntentId` 发送普通 `surface.intent`。历史 Core 不支持投降时，deployment 不得声明该控制。

Web 按 deployment registry 的 exact game/version/mode 解析静态 entrypoint，不导入 Surface workspace。`GameSurfaceFrame` 负责 opaque sandbox、握手状态、projected state、viewport/fullscreen、intent result、平台命令和 dispose；游戏只需在自己的 artifact 中实现 Bridge。当前全部受支持版本都必须解析到 `surface-v1`，Web 不提供 `legacy-react` 渲染 fallback；Surface 回滚通过切换 immutable `surfaceVersion` 引用完成，不改变已存在房间的 Core 或协议代际。

## 11. Manifest 与 Export Map

`src/manifest.ts` 是单一 manifest 来源，必须无副作用且不导入 client 或 server runtime。避免同时维护 `game.json` 与 TypeScript manifest 造成重复。

每个游戏 package 公开且仅公开必要子路径：

```json
{
  "exports": {
    "./manifest": "./src/manifest.ts",
    "./core": "./src/core/index.ts",
    "./client": "./src/client/index.ts"
  }
}
```

实际构建阶段可以将源码路径替换为 dist 路径，但子路径边界保持不变。Web 不得通过 registry server entry 导入 Core，Game Server 不得导入 `/client`。

## 12. Versioning

以下变化必须评估并通常提升 `gameVersion`：

- State transition、胜负或计分规则变化；
- Config 或 Action schema 的不兼容变化；
- 初始 State 或玩家 slot 解释变化；
- RNG 算法、seed 处理或消费顺序变化；
- 会改变旧 action log 重建结果的 bug fix。

只改变 CSS、动画、无语义文案或等价性能优化，不需要提升 `gameVersion`，而是提升独立 `surfaceVersion` 并更新 artifact digest。

五种版本互不替代：`gameVersion` 固定规则与 replay 重建；`surfaceVersion` 固定静态表现 artifact；`bridgeVersion` 固定 iframe 消息协议；`protocolVersion` 固定 Web/Game Server envelope；`replayFormatVersion` 固定 canonical record envelope。一次变更只提升实际被破坏的边界。

Registry 必须能够按 exact `gameVersion` 读取旧 replay 所需的 definition。“current”先由 catalog manifest 选定版本，再走同一 exact resolver；不得依赖 definition 登记顺序。旧实现可以在迁移为稳定归档后退役，具体策略见 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md)。

## 13. Plugin Definition of Done

一个游戏只有满足以下条件才可加入 registry：

- manifest（含显式 replay mode）、Core、Setup definition、Surface artifact、`GAME_SPEC.md` 和局部 `AGENTS.md` 完整；
- Core 没有禁止依赖和非确定性 API；
- Config/Action schema 能拒绝不可信输入；
- 合法、非法、终局、不变性和 replay determinism 测试通过；
- `projectView` 的信息泄漏测试通过；
- package 只通过声明的 public subpath exports 被消费。
- Surface 可在不启动 Next 或 Game Server 时独立构建、运行 fixture、完成 contract test，并通过 artifact digest、Bridge 与 iframe 安全检查。

M6 当时由五子棋证明非 `null` Config 可直接通过既有 create/runtime/replay 契约；为让通用 Web 无游戏分支地取得创建默认值，`GameManifest` 新增必填 `defaultConfig`，并同步迁移所有游戏与消费者。额外六贯棋证明 strict Action union 可同时承载落子与投降、Outcome 可保存变长 canonical path。黑白棋进一步证明一次 transition 可表达多方向翻转、无合法行动、同 slot 续行和非满盘终局；当时无需修改 `GameDefinition`、`GameClientModule`、Protocol V1 或 replay envelope。

当前规则增强仅为跨五游戏共用 HUD 的真实需求给 `GameClientModule` 增加可选 `createResignAction`，typed/erased contract 同步且旧模块仍兼容。井字棋、四子棋、五子棋与黑白棋以 `1.1.0` 承载新 Action/State/Outcome schema，独立 frozen `1.0.0` 保留；六贯棋保持 `1.0.0`。后续 Protocol V3 只扩展房间控制，不改变任何游戏 Core、Replay Format V1 或数据库 schema。

完整测试矩阵见 [TESTING.md](./TESTING.md)。
