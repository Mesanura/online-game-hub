# 文档索引

文档按职责维护：当前行为写入规范，操作步骤写入指南，阶段状态写入路线图。修改约定时更新其权威来源，其他文档通过链接引用。

## 按任务阅读

| 任务                     | 文档与职责                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 安装、启动和本地排障     | [DEVELOPMENT.md](./DEVELOPMENT.md)：环境、数据库、开发服务与工具入口                                  |
| 了解产品                 | [PRODUCT.md](./PRODUCT.md)：用户流程、账户与回放权限、范围和非目标                                    |
| 查询游戏                 | [games/README.md](../games/README.md)：当前及历史版本、规则文档入口                                   |
| 理解平台或修改依赖       | [ARCHITECTURE.md](./ARCHITECTURE.md)：服务、package、存储与依赖边界                                   |
| 实现回合制 Core 或 Setup | [GAME_PLUGIN_SPEC.md](./GAME_PLUGIN_SPEC.md)：纯逻辑契约、RNG、注册与版本策略                         |
| 实现实时游戏或 runtime   | [REALTIME_RUNTIME_DESIGN.md](./REALTIME_RUNTIME_DESIGN.md)：固定 tick、输入交付、实时协议与客户端边界 |
| 开发游戏画面             | [GAME_SURFACE_SPEC.md](./GAME_SURFACE_SPEC.md)：artifact、Bridge、iframe Host、Workbench 与发布流程   |
| 修改身份、房间或通信     | [NETWORK_PROTOCOL.md](./NETWORK_PROTOCOL.md)：V6、票据、Setup、消息、重连与历史兼容                   |
| 修改记录或回放           | [REPLAY_DESIGN.md](./REPLAY_DESIGN.md)：两类 canonical record、写入顺序、重建和访问控制               |
| 决定验证范围或运行测试   | [TESTING.md](./TESTING.md)：改动矩阵、最低场景、命令与临时 PostgreSQL                                 |
| 部署、更新或备份         | [DEPLOYMENT_DOCKER_COMPOSE.md](./DEPLOYMENT_DOCKER_COMPOSE.md)：单机 Compose 运维                     |
| 查看进度和后续工作       | [ROADMAP.md](./ROADMAP.md)：已完成阶段、当前里程碑与退出条件                                          |
| 使用仓库脚手架           | [tools/README.md](../tools/README.md)：现有 CLI 的实际能力与限制                                      |
| 遵守贡献约束             | [AGENTS.md](../AGENTS.md)：工作、验证与提交规则                                                       |

单个游戏的规则、输入、几何、计分及规则版本差异由 `games/<game-id>/GAME_SPEC.md` 定义；独立画面的实现说明放在 `game-surfaces/<game-id>/README.md`。阅读局部代码前同时检查该目录的 `AGENTS.md`。

## 维护边界

- 运行命令与环境变量分别核对 [根 scripts](../package.json) 和服务的 `.env.example`；文档中的示例不替代配置校验。
- 当前游戏版本与能力核对 manifest，历史实现核对 [server registry](../packages/game-registry/src/server.ts)，协议代际和 Surface 映射核对 [deployment registry](../packages/game-registry/src/deployment.ts)。精确 wire/API 类型以对应源码及 contract tests 共同约束。
- 不在多份概览中复制逐游戏版本、fixture 文件名或测试步骤；版本清单集中在游戏索引，验证入口集中在测试策略。
- [M8 公共 API 审计](./archive/M8_SHARED_API_AUDIT.md) 仅保留当时的兼容性决策证据，不作为现行接口或开发计划。
- 文档改动运行 `pnpm format:check` 与 `pnpm docs:check`；若同时改变行为或契约，再按测试矩阵扩展检查。
