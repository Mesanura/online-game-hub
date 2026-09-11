# Hex Game Surface

Setup 示意区分蓝方的右上／左下目标边和红方的左上／右下目标边，解释蓝方先手与无平局。 选择与摘要使用服务器投影；待确认时阻止重复提交，权限、过期与连接失败分别显示中文提示。原生控件支持键盘和可见焦点，快照更新保留有效焦点及滚动位置，手机横竖屏可在设置卡片内滚动。重新对局保留上一局实际设置与顺序。

独立的六贯棋 Setup、Play 与 Replay 表现层。它只依赖 Game Surface Bridge 与本地 projected View schema，不导入 Hex Core、React/Next Host、Protocol、WebSocket、ticket、seed 或 raw State。

- `pnpm --filter @online-game-hub/hex-surface dev`
- `pnpm --filter @online-game-hub/hex-surface test`
- `pnpm --filter @online-game-hub/hex-surface build`
- `pnpm --filter @online-game-hub/hex-surface contract-test`

可通过 Surface Workbench 注入 `hex@1.0.0` 的 Setup/Play/Replay fixture 独立调试。Surface 只呈现服务器投影的 BLUE/RED 角色与 canonical winning path，不自行判断连接或 Outcome。
