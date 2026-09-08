# 火柴人羽毛球 Surface

原创的晴日球场、火柴人和球拍由 Phaser 绘制。仅消费 Bridge V2 公开 View，没有本地物理、socket、Core 导入或外部素材请求。Setup 与 Play 各有独立入口；首版 `record-only` 不提供 Replay。

```text
pnpm --filter @online-game-hub/badminton-surface dev
pnpm --filter @online-game-hub/badminton-surface typecheck
pnpm --filter @online-game-hub/badminton-surface test
pnpm --filter @online-game-hub/badminton-surface build
pnpm --filter @online-game-hub/badminton-surface contract-test
```

可在 Surface Workbench 中加载 `/setup/` 或 `/play/` 并使用 `tests/fixtures/play.json` 的公开 payload。画布为 `1000×600`，保持 5:3 FIT，比分与控制位于画布外。桌面、平板、手机横竖屏均提供至少 44px 的按钮。

A/D 或左右方向键移动，W/上方向键/空格起跳，S 手动发球，J 高远球、K 扣杀、L 吊球；触屏支持多指同时移动、起跳和挥拍。blur、visibilitychange、pointercancel、lostpointercapture、断线与 dispose 清除操作；持续按住时每 150ms 刷新输入。快速发球请求保持至权威起手确认，投降期间停止其他输入，避免同 tick 覆盖投降。

只有同一回合、同一阶段且连续的公开快照进行显示插值，包含持球移动与跳跃；触球转折经过公开接触点。重新发球、重连和终局立即收敛。reduced-motion 关闭粒子拖尾、摆腿、残影和位置插值。终局摘要由本 Surface 以中文纯文本提交给平台 HUD。

Surface `1.2.1` exact 支持 `badminton@1.0.0`/`1.1.0`/`1.2.0`，按版本严格解析 View/Input 和网高；旧版保留自动发球。脚底、影子、落点、发球线与双立柱球网共用投影。`presentation.ts` 负责骨架、插值、稀疏黄绿色粒子与音效事件；人物缩小、后腿伸直，球拍加长。`audio.ts` 在首次用户交互预生成噪声，圆角立体按钮切换静音。静态球场缓存、文字纹理避免逐帧更新，同 tick 状态保持插值进度；不发起外部素材请求。

内容更改后提升 `surfaceVersion`，再运行 `pnpm --filter @online-game-hub/badminton-surface artifact:lock` 并同步 exact deployment 摘要；普通 build 不修改锁。
