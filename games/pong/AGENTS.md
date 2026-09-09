# Pong 约束

- 当前 `pong@1.2.0` 固定使用 60 Hz、整数坐标、120 tick 发球准备期与有上限的逐次球拍反弹加速；具体数值以 GAME_SPEC 为准。场地、速度、碰撞顺序、发球时序、RNG 消费顺序或输入解释变化必须评估新的 `gameVersion`。历史 `1.0.0` 与 `1.1.0` 的 Core、类型和常量保持冻结，继续支持服务端 exact 记录校验。
- Pong 所有受支持版本均为 `record-only`，保留比赛记录、账户战绩与内部 verifier，不提供玩家 Replay Surface 或播放 API；回放产品等待后续重新设计。
- Core 只处理已由服务器映射到 stable slot 的输入。客户端不得提交位置、速度、分数、碰撞、Outcome 或 tick。
- 同 tick 输入按 manifest 对应的 `players` 顺序应用。上下边界先于球拍碰撞，球拍碰撞先于出界得分。
- Phaser 只存在于独立 `game-surfaces/pong`，不得进入 manifest、Core、server runtime 或 replay verifier。
