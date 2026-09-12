# 开发路线图

本文只维护阶段状态、范围和退出条件。当前产品能力见 [PRODUCT.md](./PRODUCT.md)，精确游戏版本见 [游戏索引](../games/README.md)，实现契约按 [文档索引](./README.md) 阅读。

## 当前阶段

M1–M8 与 M9-A–G 已完成。独立 Surface、V6 Setup、全量游戏画面迁移与九款游戏的开局交互已落地，V5 在线 schema/runtime 已退役。

- 九款当前游戏都注册为 V6 Setup 与独立 Bridge V2 Surface。
- 所有受支持历史规则版本都有精确 Surface 映射；七款旧 Client 源码、渲染契约与 registry loader 已移除。
- 所有受支持规则版本已登记 V6 Setup；两类 runtime、连接 SDK 与 Web 只接受 V6，历史 Core、golden、精确 Surface/replay 映射与旧数据库 metadata 读取继续保留。
- create-game 已支持可通过全仓检查的 V6/Bridge V2 双目录草稿；草稿不自动进入 catalog 或生产制品。
- Pong、羽毛球、坦克迷战的全部支持版本为 `record-only`；服务端记录与验证继续保留。

## 工作原则

- 按依赖推进里程碑，完成退出条件再扩大范围，不承诺未经确认的日期。
- 每个阶段保留可运行检查和清晰 public API；当前游戏维护不得破坏历史 replay。
- 基础设施与共享抽象必须由实际需求支撑，遵守产品非目标和架构边界。
- 逐次修复、文件数量和命令运行记录留在 Git 历史与交付记录中，不重复追加到规范。

## 已完成阶段

| 阶段               | 交付与退出依据                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- |
| M0 架构基线        | 产品、架构、插件、协议、replay、测试与贡献约束                                         |
| M1 工程基础        | pnpm/Turbo、固定工具版本、strict TypeScript、静态检查、稳定根命令与 CI                 |
| M2 SDK 与首个 Core | Game SDK、显式 registry、井字棋、纯 RNG、内存 replay 与 golden fixtures                |
| M3 权威服务端      | 独立 Colyseus、ticket ports、stable slots、串行 Action、重连与真实双客户端 integration |
| M4 Web 纵切        | 匿名身份、连接票据、邀请、浏览器对局与 Playwright E2E                                  |
| M5 持久化          | PostgreSQL/Drizzle、durable replay、Match archive、多轮与关闭、数据库重读验证          |
| M6 插件扩展性      | 四子棋、五子棋、六贯棋和黑白棋验证不同规则；默认 Config 与显式登记方式收敛             |
| M7-A 账户          | 用户名与密码、可撤销 session、Round 身份快照和账户私有历史                             |
| M7-B 私有回放      | 按账户授权、exact definition 重建和只含 projected frames 的播放界面                    |
| M8 实时运行时      | 独立 SDK/server/client runtime、Realtime Protocol V1、实时 replay 与 Phaser Pong 纵切  |

其间已完成逐局先手、随机先手、通用投降、三阶段 Web 路由、窄版 create-game 工具和多人中国跳棋。平台 Protocol V1–V5 是阶段历史，在线仅支持 V6；Realtime Input/Snapshot 仍为独立 V1。M8 的公共变更依据保留在 [历史审计](./archive/M8_SHARED_API_AUDIT.md)。历史阶段曾提供的 Pong 玩家播放现已暂停，当前能力以 manifest 为准。

## M9：独立 Surface、Setup V6 与显示系统

目标是让游戏表现层独立于 Next/React 构建链；逐局规则、参与者、顺序和阵营归游戏 Setup，平台外壳不挤压舞台或猜测游戏字段。

| 子阶段                | 状态   | 范围与退出条件                                                                                         |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| M9-A 契约与兼容骨架   | 已完成 | Bridge V1/V2、artifact、纯 Setup、迁移期 exact 双轨、显式 replay capability 与 deployment registration |
| M9-B 游戏页外壳       | 已完成 | 覆盖式 HUD、独立全屏/focus mode、可访问性与 viewport 回归；保留舞台尺寸                                |
| M9-C 工具链与 Host    | 已完成 | 独立构建、摘要锁、immutable publish、Docker 静态复制、sandboxed iframe、Workbench 与 conformance tests |
| M9-D 双 runtime Setup | 已完成 | 共用 Setup coordinator、权限/projection、独立 RNG、ready、失败重试与完整重新对局设置                   |
| M9-E 双试点           | 已完成 | 井字棋和 Pong 验证两类 runtime 的独立 Surface、数据库、integration 和浏览器链路                        |
| M9-F 全量迁移与退役   | 已完成 | 全量 Surface/历史 V6 Setup、旧 Client 与 V5 在线路径退役、历史读取及部署排空验证                       |
| M9-G 游戏 Setup 交互  | 已完成 | 九款游戏的规则说明、确认预览、顺序与阵营、配置与错误恢复；独立 Surface 和历史版本完成验收              |

### M9-F 完成边界

1. 全部受支持历史规则版本已有 V6 Setup 与精确 Surface 映射；历史 Core、golden 和 replay 重建结果保持不变。
2. 存量 V5 房间排空已确认。ticket、matchmaking、lifecycle、Setup、control 与回合制消息仅支持 V6；旧平台表单、先手/人数/阵营控制与即时 rematch 分支已删除。
3. 两类 runtime、SDK、真实 PostgreSQL、历史 golden、账户回放和完整浏览器流程已按 [测试矩阵](./TESTING.md) 验证。旧 realtime SQL metadata 仍按创建时代际读取，不迁移为可连接房间。
4. 存活房间代际计数与 [Compose 升级/回滚流程](./DEPLOYMENT_DOCKER_COMPOSE.md#v5-退役升级与回滚) 已补齐。部署仍须按实例确认排空，缺失指标不能视为零；进程重启不恢复 live room。部分 Next transpile 条目仍服务 manifest/Core 静态导入，按实际依赖保留。

### M9-G 完成边界

1. 九款游戏在各自 Surface 内完成规则说明、投影驱动的设置摘要与示意、顺序和阵营选择；五子棋棋盘尺寸与 Pong 目标分数开放既有 Core 配置。具体规则和历史差异见 [游戏索引](../games/README.md)。
2. 设置以服务器确认投影为准，SDK 到 Web/Bridge 保留拒绝原因和过期状态，Surface 只接收状态与错误码。重复提交防护、拒绝与断线恢复、有效焦点、触屏操作、重连和下一局实际设置复用均按 [测试矩阵](./TESTING.md) 验证。
3. 九款 Surface 各提升一个 patch 并同步摘要锁和全部支持版本的精确映射；Gameplay Core、gameVersion、Config schema、Protocol V6、Bridge V2 与 replay 格式保持兼容。独立契约、历史 golden、真实 PostgreSQL 和完整浏览器旅程已通过。

M9 不包含真正 `replay:none` 的数据库语义、外部仓库发布、独立无 Cookie 资源域或平台通用 Setup 表单。生产继续使用同域静态路径与 opaque iframe origin。

## 已接入的后续游戏内容

这些扩展复用已建立的能力，不改写 M8 当时的双人 Pong 验收范围。

| 内容                                               | 当前边界                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [中国跳棋](../games/chinese-checkers/GAME_SPEC.md) | V6 Setup、2–6 人营地/顺序与新版棋盘几何；旧拓扑和回放独立冻结                                        |
| [火柴人羽毛球](../games/badminton/GAME_SPEC.md)    | 60 Hz 整数模拟、手动发球和键盘/多指操作，独立 Phaser Setup/Play 与双手触屏布局，record-only          |
| [坦克迷战](../games/tank-maze/GAME_SPEC.md)        | 2–8 人、偏向小地图的随机迷宫、前后等速、方向滑动换键和按次射击，多小局 SVG Surface；历史规则独立冻结 |

内容维护沿用各游戏规则版本与 Surface 版本边界，并运行 Core/Setup/golden、Surface contract、真实多人 integration 和临时 PostgreSQL 浏览器验证；详细要求集中在测试策略。

## 未排期能力

匹配、排行榜、好友、观战、公开 replay、隐藏信息游戏、checkpoint、active room 恢复、多实例 ownership、Redis 和跨区域部署均未排期。只有产品需求或运行指标出现后才明确范围、兼容性、验收条件与里程碑。
