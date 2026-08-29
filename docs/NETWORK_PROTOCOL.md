# 网络协议

> 状态：V1 设计  
> 本文是 Web、Game Server 与浏览器之间身份、房间、消息、revision 和重连语义的权威来源。游戏规则 payload 见 [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)。

## 1. 协议目标

- 客户端只提交 Action intent，不能提交 actor 或 authoritative State。
- 所有不可信消息在使用前经过 Zod runtime validation。
- 每个 accepted Action 有唯一顺序和 revision。
- 丢包、重复发送、页面刷新和短暂断线后可通过完整 snapshot 收敛。
- 隐藏信息游戏可以为每个连接发送不同 View。
- transport 和游戏规则解耦；Core 不知道 Colyseus 或 WebSocket。

## 2. 传输边界

| 流程                             | Transport                  | Owner       |
| -------------------------------- | -------------------------- | ----------- |
| 页面、游戏目录、匿名 session     | HTTPS                      | Next.js Web |
| 短期 Game Server ticket          | HTTPS                      | Next.js Web |
| 创建/加入房间、seat reservation  | Colyseus matchmaking HTTPS | Game Server |
| 对局 Action、snapshot、lifecycle | WebSocket                  | Game Server |

浏览器直接连接 Game Server。Next.js 不代理 WebSocket，也不保存 authoritative match State。

## 3. 协议版本

所有 application-level envelope 携带整数 `protocolVersion`。V1 值为 `1`。

- 版本表示 wire envelope 兼容性，不等同于 `gameVersion` 或 `replayFormatVersion`。
- Game Server 在连接或首条消息阶段拒绝不支持的版本。
- 向后兼容的字段只能以可选字段增加；删除、改名或改变语义需要新 protocol version。

## 4. 匿名身份与连接票据

### 4.1 Guest Session

Next.js 首次访问时建立匿名 guest session，并通过安全、HttpOnly、SameSite cookie 维持浏览器身份。平台内部产生稳定的 `PlayerSessionId`，不把 cookie 值直接作为玩家 ID。

账号系统加入后，guest session 可以关联或迁移到账号，但房间和 Game Core 继续只依赖平台 session/slot 抽象。

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
  protocolVersion: 1;
}
```

- Ticket 必须短期有效、可验证签名且限制 audience。
- 浏览器可以携带 ticket，但不能修改 claims。
- Game Server 验证签名、有效期、audience 和 protocol version 后才创建连接身份。
- 日志不得记录原始 ticket、cookie 或其他 bearer secret。
- 具体签名格式、密钥服务和轮换方案在实现认证时决定；wire contract 只依赖上述语义。

## 5. 房间标识与流程

内部 `roomId` 属于 Game Server。外部用户只使用不可预测、大小写规范化的临时 `roomCode`；邀请 URL 携带 `gameId` 与 `roomCode`，不携带 ticket。

### 5.1 创建房间

1. Web 确保 guest session 存在并获取 ticket。
2. 客户端向 Game Server 提交 `gameId` 和未信任的 `initialConfig`。
3. Server 从 registry 选择当前可创建的 exact `gameVersion`。
4. Server 校验 Config、创建 room、分配第一个 slot，并返回 `roomCode`、邀请 URL 与 Colyseus seat reservation。
5. 客户端使用 reservation 建立 WebSocket。

### 5.2 加入房间

1. 客户端提交规范化后的 `roomCode` 和有效 ticket。
2. Server 检查房间存在、版本可用、席位未满且 session 未被禁止加入。
3. Server 分配稳定 `PlayerSlotId` 并返回 seat reservation。
4. 连接建立后发送当前完整 snapshot。

客户端不得选择 `PlayerSlotId`、伪造其他玩家身份或要求加入内部 `roomId`。

## 6. Match Lifecycle

平台层状态为：

```ts
type MatchStatus = "waiting" | "active" | "completed" | "abandoned";
```

- `waiting`：等待规定席位就绪；Core 尚未接受游戏 Action。
- `active`：比赛已开始，可以按平台和游戏规则处理 Action。
- `completed`：Core 返回 Outcome；不再接受改变结果的 Action。
- `abandoned`：平台因未开始离开、断线超时或管理原因终止，可能没有游戏 Outcome。

状态转换由 Game Server 管理。Game Core 只决定游戏 Outcome，不决定网络断开、房间销毁或 session 权限。

## 7. Client Action Envelope

```ts
interface GameActionCommand {
  type: "game.action";
  protocolVersion: 1;
  commandId: string;
  expectedRevision: number;
  action: unknown;
}
```

- `commandId` 由客户端为每次用户意图生成，在同一 session/room 内唯一。
- `expectedRevision` 是用户产生 Action 时看到的 revision。
- `action` 先由通用 envelope schema 读取为 `unknown`，再由当前游戏的 `actionSchema` 解析。
- V1 通用 schema 要求 `action` 是 JSON value，且序列化后的 UTF-8 长度不超过 16 KiB；transport 仍应在进入 Zod/Core 前设置总消息上限。
- Envelope 不包含 actor、State、Outcome、RNG seed 或新 revision。

## 8. Revision、Ordering 与 Idempotency

- 初始 match snapshot 的 revision 为 `0`。
- 每个 accepted Action 恰好使 revision 增加 `1`。
- schema invalid、platform rejected、game-rule rejected 和 duplicate Action 不增加 revision。
- Room 在单一串行队列中处理命令，不并发调用 Core。
- `expectedRevision` 不等于当前 revision 时返回 `STALE_REVISION` 和最新 snapshot，命令不进入 Core。
- Server 为每个 session/room 保留最近 command outcomes。重复 `commandId` 返回原结果，不重复消费 RNG、追加 replay 或广播 State。
- 重试窗口的具体大小是 runtime 配置；不得小于客户端正常重连与请求重试所需时间。

## 9. Server Snapshot

```ts
interface MatchSnapshot<View, Outcome> {
  type: "match.snapshot";
  protocolVersion: 1;
  gameId: string;
  gameVersion: string;
  revision: number;
  status: MatchStatus;
  viewer: { kind: "player"; slotId: string } | { kind: "spectator" };
  view: View;
  outcome: Outcome | null;
  causedByCommandId?: string;
}
```

- Snapshot 是该连接在指定 revision 的完整权威 View，不是 patch。
- Server 对每个接收者分别调用 `projectView`，不得先广播完整 State 再让客户端隐藏字段。
- 不同玩家在同一 revision 可以获得不同 View，但 revision 和 lifecycle status 相同。
- `causedByCommandId` 用于让发起客户端确认命令；其他客户端可以不接收该字段。
- 初次连接、accepted Action、重连和 stale revision 恢复都使用相同 snapshot 语义。

V1 不要求把 game State 建模为共享 Colyseus Schema。Colyseus 管理 room/transport，generic runtime 可以使用类型化 custom messages 发送 per-viewer JSON snapshot，避免 transport 类型泄漏到 Core。

## 10. Rejection Envelope

```ts
interface CommandRejected {
  type: "command.rejected";
  protocolVersion: 1;
  commandId?: string;
  code: ProtocolErrorCode;
  revision?: number;
  gameRuleCode?: string;
  retryable: boolean;
  snapshot?: MatchSnapshot<unknown, unknown>;
}
```

V1 `ProtocolErrorCode` 至少包括：

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
- 客户端使用有效 guest session、新 ticket 和 Colyseus reconnection/reservation 信息重新连接。
- Server 验证 session 与 slot 所有权后发送当前完整 snapshot。
- 每个 slot 同时只允许一个可操作连接；新的有效连接接管后，旧连接失去提交 Action 的权限。
- 超过 60 秒后，平台按房间策略将比赛标记为 completed/abandoned 或判定对手胜利；具体游戏不得直接处理 socket timeout。
- Server 进程重启不在 V1 恢复保证内，因为 RoomStore 使用内存 adapter。

## 12. 安全与隐私不变量

- 永远不信任客户端提供的 actor、revision、Action shape、room membership 或 Outcome。
- 在 rate limit 和 payload size limit 之前不执行昂贵游戏逻辑。
- Ticket、reconnection token、cookie、完整隐藏 State 和 RNG seed 不进入客户端日志。
- Canonical replay 可能包含隐藏信息，只能按 [REPLAY_DESIGN.md](./REPLAY_DESIGN.md) 的访问边界处理。
- 被拒绝命令可以进入安全审计日志，但不得进入 canonical replay。

## 13. Observability

日志和指标使用 `roomId`、`gameId`、`gameVersion`、revision、错误码和经过脱敏的 session correlation ID；不得记录 bearer secret 或完整私密 Action。

最小指标：

- active rooms/connections；
- Action accepted/rejected 数量及延迟；
- reconnect attempt/success/timeout；
- replay append failure；
- room crash 和 internal error；
- 每个 game/version 的活跃比赛数。

指标不改变游戏行为，也不作为 replay 输入。
