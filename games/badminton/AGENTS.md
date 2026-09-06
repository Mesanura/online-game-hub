# 火柴人羽毛球约束

- `badminton@1.0.0` 是独立的 60 Hz 整数模拟；轨迹、计分、输入租期、挥拍窗口和碰撞顺序都是 replay 契约。
- Core 不依赖 Phaser、DOM、网络或其他游戏。表现层位于 `game-surfaces/badminton`，仅消费公开 View。
- 客户端仅提交 `CONTROL` 或 `RESIGN`，不选择位置、命中、计分、actor 或 tick。
- Setup 固化首发顺序和目标比分；左侧首发，得分者续发。下一局复用完整设置，双方分别准备。
- 首版显式为 `record-only`；不得注册 Replay entrypoint 或暗示玩家可播放回放。
