# 中国跳棋 Surface

Setup 的六营地示意标出占用、本人营地、对角目标、指定首位和逆时针顺序，仅使用六个示意锚点，不生成第二套棋盘几何。人数不符、未选营地和首位营地无人参与可同时显示；提交和拒绝都保持服务器确认的选择，营地冲突、权限、过期与连接失败分别解释。原生控件至少 44px，快照更新保留有效焦点和卡片滚动位置。

中国跳棋的独立 Setup、Play 与 Replay 画面。从仓库根运行 `pnpm --filter @online-game-hub/chinese-checkers-surface dev` 即可启动；无需 Next 或 Game Server 的验证、Workbench 与发布流程见 [Game Surface 规范](../../docs/GAME_SURFACE_SPEC.md)。

Surface 只依赖 Game Surface Bridge 与本地投影 schema，不导入游戏 Core、React、Next、WebSocket、ticket、seed 或原始 State。Setup intent 不携带 actor；Play intent 只提交 `MOVE_PIECE(from,to)` 或平台确认后的 `RESIGN`。

Play 与 Replay 只呈现服务器投影的 `legalMoves`、排名和 Outcome，不在浏览器中搜索跳跃路径或推导权威结果。

`surfaceVersion 1.1.2` 精确支持规则 `1.0.0` 和 `1.1.0`。Setup 只提供“指定首位”和“随机首位”，指定首位可选择全部六个营地；营地名称从北开始顺时针显示 1–6 号。新版完全消费 View 的逐格 `geometry`：13 行六芒星、73 格、180 条等距连线；旧版 View 使用冻结编号表，保留原 162 条连线。详见 [游戏规则与版本说明](../../games/chinese-checkers/GAME_SPEC.md)。桌面等比例适配，触屏棋位至少 44px，空间不足时由棋盘容器滚动。

`tests/fixtures/initial-view-<gameVersion>.json` 是从对应 Core 的 `projectView` 取得的公开双人初始视图，不含 State、seed 或 canonical replay。它们用于独立验证 schema、版本隔离和布局；完整网站验收位于 `tooling/e2e/tests/chinese-checkers-vertical-slice.spec.ts`。
