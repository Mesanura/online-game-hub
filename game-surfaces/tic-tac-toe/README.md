# Tic-Tac-Toe Game Surface

井字棋的浏览器表现层。它只依赖 Bridge JSON 契约，不导入游戏 Core、Next、Web Host 或 Game Server，可独立运行：

```text
pnpm --filter @online-game-hub/tic-tac-toe-surface dev
pnpm --filter @online-game-hub/tic-tac-toe-surface typecheck
pnpm --filter @online-game-hub/tic-tac-toe-surface test
pnpm --filter @online-game-hub/tic-tac-toe-surface build
pnpm --filter @online-game-hub/tic-tac-toe-surface contract-test
```

`setup/`、`play/` 和 `replay/` 是独立 HTML entrypoint，共用响应式 React renderer。开发服务器可作为 Surface Workbench 的目标 URL；Workbench 注入 projected fixtures 与平台状态，不需要启动 Next 或 Game Server。

普通构建只读取并验证 `surface.lock.json`，不会更新摘要。改变任何会影响 `dist` 的源码时，先提升 `surface.config.json` 中的 `surfaceVersion`，再显式执行：

```text
pnpm --filter @online-game-hub/tic-tac-toe-surface artifact:lock
```

同一 `surfaceVersion` 下内容发生变化时，更新锁命令和 CI 构建都会拒绝继续。
