# 网络协议

> 状态：Protocol V2（逐局先手与统一 Round 准备）
> 本文是 Web、Game Server 与浏览器之间身份、房间、消息、revision 和重连语义的权威来源。游戏规则 payload 见 [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)。

## 1. 协议目标

- 客户端只提交 Action intent，不能提交 actor 或 authoritative State。
- 所有不可信消息在使用前经过 Zod runtime validation。
- 每个 accepted Action 有唯一顺序和 revision。
- 丢包、重复发送、页面刷新和短暂断线后可通过完整 snapshot 收敛。
- 隐藏信息游戏可以为每个连接发送不同 View。
- transport 和游戏规则解耦；Core 不知道 Colyseus 或 WebSocket。

## 2. 传输边界

| 流程                                      | Transport                  | Owner       |
| ----------------------------------------- | -------------------------- | ----------- |
| 页面、游戏目录、匿名 session              | HTTPS                      | Next.js Web |
| 短期 Game Server ticket                   | HTTPS                      | Next.js Web |
| 创建/加入房间、seat reservation           | Colyseus matchmaking HTTPS | Game Server |
| 对局 Action、snapshot、房间控制/lifecycle | WebSocket                  | Game Server |

浏览器直接连接 Game Server。Next.js 不代理 WebSocket，也不保存 authoritative match State。

## 3. 协议版本

所有 application-level envelope 携带整数 `protocolVersion`。V2 值为 `2`；V1 request、ticket 或 message 由 exact schema 拒绝，不在同一 server 内做兼容猜测。

- 版本表示 wire envelope 兼容性，不等同于 `gameVersion` 或 `replayFormatVersion`。
- Game Server 在连接或首条消息阶段拒绝不支持的版本。
- 向后兼容的字段只能以可选字段增加；删除、改名或改变语义需要新 protocol version。

## 4. 匿名身份与连接票据

### 4.1 Guest Session

Next Proxy 在首次页面请求验证或建立匿名 guest session。平台生成 `guest_<uuid>` 形式的 `PlayerSessionId`，再把 `{ version: 1, playerSessionId, issuedAt }` 作为 HMAC-SHA256 签名 token 放入 `ogh_guest` cookie；cookie token 不是玩家可提交的公开 ID。无效、篡改、未来签发或满 7 天的 token 会被替换为新 session。

Cookie 固定为 `HttpOnly`、`SameSite=Lax`、`Path=/`、`Max-Age=604800`；生产环境强制 `Secure`，development/test 的本地 loopback HTTP 可明确配置 `Secure=false`。guest session secret 至少 32 UTF-8 bytes，只存在于 Web server runtime；cookie 值、secret 和解析出的 `PlayerSessionId` 不进入客户端 JavaScript、日志或错误响应。

M5 仍不实现登录、OAuth、密码或数据库 session。服务器端可以把经可信未来认证边界提供的 UserId 与 guest session 事务化关联：同一 guest→同一 User 重试幂等，关联到不同 User 会冲突失败；没有任何允许浏览器提交 UserId 的 claim API。当前 guest cookie 不加入 UserId，房间和 Game Core 继续只依赖平台 session/slot 抽象。

### 4.2 Game Server Ticket

浏览器在创建或加入房间前，从 Next.js 获取短期签名 ticket。概念 claims：

```ts
interface GameServerTicketClaims {
  issuer: string;
  audience: "game-server";
  playerSessionId: string;
  issuedAt: number;
  expiresAt: number;
  ticketId: string;
  protocolVersion: 2;
}
```

- `@online-game-hub/game-server-ticket` 使用两个 canonical base64url segments（JSON claims 与 HMAC-SHA256 signature），secret 至少 32 UTF-8 bytes。默认 lifetime 为 30 秒，可配置范围为 1–300 秒。
- Issuer 生成服务器控制的 `ticketId`、`issuedAt`、`expiresAt`、audience 和 `protocolVersion`；浏览器只取得完整 bearer ticket，不能选择 `PlayerSessionId` 或修改 claims。
- Verifier 在建立身份前以 timing-safe comparison 验证 signature，并严格验证 Protocol V2 claims schema、配置的 issuer、固定 audience、`issuedAt <= now` 和 `expiresAt > now`。缺失、超大、非 canonical、篡改、过期、未来签发或版本错误 ticket 都被拒绝。
- Web 与 Game Server 通过环境注入完全一致的 issuer/ticket secret；guest session secret 必须独立。生产 `apps/game-server` adapter 不导入 testing subpath，`TestTicketAuthority` 只供 contract/integration tests。
- Ticket 可以短暂存在于 `GameClientHost` 的调用栈以完成 Colyseus reservation，但不得持久化到 URL、local/session storage、UI、日志或错误响应；secret 永远不进入客户端 bundle。
- M4 不实现 key management 或 rotation infrastructure；变更共享 secret 需要协调两个进程重启。

### 4.3 HTTP Ticket API

`POST /api/game-ticket` 使用 same-origin guest cookie，无 request body。成功响应为：

```json
{ "ticket": "<short-lived bearer ticket>" }
```

成功响应为 `200`，配置或签发失败只返回 `503 { "code": "TICKET_UNAVAILABLE" }`；两者都设置 `Cache-Control: no-store, private`。route 只从 HttpOnly cookie 解析 session，不接受浏览器提交的 `PlayerSessionId`，且不在响应或错误中返回 cookie/secret。

### 4.4 Private Match History API

`GET /api/matches` 是 Web same-origin、当前 guest 私有的平台 metadata 查询，不是 Protocol V2 WebSocket envelope，也不改变 `protocolVersion`。route 只接受经当前部署 secret 验证的 `ogh_guest` cookie；缺失/无效 session 返回 `401 { "code": "GUEST_SESSION_REQUIRED" }`，数据库或配置失败返回 `503 { "code": "MATCH_HISTORY_UNAVAILABLE" }`。成功为：

```ts
interface MatchHistoryResponse {
  matches: readonly {
    matchId: string;
    roundNumber: number;
    gameId: string;
    gameVersion: string;
    status: "waiting" | "active" | "completed" | "abandoned";
    finalRevision: number;
    playerSlotId: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    replayAvailable: boolean;
  }[];
}
```

结果最多 50 条并稳定排序；response 设置 `Cache-Control: no-store, private` 与 `Vary: Cookie`。query/body 中的 `PlayerSessionId`、`UserId`、slot 或 room ID 一律不作为授权输入。其他 guest 即使猜到 match ID，也只能得到自己的列表，不泄漏参与关系。API 不返回 canonical replay、Config、Action、Outcome、RNG seed、authoritative State、其他参与者 identity、database row ID 或 credential。

## 5. 房间标识与流程

内部 `roomId` 属于 Game Server。外部用户只使用不可预测、大小写规范化的临时 `roomCode`；邀请 URL 携带 `gameId` 与 `roomCode`，不携带 ticket。

### 5.1 创建房间

V2 matchmaking options 使用以下 strict request；客户端不能选择 `gameVersion`、slot 或内部 `roomId`：

```ts
interface CreateGameRoomRequest {
  type: "room.create";
  protocolVersion: 2;
  ticket: string;
  gameId: string;
  initialConfig: unknown;
}
```

1. Web 从 catalog manifest 取得已由对应 `configSchema` contract 覆盖的 `defaultConfig`，确保 guest session 存在并获取 ticket；未来配置 UI 仍只能提交该游戏 schema 接受的 JSON Config。
2. 客户端向名为 `game` 的 Colyseus room 提交 request；通用 schema 先要求 `initialConfig` 是 JSON value，具体游戏的 `configSchema` 再解析并规范化。
3. Server 从 registry 选择当前可创建的 exact `gameVersion`。
4. Server 生成不可预测的规范化 `roomCode`，预分配 stable slots，校验 Config 并创建 live room；`currentRound = null`，此时不初始化 Core，不创建 replay/Match，也不进入 history。
5. Colyseus matchmaking 返回 seat reservation；客户端建立 WebSocket 后通过 `room.connected` 获得公共房间信息。Web 组合 `/games/<gameId>?roomCode=<roomCode>` 邀请 URL；URL 只以 path 表达 `gameId`、以 query 表达 `roomCode`，不包含 ticket、cookie、session、reservation secret 或内部 `roomId`。

### 5.2 加入房间

```ts
interface JoinGameRoomRequest {
  type: "room.join";
  protocolVersion: 2;
  ticket: string;
  roomCode: string;
}
```

1. 客户端提交规范化后的 `roomCode` 和有效 ticket。
2. Server 检查房间存在、版本可用、席位未满且 session 未被禁止加入；completed live room 只允许原 slot session 重连，新访客返回 `ROOM_NOT_JOINABLE`。
3. Server 分配稳定 `PlayerSlotId` 并返回 seat reservation。
4. 连接建立后发送 `room.connected` 与当前 `room.lifecycle`；只有已经存在 active/completed Round 时才发送完整 snapshot。首局设置阶段允许连接成功但没有 snapshot。

客户端不得选择 `PlayerSlotId`、伪造其他玩家身份或要求加入内部 `roomId`。

V2 room code 是去掉首尾空白后转为大写的 8 位 `[A-HJ-NP-Z2-9]` 字符串。Colyseus 会在 room 的 Zod transform 之前使用原始 matchmaking options 执行 `roomCode` filter，因此调用 SDK `join` 前必须已经把 code 规范化为大写；不能依赖 room 内部 transform 修正 filter 输入。

### 5.3 连接确认

WebSocket join 成功后，Server 先在 `protocol` message channel 发送：

```ts
interface RoomConnected {
  type: "room.connected";
  protocolVersion: 2;
  roomCode: string;
  gameId: string;
  gameVersion: string;
  playerSlotId: string;
}
```

该消息不暴露内部 `roomId`、session、ticket、replay id 或 seed。随后始终发送 viewer-specific lifecycle；仅在 `currentRound !== null` 时发送该玩家的完整 `match.snapshot`。

## 6. Match Lifecycle

平台层状态为：

```ts
type MatchStatus = "waiting" | "active" | "completed" | "abandoned";
```

- `waiting`：只为旧 PostgreSQL rows/history schema 兼容保留；Protocol V2 live `currentRound` 不使用该状态。
- `active`：比赛已开始，可以按平台和游戏规则处理 Action。
- `completed`：Core 返回 Outcome；不再接受改变结果的 Action。
- `abandoned`：已经 active 的 Round 因离开、断线超时或管理原因终止，可能没有游戏 Outcome。首局尚未开始的 room 关闭时不创建 abandoned Match。

状态转换由 Game Server 管理。Game Core 只决定游戏 Outcome，不决定网络断开、房间销毁或 session 权限。

### 6.1 Live Room、轮次与控制

一个 live room 可以顺序承载多轮，但每轮都由 `roundNumber = 1, 2, ...` 标识，并拥有独立 `playerOrder`、Match、RNG、revision 序列和 canonical replay。room code、Config 和 stable slots 不变；`playerOrder` 由房主逐局选择，可在 `[ownerSlot, nonOwnerSlot]` 与反向顺序间变化。Core 初始化与 replay header 必须使用完全相同的顺序，新轮 revision 从 `0` 开始。

首局与 completed 后续局都进入统一的 `nextRound` setup。V2 使用独立 Colyseus custom message type `room.control`，命令是严格 discriminated union：

```ts
type StarterChoice = "OWNER" | "NON_OWNER";

type RoomControlCommand =
  | {
      type: "room.control";
      protocolVersion: 2;
      commandId: string;
      operation: "SELECT_STARTER";
      starter: StarterChoice;
    }
  | {
      type: "room.control";
      protocolVersion: 2;
      commandId: string;
      operation: "READY_FOR_ROUND" | "CANCEL_ROUND_READY" | "CLOSE_ROOM";
    };
```

Server 在同一 `room.control` channel 按 viewer 返回：

```ts
interface RoomLifecycleState {
  type: "room.lifecycle";
  protocolVersion: 2;
  isOwner: boolean;
  currentRound: {
    roundNumber: number;
    status: "active" | "completed" | "abandoned";
  } | null;
  nextRound: {
    roundNumber: number;
    starter: StarterChoice | null;
    selfReady: boolean;
    readyPlayerCount: number;
    requiredPlayerCount: number;
  } | null;
  closed: boolean;
  closeReason:
    | "OWNER_CLOSED"
    | "PLAYER_LEFT"
    | "RECONNECT_TIMEOUT"
    | "REMATCH_TIMEOUT"
    | null;
  causedByCommandId?: string;
}
```

- 只有 room creator 可 `SELECT_STARTER` 或 `CLOSE_ROOM`；权限绑定 creator session，不因本轮先后手变化。非 owner 伪造选择返回 `ROOM_CONTROL_NOT_ALLOWED`。
- 房主可在另一 slot 尚未分配时预选并提前 ready；任何玩家在 starter 为 null 时 ready 都被拒绝。开局必须同时满足：所有规定 slots 已分配、全部在线、starter 已选、所有参与者 ready。
- 改为不同 starter 会清除全部 ready 和旧 pending candidate；重复选择同一值保持 ready。断线或 connection takeover 只清对应 session ready，保留 starter；重新连接后必须重新 ready。
- Round 启动后 `nextRound = null`；Round 完成后立即把下一轮 starter 重置为 null 并清空 ready，同时保留 completed snapshot。房主必须逐局重新选择。
- 非 owner 的主动离开由 `GameClientHost.leaveRoom()` 发起 consented transport leave。首局未开始时离开/超时关闭 room 但不创建 Match；active leave 把当前 Match 标记 `abandoned`，completed leave 只移除连接并保留 slot。
- Web 只在 active 状态执行关闭/离开前确认；未开局/completed 不弹确认。completed room 拒绝新参与者，并在 5 分钟未开始下一轮时以兼容名称 `REMATCH_TIMEOUT` 关闭。选择或 ready 不延长 TTL；成功启动下一轮时取消 TTL。active/未开局房间的 60 秒 reconnect timeout 以 `RECONNECT_TIMEOUT` 关闭 room，只有 active Round 会产生 abandoned Match。
- 关闭 lifecycle 先发送，server 经过 25 ms 有界 WebSocket drain 后断开 clients；客户端不能把该时间窗口当成 durable acknowledgment。

## 7. Client Action Envelope

V2 transport 名称固定为：Colyseus room name `game`；客户端 custom message type `game.action`；所有 application-level server envelope 通过 custom message type `protocol` 发送，并由 envelope 自身的 `type` 区分 `room.connected`、`match.snapshot` 和 `command.rejected`。

```ts
interface GameActionCommand {
  type: "game.action";
  protocolVersion: 2;
  commandId: string;
  roundNumber: number;
  expectedRevision: number;
  action: unknown;
}
```

- `commandId` 由客户端为每次用户意图生成，在同一 session/live room 内唯一。
- `roundNumber` 在 V2 必填；缺失由 strict schema 拒绝，与当前轮不一致时返回 `STALE_REVISION` 和当前 snapshot，不进入 Core。
- `expectedRevision` 是用户产生 Action 时看到的 revision。
- `action` 先由通用 envelope schema 读取为 `unknown`，再由当前游戏的 `actionSchema` 解析。
- V2 通用 schema 要求 `action` 是 JSON value，且序列化后的 UTF-8 长度不超过 16 KiB；transport 仍应在进入 Zod/Core 前设置总消息上限。
- Envelope 不包含 actor、State、Outcome、RNG seed 或新 revision。

四子棋通过同一 Protocol V2 envelope 发送 `{ type: "DROP_DISC", column }`。越界 column 属于 `INVALID_ACTION_PAYLOAD`，合法形状但错误回合/满列属于带 opaque `gameRuleCode` 的 `GAME_RULE_REJECTED`；duplicate、stale、错轮和终局拒绝继续使用现有平台语义。Transport 不知道重力、row 或四连规则。

五子棋同样通过 Protocol V2 创建请求传递 `{ boardSize: 15 | 19, winLength: 5 }` Config，并用 Action envelope 发送 `{ type: "PLACE_STONE", cell }`。Action 不含 actor、State、Outcome、revision 或随机结果；transport 不知道棋盘坐标、占用、五连/长连或平局。Config/Action schema-invalid payload 使用现有错误，合法形状但错误回合、占用或按当前 Config 越界由 Core 以 opaque `gameRuleCode` 拒绝。

六贯棋以 `initialConfig: null` 创建，并通过同一 envelope 发送 strict `{ type: "PLACE_STONE", cell } | { type: "RESIGN" }`。Transport 不知道六边邻接、连接路径、颜色、投降是否受回合限制或胜者；本轮 `players[0]` 由 starter choice 决定并获得 BLUE。schema-invalid/extra fields 仍是 `INVALID_ACTION_PAYLOAD`，合法形状的错轮、占用、越界和终局由 Core/现有 lifecycle 错误处理。accepted `RESIGN` 与 accepted placement 一样递增 revision 并进入 replay。

黑白棋以 `initialConfig: null` 创建，并通过同一 envelope 只发送 strict `{ type: "PLACE_DISC", cell }`。Transport 不知道八方向夹线、翻转列表、合法落点、棋子数、强制跳过或终局；本轮 `players[0]` 由 starter choice 决定并获得 BLACK。schema-invalid/extra fields 使用 `INVALID_ACTION_PAYLOAD`，错回合、占用或不能翻转使用 opaque `gameRuleCode`。一次 accepted placement 同时完成全部翻转和回合推进，只递增一次 revision 并记录一个 replay Action；自动跳过不产生 `PASS` wire message 或额外 revision。

## 8. Revision、Ordering 与 Idempotency

- 每轮初始 match snapshot 的 revision 为 `0`。
- 每个 accepted Action 恰好使 revision 增加 `1`。
- 黑白棋强制跳过是 accepted `PLACE_DISC` 内的 Core 推进，不是 Action，不额外增加 revision。
- schema invalid、platform rejected、game-rule rejected 和 duplicate Action 不增加 revision。
- Room 在单一串行队列中处理命令，不并发调用 Core。
- `expectedRevision` 不等于当前 revision 时返回 `STALE_REVISION` 和最新 snapshot，命令不进入 Core。
- Server 以 `PlayerSessionId + commandId` 为 key 缓存 command outcome。V2 内存缓存保留整个 live room lifetime，包括后续轮次；重复 `commandId` 返回带原 `roundNumber` 的原结果，不重复调用 Core、消费 RNG、追加 replay 或广播 snapshot。
- 后续长生命周期房间可以加入有界淘汰，但保留窗口不得短于客户端正常重连与请求重试窗口。

## 9. Server Snapshot

```ts
interface MatchSnapshot<View, Outcome> {
  type: "match.snapshot";
  protocolVersion: 2;
  gameId: string;
  gameVersion: string;
  roundNumber: number;
  revision: number;
  status: MatchStatus;
  viewer: { kind: "player"; slotId: string } | { kind: "spectator" };
  view: View;
  outcome: Outcome | null;
  causedByCommandId?: string;
}
```

- Snapshot 是该连接在指定 revision 的完整权威 View，不是 patch。
- Server 始终发送必填 `roundNumber`。Host 在 lifecycle 进入更高 Round 时清除旧 snapshot；忽略低于当前 lifecycle 的旧轮 snapshot，并把领先 lifecycle、无 current Round 时出现 snapshot、或 active lifecycle/snapshot 不匹配视为非法 server message。
- Server 对每个接收者分别调用 `projectView`，不得先广播完整 State 再让客户端隐藏字段。
- 不同玩家在同一 revision 可以获得不同 View，但 revision 和 lifecycle status 相同。
- `causedByCommandId` 用于让发起客户端确认命令；其他客户端可以不接收该字段。
- 初次连接、accepted Action、重连和 stale revision 恢复都使用相同 snapshot 语义。

V2 不要求把 game State 建模为共享 Colyseus Schema。Colyseus 管理 room/transport，generic runtime 可以使用类型化 custom messages 发送 per-viewer JSON snapshot，避免 transport 类型泄漏到 Core。

## 10. Rejection Envelope

```ts
interface CommandRejected {
  type: "command.rejected";
  protocolVersion: 2;
  commandId?: string;
  code: ProtocolErrorCode;
  revision?: number;
  gameRuleCode?: string;
  retryable: boolean;
  snapshot?: MatchSnapshot<unknown, unknown>;
}
```

V2 `ProtocolErrorCode` 至少包括：

| Code                           | 语义                                 | Retryable                        |
| ------------------------------ | ------------------------------------ | -------------------------------- |
| `UNAUTHENTICATED`              | ticket 缺失、无效或过期              | 获取新 ticket 后可重试           |
| `PROTOCOL_VERSION_UNSUPPORTED` | 客户端协议不兼容                     | 否，需更新客户端                 |
| `ROOM_NOT_FOUND`               | room code 无效或已过期               | 否                               |
| `ROOM_FULL`                    | 没有可加入席位                       | 否                               |
| `NOT_A_PLAYER`                 | 当前 session 没有操作该 slot 的权限  | 否                               |
| `MATCH_NOT_ACTIVE`             | lifecycle 不允许 Action              | 视状态而定                       |
| `STALE_REVISION`               | 客户端基于旧 snapshot 操作           | 收到最新 snapshot 后可重试新意图 |
| `INVALID_ACTION_PAYLOAD`       | 游戏 Action schema 解析失败          | 否                               |
| `GAME_RULE_REJECTED`           | Core 拒绝合法形状但违反规则的 Action | 否；附 `gameRuleCode`            |
| `RATE_LIMITED`                 | 超过平台限额                         | 延迟后可重试                     |
| `INTERNAL_ERROR`               | 服务端不变量或基础设施故障           | 由服务端策略决定                 |

错误 message 仅用于诊断，不作为稳定协议。生产响应不得泄漏 stack trace、内部 State、其他玩家秘密或数据库信息。

## 11. Reconnect

- Game Server 将 `PlayerSessionId` 映射到稳定 `PlayerSlotId`。
- 意外断线后席位默认保留 60 秒，房间保持 authoritative State。
- 客户端使用同一有效 guest session、新 ticket 和新的 Colyseus `join` seat reservation 重新连接；V2 不把 SDK reconnection token 作为 authoritative 恢复凭证。
- Server 验证 session 与 slot 所有权后发送当前 lifecycle；存在 current Round 时再发送完整 snapshot。setup 阶段的重连仍可没有 snapshot，并且该 session 的 ready 已被清除。
- 每个 slot 同时只允许一个可操作连接；新的有效连接接管后，旧连接失去提交 Action 的权限。
- 超过 60 秒后，V2 平台策略关闭 live room；若当前 Round active 则标记 `abandoned`，若首局尚未开始则不创建 Match。旧 SDK reconnection token 和新的 join 都不能恢复该席位。未来判负策略仍由平台 lifecycle 负责，具体游戏不得直接处理 socket timeout。
- Server 进程重启不在 live room 恢复保证内，因为 RoomStore、待开局设置与 authoritative State 仍在内存。只保证 completed replay/history 跨连接与进程读取，并在单实例启动时把旧 waiting/当前 active archive 标记 abandoned；从未开始 Round 的 room 没有 archive 可标记。

### 11.1 Client Host 收敛语义

- `GameClientHostState` 明确暴露 `idle | loading | connecting | connected | reconnecting | closed`，以及独立的 room metadata、`roomLifecycle`、最新 snapshot、command rejection 和 ticket/room/protocol/closed error。
- `createRoom(gameId, initialConfig)` 和 `joinRoom(gameId, roomCode)` 每次先通过 provider 获取新 ticket；join 在调用 Colyseus SDK 前执行 `trim().toUpperCase()` 并用 Protocol V2 schema 校验。
- Host 将每个 `protocol` transport payload 当作 `unknown`，只有通过 `serverMessageSchema` 且 game/room/version/viewer identity 与当前连接一致后才更新状态；非法或不一致消息会关闭连接并报告 `INVALID_SERVER_MESSAGE`。
- `submitAction(action)` 只在 current Round 为 active、snapshot 与 lifecycle 的 round/status 一致时可用；它使用安全 UUID command ID，并填充必填 `roundNumber` 和 `expectedRevision`。Host 不接收 actor/State/Outcome，也不计算下一个 revision；pending promise 只由同轮 matching rejection 或服务器 snapshot 结算。
- Rejection 中若包含 snapshot，host 先应用完整 snapshot 再暴露 rejection。duplicate、stale 和 reconnect 都通过 server snapshot 收敛，不在客户端 replay Action 或推导 authoritative State。
- `selectStarter(starter)`、`readyForRound()`、`cancelRoundReady()` 和 `closeRoom()` 发送 control command；Host 支持已连接但 snapshot 为 null 的首局 setup。`leaveRoom()` 使用 consented leave、清空本地 room 并进入 `idle`。`close()` 仅用于刷新/卸载等本地 transport teardown，使用 non-consented leave 以保留服务器 60 秒重连语义，不能代替主动离开。
- 非主动 leave 后，host 在默认 60 秒窗口内从 100 ms 到 2 s 指数退避；每次尝试使用新 ticket 和新 join reservation。窗口耗尽进入 `closed`；收到 closed lifecycle 后进入 `idle` 且不重连。

## 12. 安全与隐私不变量

- 永远不信任客户端提供的 actor、revision、Action shape、room membership 或 Outcome。
- 在 rate limit 和 payload size limit 之前不执行昂贵游戏逻辑。
- Ticket、reconnection token、cookie、session/ticket secret、完整隐藏 State、canonical replay 和 RNG seed 不进入客户端日志、URL、UI 或错误响应。
- Canonical replay 可能包含隐藏信息，只能按 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md) 的访问边界处理。
- 被拒绝命令可以进入安全审计日志，但不得进入 canonical replay。

## 13. Observability

日志和指标使用 `roomId`、`gameId`、`gameVersion`、revision、错误码和经过脱敏的 session correlation ID；不得记录 bearer secret 或完整私密 Action。

V2 内存 collector 暴露的最小指标：

- `active_rooms`、`active_connections`；
- `actions_accepted_total`、`actions_rejected_total`；
- `reconnect_attempt_total`、`reconnect_success_total`、`reconnect_timeout_total`；
- `replay_append_failure_total`、`room_crash_total`。

样本可带 `gameId`/`gameVersion` labels；日志至少使用 `roomId`、game/version、revision、错误码、lifecycle status 和不可逆的 session correlation id 中与事件相关的字段。

指标不改变游戏行为，也不作为 replay 输入。
