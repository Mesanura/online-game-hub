# Pong Game Surface

Pong 的独立浏览器表现层。它使用 TypeScript + Phaser，只依赖 Bridge JSON 契约、渲染器和 schema 校验器，不导入游戏 Core、Next、Web Host、Protocol 或 Game Server。

```text
pnpm --filter @online-game-hub/pong-surface dev
pnpm --filter @online-game-hub/pong-surface typecheck
pnpm --filter @online-game-hub/pong-surface test
pnpm --filter @online-game-hub/pong-surface build
pnpm --filter @online-game-hub/pong-surface contract-test
```

`setup/` 和 `play/` 是独立 HTML entrypoint。Setup 只提交发球方规则 intent；Play 的 800×400 逻辑画布使用 Phaser `FIT`，仅消费 projected View 并提交方向 intent。玩家回放暂时取消，不再发布 `replay/` entrypoint。

Surface `1.2.0` 同时支持规则 `1.0.0`、`1.1.0` 与 `1.2.0`，按 exact 版本解析 View。新版发球提示为中线一侧水平朝外的小粗箭头，与边框同色且无描边；仅按服务器公开的 120 tick 倒计时“显示、消失、显示、消失”，reduced motion 常亮。旧活跃房间保持各自的发球时序。连续方向输入的确认不改变连接状态文案，设置与投降仍显示确认状态。

普通构建只读取并验证 `surface.lock.json`，不会更新摘要。改变任何影响 `dist` 的源码时，先提升 `surface.config.json` 中的 `surfaceVersion`，再显式执行：

```text
pnpm --filter @online-game-hub/pong-surface artifact:lock
```
