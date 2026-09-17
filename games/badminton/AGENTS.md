# 火柴人羽毛球约束

- 当前 `badminton@1.5.0` 是独立的 60 Hz 整数模拟；`1.5.0` Setup 可选择 1/2/3 球速挡位，挡位改变球路飞行 tick，因此属于 replay 契约。`1.4.0` 及更早版本的 Core/schema/constants 与历史球路模块已冻结，历史 fixtures 不覆盖。
- Core 不依赖 Phaser、DOM、网络或其他游戏。表现层位于 `game-surfaces/badminton`，仅消费公开 View。
- 客户端仅提交 `CONTROL` 或 `RESIGN`，不选择位置、命中、计分、actor 或 tick。
- Setup 固化首发顺序和目标比分；左侧首发，得分者续发。下一局复用完整设置，双方分别准备。
- 全部受支持版本均为 `record-only`；不得注册 Replay entrypoint 或暗示玩家可播放回放。
