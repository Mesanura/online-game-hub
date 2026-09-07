# Pong 规则

当前 `pong@1.2.0` 是双人、60 Hz、服务器权威的实时游戏。场地逻辑尺寸为 `800000 × 400000` 整数单位；左、右玩家各控制一块竖直球拍。方向输入为上 `-1`、静止 `0`、下 `1`，未收到新方向时沿用上一方向。球拍每 tick 移动 `7000` 单位，比旧版本增加 40%，仍夹紧在场地内。

每 tick 先按稳定 slot 顺序应用输入并移动、夹紧球拍，然后移动球。碰撞固定按上/下场地边界、当前运动方向上的球拍、左右得分线处理。球拍反弹按命中点调整方向，并将反弹前的欧氏总速率向下取整后增加 `500`，上限为 `16000` 单位/tick；新方向归一化到该速率后，两轴分量按绝对值向下取整。这样从边缘回球切换至中央回球也不会在达到上限前降速，State 始终保存整数位置与速度。上下边界反弹不加速，出界后对方得一分；未达到目标分数时使用 replay RNG 依次选择新球的水平和竖直方向，并从场地中心以初始水平 `6000`、竖直 `3000` 单位/tick 发球，清除上一回合的加速。默认目标分数为 3，可配置为 1–9。

开局及每次未终局得分后的发球均先进入 120 tick（2 秒）准备期：球保持中心位置和预定速度，服务端每 tick 递减 `serveTicksRemaining`，期间球拍方向和投降输入照常生效，不移动球、不判碰撞或得分、不额外消费 RNG。计数归零后下一个 tick 首次移动球。公开 View 的 `serve` 为剩余 tick 和水平/竖直方向（各为 `-1 | 1`）；无待发球或已终局时为 `null`。旧 `1.0.0` 不含该字段并继续立即发球，旧 `1.1.0` 保留 210 tick 准备期和旧速度；旧 Core、RNG 和 golden 记录保留 exact resolver，不改变 Replay Format V1 或网络协议。已有房间保持创建时的规则版本，新房间采用 `1.2.0`。

任一玩家可提交严格 `{ "type": "RESIGN" }` 投降输入。比分达标产生 `SCORE` 胜局，投降产生 `RESIGNATION` 胜局；终局不再推进 simulation。公开 View 只含场地、球拍、球、比分、tick、玩家方位、发球提示与 Outcome，不含 RNG seed 或 authoritative input log。

Round Setup 由 Pong 自己定义：新房间必须由 owner 选择 `OWNER | NON_OWNER | RANDOM` 先手/方位顺序，`targetScore` 首阶段仍取当前默认值而不开放编辑。`RANDOM` 只消费独立 Setup RNG；Gameplay 继续获得新的独立 seed。下一局从上一局完整 finalized setup 初始化，复用实际 LEFT/RIGHT 顺序和 `targetScore`，不重新随机，并由两位玩家分别重新 ready。

独立 `pong@surfaceVersion 1.2.0` 使用 Bridge V2 承载三个规则版本的 Setup 与 Phaser Play，按 exact gameVersion 校验公开 View。Play 始终保留 800×400 逻辑场地、2:1 FIT、容器内安全留白和可辨识的四边边界。准备期隐藏球，以中线对应一侧的 24×20 实心粗箭头提示水平方向，不显示竖直角度；箭头中心为 `(400 ± 24, 100)`，与场地边框使用相同颜色及透明度，无白边。新版每 30 tick 切换显隐，严格为“显示、消失、显示、消失、发球”，包括首次显示在内仅闪烁两次；reduced motion 保持箭头常亮至准备结束。旧 `1.1.0` 活跃房间保持原倒计时相位。动画只取决于 projected 倒计时，重连不会重新开始本地计时。方向输入等待确认时连接提示保持稳定；设置和投降仍保留确认反馈。completed Play View 的结果摘要只包含 viewer 胜负、最终比分和终局原因。

Pong 的玩家回放暂时取消，等待后续重新设计。`1.0.0`、`1.1.0` 和 `1.2.0` 均显式声明 `record-only`，历史战绩不再显示播放入口，已登录参赛者的玩家 replay API 返回 `409 PLAYER_PLAYBACK_NOT_SUPPORTED`，Surface 不再发布 replay entrypoint。服务端 canonical journal、比赛归档、账户战绩、exact verifier 和所有历史 golden fixtures 保留；这次能力调整不删除已保存记录，也不更改其规则或数据格式。
