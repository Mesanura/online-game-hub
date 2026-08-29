# AGENTS.md

本文件适用于整个仓库。开始工作前先阅读与任务相关的 `docs/` 文档；局部目录存在更深层 `AGENTS.md` 时同时遵守。详细设计只保存在权威文档中，不复制到本文件。

## Read First

- 产品范围：[docs/PRODUCT.md](./docs/PRODUCT.md)
- 系统边界：[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Game Plugin：[docs/GAME_PLUGIN_SPEC.md](./docs/GAME_PLUGIN_SPEC.md)
- 网络协议：[docs/NETWORK_PROTOCOL.md](./docs/NETWORK_PROTOCOL.md)
- Replay：[docs/REPLAY_DESIGN.md](./docs/REPLAY_DESIGN.md)
- 测试策略：[docs/TESTING.md](./docs/TESTING.md)
- 当前阶段：[docs/ROADMAP.md](./docs/ROADMAP.md)

## Hard Rules

- Platform 管理身份、连接、房间、席位、lifecycle、reconnect 和 replay；Game 管理 State、Action、规则与 Outcome。
- Server authoritative：客户端只提交 intent，不提交 actor、State、随机结果或 Outcome。
- Game Core 必须是 deterministic、JSON-serializable 的纯 TypeScript；禁止 `Math.random()`、系统时间和环境 I/O。
- Game Core 禁止依赖 React、Next.js、DOM、Phaser、Colyseus、WebSocket、ORM、PostgreSQL 或 Redis。
- `game-sdk`、`protocol`、`game-server-runtime` 不得依赖具体游戏；游戏之间不得互相依赖。
- 不创建泛化 `shared` 包，不使用未声明的 deep import，不引入循环依赖。
- 隐藏 State 永不发送到客户端；所有出站游戏数据必须经过 `projectView`。
- Canonical replay 只记录规范化且 accepted 的 Action。Rejected/duplicate/stale commands 不推进 revision 或 RNG。

## Change Policy

- 修改 shared public API 前，先说明跨 package 价值、兼容性和迁移范围；同步更新权威文档、所有消费者和 contract tests。
- 会改变旧 replay 重建结果的规则、schema 或 RNG 修改必须评估新的 `gameVersion`。
- Wire envelope 的不兼容修改必须评估新的 `protocolVersion`；replay envelope 同理评估 `replayFormatVersion`。
- 新依赖必须有明确 owner 和不能用现有能力合理替代的理由。使用 pnpm 从 workspace root 添加，并提交 lockfile；不要手改依赖树。
- 不因为“未来可能需要”提前加入 Redis、Kubernetes、微服务、数据库抽象层或复杂通用框架。

## Working Rules

- 先检查当前 roadmap milestone，不把下一阶段功能混入当前任务。
- 修改游戏时以该游戏目录为主要上下文；公共契约不为单个游戏添加特例。
- 新模块保持小 public API；内部实现默认不导出。
- 业务约定必须进入类型、schema、测试或权威文档，不能只存在于隐式命名和口头说明中。
- 保留用户已有改动；不要删除或重写未理解的设计。
- 每完成一个可独立审查的逻辑单元，并且相关检查通过后及时提交 Git commit；不提交失败中间态。
- 每个 commit 只包含当前任务范围内的相关改动，不混入无关文件或其他人的未完成改动。
- Git 提交信息遵循 Conventional Commits：type 使用英文小写，可按需使用英文 scope；冒号后的说明使用简洁中文，例如 `build: 搭建前后端骨架和本地运行环境`、`chore: 初始化仓库与项目管理规范`。
- 未经用户明确要求，不 amend、rebase、squash、reset、强推或以其他方式改写已有提交历史。
- 最终汇报列出本轮创建的 commit hash 与提交信息；若未提交，说明原因。

## Required Checks

- 根据 [docs/TESTING.md](./docs/TESTING.md) 运行所有受影响层级，而不只运行改动文件的 happy path。
- Game Core 至少检查合法/非法 Action、终局、immutability、serialization、projection 和 seeded determinism。
- Server/Protocol 至少检查伪造 actor、invalid schema、stale revision、idempotency、view privacy 和 reconnect。
- Replay 变更必须运行所有受支持 `gameVersion` 的 golden fixtures。
- 最终汇报列出实际运行的命令、结果和未运行检查的原因。

M1 已建立稳定的根 `lint`、`typecheck`、`test`、`build` 与 `deps:check` scripts。实际可用命令及当前阶段尚未提供的 integration/E2E 命令见 [README.md](./README.md)。
