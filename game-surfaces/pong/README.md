# 乒乓对战（Pong）Surface

独立 TypeScript + Phaser 画面，只依赖 Bridge JSON、渲染器和 schema 校验，不导入 Core、Next、Client Host、Protocol 或 Game Server。规则见 [GAME_SPEC](../../games/pong/GAME_SPEC.md)，通用开发与发布步骤见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。

```sh
pnpm --filter @online-game-hub/pong-surface dev
```

`setup/` 和 `play/` 是独立 HTML entrypoint；可在 Workbench 注入公开 fixture。所有支持的规则版本均为 record-only，不发布 Replay entrypoint。artifact 版本与支持范围以 [surface.config.json](./surface.config.json) 为准，View 按 exact gameVersion 解析。

## 画面与输入

Setup 提交左右站位和 1–9 分目标 intent。DOM/SVG 示意左右球拍与居中球，摘要只使用已确认投影，不预示发球方向。权限、过期、规则拒绝与连接失败显示中文提示；提交中防止重复操作，重连或新局清理等待状态，更新视图时保留有效焦点和滚动位置。手机横竖屏可滚动查看全部说明，操作目标至少 44px。

Play 提交方向或平台确认后的投降 intent。800×400 逻辑场地使用 2:1 FIT，保留容器内安全留白和可辨识的四边边界；比分和结果来自服务器。

准备期隐藏球，以中线对应侧的 24×20 实心粗箭头提示水平方向，不显示竖直角度；中心为 `(400 ± 24, 100)`，颜色与透明度同边框，无白边。新规则的公开 120 tick 倒计时每 30 tick 切换显隐，依次为“显示、消失、显示、消失、发球”；reduced motion 常亮至准备结束。历史准备期按对应版本显示，旧无准备期 View 不补造倒计时。

动画仅由 projected tick 驱动，重连不重新开始本地计时。持续方向输入的确认不重写连接提示，设置与投降保留确认反馈。终局摘要只提供 viewer 胜负、最终比分和原因。

## 验证

独立 model/scene/contract tests 覆盖 exact View、历史模式、箭头显隐、reduced-motion 和 intent；浏览器验证 canvas 非空、桌面/手机与跨缩放 FIT、键盘、倒计时重连和输入确认期间 DOM 稳定。权威计分与 replay 由 Core/integration 验证。

影响产物的修改提升 surfaceVersion，运行本包 `artifact:lock` 并同步 deployment 摘要；普通 build 只读锁。完整检查按 [TESTING.md](../../docs/TESTING.md) 执行。
