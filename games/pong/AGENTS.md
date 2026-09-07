# Pong 约束

- 当前 `pong@1.1.0` 固定使用 60 Hz、整数坐标与 210 tick 发球准备期；场地、速度、碰撞顺序、发球时序、RNG 消费顺序或输入解释变化必须评估新的 `gameVersion`。历史 `1.0.0` Core 与相关类型、常量保持冻结，继续支持立即发球的旧回放。
- Core 只处理已由服务器映射到 stable slot 的输入。客户端不得提交位置、速度、分数、碰撞、Outcome 或 tick。
- 同 tick 输入按 manifest 对应的 `players` 顺序应用。上下边界先于球拍碰撞，球拍碰撞先于出界得分。
- Phaser 只存在于 legacy `src/client` 或独立 `game-surfaces/pong`，不得进入 manifest、Core、server runtime 或 replay verifier。
