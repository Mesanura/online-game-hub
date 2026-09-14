# 像素炸弹人约束

- 修改前阅读本目录 GAME_SPEC.md，遵守根 AGENTS.md。
- Core/Setup 使用确定性纯 TypeScript；地图生成、整数移动、爆炸阻挡快照、同 tick 淘汰与 RNG 消费受 gameVersion 约束。
- 输入为 MOVE、PLACE_BOMB、RESIGN，沿用 events 交付；合法无效果放弹不排队补放。
- 隐藏道具、输入租期、炸弹穿出权限和 RNG 不进入 View。Surface 位于独立 workspace，只消费 Bridge。
- 地图与玩法定义属于本游戏；保持动态玩家集合及出生布局，不向平台加入游戏特例。
- 当前 1.1.0 每场 Match 为一局三命；历史 1.0.0 多小局实现独立冻结在 src/v1。两版按 exact gameVersion 重建；record-only 不提供玩家回放。
