# 坦克迷战约束

修改前阅读 [GAME_SPEC.md](./GAME_SPEC.md) 并遵守根 [AGENTS.md](../../AGENTS.md)。

- Core 为确定性整数模拟；物理、地图、碰撞顺序、寻路和 RNG 消费均受规则版本约束，历史实现与 golden 保持冻结。
- 输入仅为 MOVE/FIRE/RESIGN，按 manifest 的 events 策略保留同 tick 射击，不在平台加入坦克规则分支。
- `pathfinding` 由本游戏独立拥有，只使用已审计主入口；库升级或路径选择变化须评估 replay 兼容。
- 一场 Match 的多个计分小局属于同一 canonical record；record-only 不开放玩家回放。
- SVG 画面位于 [game-surfaces/tank-maze](../../game-surfaces/tank-maze/README.md)，只消费公开 View，不运行权威物理或寻路。
