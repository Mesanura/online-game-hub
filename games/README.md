# 游戏索引

每个 `games/<game-id>` 拥有 manifest、权威 Core、Setup、规则文档和测试；浏览器画面位于独立的 `game-surfaces/<game-id>`。当前版本来自 [catalog](../packages/game-registry/src/catalog.ts)，历史支持以 [server registry](../packages/game-registry/src/server.ts) 为准。

| 游戏与规则                                  | gameId             | 人数 | Runtime    | 当前 gameVersion | 另保留的历史版本 | 玩家回放    |
| ------------------------------------------- | ------------------ | ---- | ---------- | ---------------- | ---------------- | ----------- |
| [井字棋](./tic-tac-toe/GAME_SPEC.md)        | `tic-tac-toe`      | 2    | turn-based | `1.1.0`          | `1.0.0`          | 支持        |
| [四子棋](./connect-four/GAME_SPEC.md)       | `connect-four`     | 2    | turn-based | `1.1.0`          | `1.0.0`          | 支持        |
| [五子棋](./gomoku/GAME_SPEC.md)             | `gomoku`           | 2    | turn-based | `1.1.0`          | `1.0.0`          | 支持        |
| [六贯棋](./hex/GAME_SPEC.md)                | `hex`              | 2    | turn-based | `1.0.0`          | —                | 支持        |
| [黑白棋](./reversi/GAME_SPEC.md)            | `reversi`          | 2    | turn-based | `1.1.0`          | `1.0.0`          | 支持        |
| [中国跳棋](./chinese-checkers/GAME_SPEC.md) | `chinese-checkers` | 2–6  | turn-based | `1.1.0`          | `1.0.0`          | 支持        |
| [乒乓对战（Pong）](./pong/GAME_SPEC.md)     | `pong`             | 2    | realtime   | `1.2.0`          | `1.0.0`、`1.1.0` | record-only |
| [火柴人羽毛球](./badminton/GAME_SPEC.md)    | `badminton`        | 2    | realtime   | `1.2.0`          | `1.0.0`、`1.1.0` | record-only |
| [坦克迷战](./tank-maze/GAME_SPEC.md)        | `tank-maze`        | 2–8  | realtime   | `1.1.0`          | `1.0.0`          | record-only |

回放能力适用于表中各游戏的全部支持版本。支持播放的比赛也只向登录态参赛者开放；`record-only` 仍保存并验证 canonical record，但没有玩家播放入口。旧 Core 与 golden fixtures 必须按 exact 版本重建，不能用当前定义替代。

所有当前游戏均使用 V6 Setup 和 Bridge V2 Surface。历史版本的 Setup 代际、Surface 版本和 mode 映射集中在 [deployment registry](../packages/game-registry/src/deployment.ts)，不在此重复维护。旧 `/client` exports 仅供兼容 API/组件测试，Web 已停止加载。

开发游戏先阅读自己的 `GAME_SPEC.md` 和 `AGENTS.md`，再按任务参考 [Game Plugin](../docs/GAME_PLUGIN_SPEC.md)、[Realtime Runtime](../docs/REALTIME_RUNTIME_DESIGN.md)、[Game Surface](../docs/GAME_SURFACE_SPEC.md) 与 [测试策略](../docs/TESTING.md)。[create-game](../tools/README.md) 当前仍是旧回合制骨架工具，不能代替 V6/Surface 接入。
