# Connect Four Game Surface

Setup 用七列六行示意解释红黄棋、下沉落子和四连获胜，展示已确认的顺序。 选择与摘要使用服务器投影；待确认时阻止重复提交，权限、过期与连接失败分别显示中文提示。原生控件支持键盘和可见焦点，快照更新保留有效焦点及滚动位置，手机横竖屏可在设置卡片内滚动。重新对局保留上一局实际设置与顺序。

独立的四子棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Connect Four Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/connect-four-surface dev`
- `pnpm --filter @online-game-hub/connect-four-surface test`
- `pnpm --filter @online-game-hub/connect-four-surface build`
- `pnpm --filter @online-game-hub/connect-four-surface contract-test`

可通过 Surface Workbench 注入 `connect-four@1.0.0` 或 `1.1.0` 的 Setup/Play/Replay fixture 独立调试。

Play/Replay 严格校验公开投影，包括棋盘、轮次和结果中的玩家引用。游戏规则版本与 Surface 制品版本独立；发布与摘要锁更新见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。
