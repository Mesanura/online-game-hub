# 坦克迷战 Surface

Setup 展示人数、目标分数、本人颜色和全部参与者颜色，解释多小局累计计分。人数调低后若超员，提示房主增容或等待玩家离开，不自动移除玩家；准备状态仍由服务器决定。选择、占用和摘要均取自投影，提交期间阻止重复操作，断线和迟到回执不会遗留 pending，拒绝后显示中文原因。卡片支持手机横竖屏滚动、44px 控件及更新时保留有效焦点。

独立 TypeScript + SVG Setup/Play 画面，消费 Bridge V2 projected View，不运行权威物理或寻路。规则与兼容性见 [GAME_SPEC](../../games/tank-maze/GAME_SPEC.md)，公共开发和发布流程见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。

```sh
pnpm --filter @online-game-hub/tank-maze-surface dev
```

artifact 与支持的规则版本见 [surface.config.json](./surface.config.json)。所有版本为 record-only，不提供 Replay entrypoint；账户战绩和服务器验证继续可用。

## 操作与表现

W/S 或上下键前进/后退，A/D 或左右键旋转，空格按次开火、不自动重复；触屏提供等价多指按钮。MOVE 每 150ms 续租，失焦或触控取消发送释放；Core 的输入租期处理无法送达的释放。Surface 不合并按次 FIRE，也不推断弹药命中。

灰色网格迷宫、彩色矢量坦克和编号辅助识别；五种道具使用居中的 40×40 SVG 图形。墙体缓存、动态节点复用，快照之间仅显示插值，重连或换图重置。

准备期在战场中心显示 3、2、1。击毁触发 220ms、最多 2px 的战场轻震，同批击毁合并，重复快照不重复触发；静态 HUD 不震动。Web Audio 在首次交互解锁，可静音并限制密集叠音；reduced-motion 关闭震动、烟尾与插值。

## 验证

独立 model/presentation/contract 检查严格 View/Input、版本兼容、图标中心、倒计时、轻震复位和 reduced-motion。真实八浏览器流程验证桌面/手机、键盘/多指、刷新重连、重新对局和归档；权威碰撞/寻路与多人日志由 Core/integration/golden 验证。完整门禁见 [TESTING.md](../../docs/TESTING.md)。
