# Pong 规则

当前 `pong@1.1.0` 是双人、60 Hz、服务器权威的实时游戏。场地逻辑尺寸为 `800000 × 400000` 整数单位；左、右玩家各控制一块竖直球拍。方向输入为上 `-1`、静止 `0`、下 `1`，未收到新方向时沿用上一方向。

每 tick 先按稳定 slot 顺序应用输入并移动、夹紧球拍，然后移动球。碰撞固定按上/下场地边界、当前运动方向上的球拍、左右得分线处理。球拍反弹会按命中点以整数运算调整竖直速度。出界后对方得一分；未达到目标分数时使用 replay RNG 依次选择新球的水平和竖直方向并从场地中心发球。默认目标分数为 3，可配置为 1–9。

开局及每次未终局得分后的发球均先进入 210 tick（3.5 秒）准备期：球保持中心位置和预定速度，服务端每 tick 递减 `serveTicksRemaining`，期间球拍方向和投降输入照常生效，不移动球、不判碰撞或得分、不额外消费 RNG。计数归零后下一个 tick 首次移动球。公开 View 的 `serve` 为剩余 tick 和水平/竖直方向（各为 `-1 | 1`）；无待发球或已终局时为 `null`。旧 `1.0.0` 不含该字段并继续立即发球；旧 Core、RNG 和 golden replay 保留 exact resolver，不改变 Replay Format V1 或网络协议。

任一玩家可提交严格 `{ "type": "RESIGN" }` 投降输入。比分达标产生 `SCORE` 胜局，投降产生 `RESIGNATION` 胜局；终局不再推进 simulation。公开 View 只含场地、球拍、球、比分、tick、玩家方位、发球提示与 Outcome，不含 RNG seed 或 authoritative input log。

Round Setup 由 Pong 自己定义：新房间必须由 owner 选择 `OWNER | NON_OWNER | RANDOM` 先手/方位顺序，`targetScore` 首阶段仍取当前默认值而不开放编辑。`RANDOM` 只消费独立 Setup RNG；Gameplay 继续获得新的独立 seed。下一局从上一局完整 finalized setup 初始化，复用实际 LEFT/RIGHT 顺序和 `targetScore`，不重新随机，并由两位玩家分别重新 ready。

独立 `pong@surfaceVersion 1.1.0` 使用 Bridge V2 承载两个规则版本的 Setup、Phaser Play 与 Replay；按 exact gameVersion 校验公开 View。Play 始终保留 800×400 逻辑场地、2:1 FIT、容器内安全留白和可辨识的四边边界。准备期以中心小箭头替代球，指向服务端预定发球方向，每 30 tick 切换显隐，从可见开始完成三次消失再出现后发球；reduced motion 保持箭头常亮，但不缩短服务端准备期。动画只取决于 projected 倒计时，重连和回放不重新开始本地计时。方向输入等待确认时连接提示保持稳定；设置和投降仍保留确认反馈。completed Play View 的结果摘要只包含 viewer 胜负、最终比分和终局原因。
