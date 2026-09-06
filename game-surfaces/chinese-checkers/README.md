# Chinese Checkers Surface

中国跳棋的独立 Setup、Play 与 Replay 画面。可使用 `pnpm dev`、`pnpm build`、`pnpm test` 和 `pnpm contract-test` 在不启动 Next 或游戏服务端的情况下开发与验证。

Surface 只依赖 Game Surface Bridge 与本地投影 schema，不导入游戏 Core、React、Next、WebSocket、ticket、seed 或原始 State。Setup intent 不携带 actor；Play intent 只提交 `MOVE_PIECE(from,to)` 或平台确认后的 `RESIGN`。

Play 与 Replay 只呈现服务器投影的 `legalMoves`、排名和 Outcome，不在浏览器中搜索跳跃路径或推导权威结果。

`surfaceVersion 1.1.0` 精确支持规则 `1.0.0` 和 `1.1.0`。新版完全消费 View 的逐格 `geometry`：13 行六芒星、73 格、180 条等距连线；旧版 View 使用冻结编号表，保留原 162 条连线。详见 [游戏规则与版本说明](../../games/chinese-checkers/GAME_SPEC.md)。桌面等比例适配，触屏棋位至少 44px，空间不足时由棋盘容器滚动。

`tests/fixtures/initial-view-<gameVersion>.json` 是从对应 Core 的 `projectView` 取得的公开双人初始视图，不含 State、seed 或 canonical replay。它们用于独立验证 schema、版本隔离和布局；完整网站验收位于 `tooling/e2e/tests/chinese-checkers-vertical-slice.spec.ts`。
