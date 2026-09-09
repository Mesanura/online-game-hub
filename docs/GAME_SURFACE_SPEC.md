# Game Surface 规范

本文定义独立游戏画面的 artifact、Bridge、iframe Host 与开发发布流程。纯 Core/Setup 见 [Game Plugin](./GAME_PLUGIN_SPEC.md)，平台布局与用户体验见 [产品文档](./PRODUCT.md)，验收见 [测试策略](./TESTING.md)。

## 职责与目录

`game-surfaces/<game-id>` 是独立 workspace，可选择 TypeScript、React、Phaser、SVG、Canvas、WebGL 或其他浏览器技术。它只消费 `game-surface-bridge` 的 JSON 契约和自身渲染依赖，不导入 Core、client host、Protocol、ticket、数据库或其他游戏。Next 不编译 Surface 源码。

Surface 负责严格解析 projected View、采集最小 intent、显示比分/回合/阵营/排名/结果、响应式布局和游戏可访问性。Host 负责连接状态、权限、transport envelope、iframe 生命周期与平台操作。两者都不能以本地推断替代服务器规则。

```text
game-surfaces/<game-id>/
  package.json              # 显式声明 onlineGameHub.surfaceArtifact
  surface.config.json       # artifact 契约，不含 digest
  surface.lock.json         # 已锁定的 gameId、surfaceVersion、digest
  setup/index.html
  play/index.html
  replay/index.html         # 仅 player-playback 需要
  src/
  tests/                    # 公开 projected fixtures 与 contract tests
  dist/                     # 构建输出，不提交
```

发布型 workspace 声明 `onlineGameHub.surfaceArtifact: true`；Workbench 与未发布草稿显式声明 `false`。缺失标记不能被当成非发布包静默跳过。正式 Surface 提供独立 `dev`、`build`、`test`、`typecheck` 与 `contract-test`。

[create-game](../tools/README.md) 的草稿只提供 `dev/build/typecheck` 与未实现的 Setup/Play 占位页；普通构建不生成 artifact manifest 或锁，发布工具跳过它。实现规则与画面后再补齐真实测试、版本、replay 能力与制品配置，切换发布标记并生成摘要锁。

## Artifact 与精确解析

`SurfaceArtifactManifestV1` 记录 `schemaVersion`、`gameId`、`supportedGameVersions`、`surfaceVersion`、`bridgeVersion`、entrypoints、capabilities 和 `contentDigest`。Setup/Play 必填，Replay 由 exact definition 的 replay capability 决定；入口必须位于对应 mode 目录。

同一 artifact 可以显式支持多个规则版本，但必须分别严格解析其 View/Input，不得用新规则解释旧回放。`surfaceVersion` 与 `gameVersion` 独立：表现内容改变提升前者，规则重建改变评估后者。

仓库级 artifact CLI 生成 `dist/surface.manifest.json` 并验证源码侧的锁；它不是 Surface 的 workspace 依赖。manifest 自身不参与摘要，其余文件按 POSIX 相对路径排序，以 `online-game-hub-surface-artifact-v1` 为域分隔，依次编码路径字节数、路径、内容字节数和原始内容，计算 canonical SHA-256。

发布路径为 `/game-surfaces/<gameId>/<surfaceVersion>/<mode>/`，使用 immutable cache。同 gameId/version/digest 的重复发布为 no-op，不重写目标；不同摘要不得覆盖同一版本。Web 按 exact `(gameId, gameVersion, mode)` 的 [deployment registration](../packages/game-registry/src/deployment.ts) 解析入口，缺失时显示不可用，不回退到 legacy Client Module。

## Bridge 与安全边界

Host 使用不含 `allow-same-origin` 的 sandboxed iframe，仅按能力开放 scripts 与 pointer lock。iframe 不得获得表单、弹窗、下载或顶层导航能力。静态资源不读取登录态，绕过 guest-session proxy，并提供 opaque-origin CORS、CORP、`nosniff`、immutable cache 和禁止直接联网的 CSP；素材随 artifact 发布。

首次 window 握手校验 iframe window、一次性 nonce 与 artifact 声明的 exact Bridge 版本，然后单次移交 `MessageChannel`；之后只使用专用 port。所有消息使用 strict JSON schema，拒绝敏感字段。10 秒初始化超时、非法消息、端口失败或 crash 进入可重试错误态；失败期间不转发 intent，retry 创建新 nonce/channel。

JavaScript helper 为：

- 平台 `SurfaceBridgeHost.start/retry/send/reportSurfaceCrash/dispose`，生命周期为 `idle → loading → ready | failed → disposed`。
- Surface `GameSurfaceBridge.start/send/dispose`，只接受指定 parent 的单次握手并绑定专用 port。

其他技术栈可直接实现同一 JSON 协议，不必使用 helper。Bridge V1/V2 exact 分派，V1 不接受 V2-only 消息。

| 方向           | 允许内容                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host → Surface | mode、game/version、locale、reduced-motion、projected Setup/Game View、连接/只读/round/revision/tick、viewport/fullscreen、intent 结果、受限平台命令和 dispose |
| Surface → Host | ready/error/安全 diagnostic、Setup Action、回合制 Action 或 realtime Input intent，以及 V2 终局文本摘要                                                        |

票据、session、账户身份、actor、raw State、RNG seed、canonical replay 和 WebSocket 不进入 Surface。平台侧 Client Host 才能补充 command ID、round、expected revision、input sequence 和 transport envelope；Bridge helper 自身不补写这些字段。

### 平台投降命令

只有 exact deployment 的 `platformControls` 显式包含 `RESIGN`，Host 才能发送 `host.command { control: "RESIGN", clientIntentId }`。命令不含 Action/Input payload、actor、round 或 revision。Surface 按 exact 规则版本生成自己的投降 intent，并沿用该 `clientIntentId`，走普通提交与结果闭环。

旧 Core 不支持投降时，不得声明该能力。Host 有待处理 Surface intent 时拒绝并发平台命令；10 秒未转化为 intent、retry、dispose 或 Bridge failure 都必须释放 pending，并拒绝过期 intent。确认按钮只负责 UX，服务器仍验证规则。

### 终局摘要

Bridge V2 的 play Surface 可为最近一次 completed `host.state.sequence` 发送 `surface.result-summary`：headline 为 1–80 字符，details 最多六行、每行不超过 120 字符，tone 必须合法。

Host 只按纯文本显示与最新 completed state 匹配的摘要，不据此推进 lifecycle。Setup、Replay、active、旧 sequence 或 V1 摘要不展示；active、新 Round、retry 和 dispose 清除摘要。摘要到达前显示通用完成状态。

## 独立开发与 Workbench

先完成 [环境安装](./DEVELOPMENT.md)，并构建 Bridge 依赖。以井字棋为例，在不同终端启动 Surface 与 Workbench：

```sh
pnpm --filter @online-game-hub/game-surface-bridge build
pnpm --filter @online-game-hub/tic-tac-toe-surface dev
```

```sh
pnpm --filter @online-game-hub/surface-workbench dev
```

打开 Vite 输出的 Workbench 地址，填入 Surface 的完整 dev URL 和对应 `/setup/`、`/play/` 或 `/replay/` 路径。使用匹配游戏版本的公开 projected fixture，不从 canonical record 或服务器 State 截取未经投影的数据。

Workbench 可模拟 Setup、回合制 Play、Realtime Play、Replay、断线/重连、只读/终局、revision/setupRevision/tick、reduced-motion、viewport 与 fullscreen/focus mode，并返回 accepted/rejected/stale intent 结果。它不依赖 Next、Game Server 或具体游戏；fixture 仍须通过 Bridge 的敏感 key 检查。

## 更新与发布

1. 修改画面后，先提升 `surface.config.json` 的 `surfaceVersion`；纯文档变更不改变 artifact 时无需升级。
2. 用该包的 `artifact:lock` 显式构建并更新摘要锁，同时更新 exact deployment 的版本、路径、能力和摘要。
3. 运行独立测试与 contract，再构建、校验并发布到本地 Web 静态目录。

```sh
pnpm --filter @online-game-hub/tic-tac-toe-surface artifact:lock
pnpm --filter @online-game-hub/tic-tac-toe-surface test
pnpm --filter @online-game-hub/tic-tac-toe-surface contract-test
pnpm build
pnpm surface:verify
pnpm surface:publish
```

普通 build 只读并验证已有锁，不自动更新摘要。替换示例包名即可用于其他 Surface；仍须按测试矩阵运行受影响的 Host、viewport 和浏览器流程。Docker 在镜像构建阶段重新构建并发布 artifact，不依赖宿主机的 `dist`。

回滚切换到已发布的 immutable artifact 引用，不覆盖旧版本，也不改变已有房间的规则版本或 Setup 协议代际。
