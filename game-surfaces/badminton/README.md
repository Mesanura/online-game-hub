# 火柴人羽毛球 Surface

原创球场、人物和球拍由 Phaser 绘制，只消费 Bridge V2 公开 View。规则见 [GAME_SPEC](../../games/badminton/GAME_SPEC.md)，开发、Workbench、摘要锁和发布步骤见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。

```sh
pnpm --filter @online-game-hub/badminton-surface dev
```

Setup/Play 各有独立入口，全部支持版本为 record-only，不提供 Replay。artifact 支持范围以 [surface.config.json](./surface.config.json) 为准；严格按 exact 规则版本解析 View/Input 和网高，旧自动发球版本不发送 serve。Workbench 可使用 [公开 play fixture](./tests/fixtures/play.json)。

## 操作与布局

Setup 的三种比分选项分别显示封顶分数，已确认摘要与轻量球场示意解释领先两分、封顶获胜与首发站位。发球提示遵循 [规则版本说明](../../games/badminton/GAME_SPEC.md#setup投影与版本)。投影更新保留有效键盘焦点和滚动位置；提交中禁止重复操作，拒绝后继续显示服务器已确认选择，并区分权限、过期与连接失败。断线和新局清理等待状态。

A/D 或左右键移动，W/上键/空格起跳，S 手动发球，J 高远球、K 扣杀、L 吊球。触屏支持多指组合；blur、visibilitychange、pointercancel、lostpointercapture、断线和 dispose 清除操作。持续按住每 150ms 刷新，快速发球请求保持至权威起手确认；投降期间停止其他输入，避免同 tick 覆盖。

画布为 1000×600，保持 5:3 FIT，比分与控制位于画布外。左侧 ↑ 起跳居中在 ←／→ 上方；右侧两行依次为发球／高远球、扣杀／吊球。旧自动发球版本隐藏发球，将高远球居中。横屏控制分置球场两侧，竖屏在球场下方左右并排；按钮默认 56px，窄屏可缩至 48px，并预留安全区与平台全屏控件空间。布局更新不改变多指、起跳边沿或发球确认机制。

脚底、影子、落点、发球线与双立柱球网共用投影，活动跑道位于 y=541，网顶与各版本 Core 几何对齐。人物约 128px 高，站立后腿伸直、前膝微弯；拍杆至拍头中心 52px，拍网长 50px。左右上下手方向镜像，拍头按权威接触点对齐。

## 插值、动画与音效

只有同一回合、同一阶段的连续公开快照做显示插值，持球移动/跳跃也适用；触球转折经过公开接触点。重新发球、重连和终局直接收敛，同 tick 快照不重启插值。`presentation.ts` 拥有骨架、插值、粒子与音效事件；静态球场按几何缓存，文字纹理避免逐帧重建。

黄绿色粒子每 75ms 发射，最小间距 16px、寿命 420ms、最多 8 个，带轻微离散偏移；重连、换球和终局清理。reduced-motion 关闭粒子、残影、步态与位置插值，保留必要击球姿态。

`audio.ts` 在首次用户交互时预生成噪声，仅按权威动作/触球播放并去重，不请求外部素材。空挥没有击球声，恢复页面不补播旧声音；圆角按钮支持鼠标和键盘切换静音，以 aria-pressed 表达状态。终局以中文纯文本摘要交给平台 HUD。

## 验证

独立 tests/contract 覆盖各版本公开 schema、发球 latch、动作/接触点、几何、粒子清理和音效去重；浏览器覆盖键盘、真实多指、取消/失焦释放、布局、reconnect、计分终局和 record-only 权限。完整矩阵见 [TESTING.md](../../docs/TESTING.md)。
