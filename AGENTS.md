# AGENTS.md

适用于整个仓库；更深层的 `AGENTS.md` 补充局部约束。开始前先看 [当前阶段](./docs/ROADMAP.md)，再按 [文档索引](./docs/README.md) 阅读任务涉及的权威文档。具体游戏以自己的 `GAME_SPEC.md` 为主要上下文。

## 架构约束

- Platform 管理身份、连接、房间、稳定席位、lifecycle、reconnect 和 replay；Game 管理 State、Action/Input、规则与 Outcome。
- 服务器是唯一权威。客户端只提交 intent，不提交 actor、State、随机结果或 Outcome；所有出站游戏数据必须经过 `projectView`，隐藏 State 永不发给客户端。
- Game Core 与 Setup 必须是确定性、JSON 可序列化的纯 TypeScript；禁止 `Math.random()`、系统时间和环境 I/O，不得依赖 React、Next.js、DOM、Phaser、Colyseus、WebSocket、ORM、PostgreSQL 或 Redis。
- SDK、Protocol 和通用 runtime 不得依赖具体游戏；游戏之间不得互相依赖。回合制与 realtime runtime 保持独立，依赖方向以 [系统架构](./docs/ARCHITECTURE.md) 为准。
- Surface 只消费 Bridge 投影视图并提交 intent，不导入 Core、client host、Protocol、ticket 或数据库；游戏专属表现不进入网站公共 HUD/CSS。
- 不创建泛化 `shared` 包，不使用未声明的 deep import，不引入循环依赖。
- Canonical replay 只记录规范化且 accepted 的 Action/Input。Rejected、duplicate、stale commands 不产生记录，不因这些命令推进 revision 或消费 RNG；实时 tick 仍由 scheduler 独立推进。

## 变更政策

- 修改共享 public API 前，先说明跨 package 价值、兼容性和迁移范围；同步更新权威文档、所有消费者和 contract tests，不为单个游戏添加平台特例。
- 改变旧 replay 重建结果的规则、schema、RNG 或 bug fix 必须评估新的 `gameVersion`；wire、Bridge、Surface artifact 和 replay envelope 分别评估自己的版本，不能互相替代。
- 新依赖须有明确 owner，并说明现有能力为何不能合理替代；从 workspace root 使用 pnpm 添加并提交 lockfile，不手改依赖树。
- 新模块保持小 public API，内部实现默认不导出。业务约定必须进入类型、schema、测试或权威文档。
- 按当前里程碑控制范围，不因“未来可能需要”提前引入 Redis、Kubernetes、微服务、数据库抽象层或复杂通用框架。

## 文档维护

- README 只保留项目概览和入口；运行步骤、契约、测试、阶段状态分别归入对应文档，职责见 [文档索引](./docs/README.md)。
- 同一约定保留一个权威来源，其他文档使用链接。游戏规则与特定版本说明放在游戏目录，不把逐次开发记录追加到平台规范。
- 历史协议或规则仍被代码支持时，标明兼容范围并保留契约；已完成计划只在路线图概括，过时操作说明删除或修正。

## 验证

- 按 [TESTING.md](./docs/TESTING.md) 的改动矩阵运行所有受影响层级，不能只检查 happy path。
- Core 至少覆盖合法/非法 Action、终局、不变性、序列化、projection 与 seeded determinism；Server/Protocol 至少覆盖伪造 actor、invalid schema、stale revision、idempotency、view privacy 与 reconnect。
- Replay 变更运行所有受支持 `gameVersion` 的 golden fixtures；Surface 变更完成独立 contract、artifact 和相应浏览器检查。
- 需要真实 PostgreSQL 检查时，必须按测试文档启动固定版本的 Docker 临时实例，在测试进程中注入 `TEST_DATABASE_URL` 并在结束时清理。不得因变量未配置而跳过，也不得使用开发 `DATABASE_URL`、共享测试库、SQLite 或外部托管库替代。Docker daemon 不可用时明确报告阻塞。

## Git 与交付

- 保留用户已有改动，不删除或重写未理解的设计。
- 每完成一个可独立审查且相关检查通过的逻辑单元，及时创建 Git commit；不提交失败中间态或无关文件。
- 使用 Conventional Commits：type 为英文小写，可带英文 scope，冒号后的说明使用简洁中文，例如 `docs: 整理文档职责与开发入口`。
- 未经用户明确要求，不 amend、rebase、squash、reset、强推或以其他方式改写已有提交历史。
- 最终汇报列出本轮 commit hash、提交信息、实际执行的检查及结果；未提交或未运行的检查须说明原因。
