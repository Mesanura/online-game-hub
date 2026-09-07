# Pong Game Surface

Pong 的独立浏览器表现层。它使用 TypeScript + Phaser，只依赖 Bridge JSON 契约、渲染器和 schema 校验器，不导入游戏 Core、Next、Web Host、Protocol 或 Game Server。

```text
pnpm --filter @online-game-hub/pong-surface dev
pnpm --filter @online-game-hub/pong-surface typecheck
pnpm --filter @online-game-hub/pong-surface test
pnpm --filter @online-game-hub/pong-surface build
pnpm --filter @online-game-hub/pong-surface contract-test
```

`setup/`、`play/` 和 `replay/` 是独立 HTML entrypoint。Setup 只提交发球方规则 intent；Play 的 800×400 逻辑画布使用 Phaser `FIT`，仅消费 projected View 并提交方向 intent；Replay 复用同一渲染器但保持只读。

Surface `1.1.0` 同时支持规则 `1.0.0` 与 `1.1.0`，按 exact 版本解析 View。新版发球箭头仅使用服务器公开倒计时闪烁三次，reduced motion 常亮；旧版回放保持立即发球。连续方向输入的确认不改变连接状态文案，设置与投降仍显示确认状态。

普通构建只读取并验证 `surface.lock.json`，不会更新摘要。改变任何影响 `dist` 的源码时，先提升 `surface.config.json` 中的 `surfaceVersion`，再显式执行：

```text
pnpm --filter @online-game-hub/pong-surface artifact:lock
```
