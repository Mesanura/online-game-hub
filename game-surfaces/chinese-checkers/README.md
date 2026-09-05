# Chinese Checkers Surface

中国跳棋的独立 Setup、Play 与 Replay 画面。可使用 `pnpm dev`、`pnpm build`、`pnpm test` 和 `pnpm contract-test` 在不启动 Next 或游戏服务端的情况下开发与验证。

Surface 只依赖 Game Surface Bridge 与本地投影 schema，不导入游戏 Core、React、Next、WebSocket、ticket、seed 或原始 State。Setup intent 不携带 actor；Play intent 只提交 `MOVE_PIECE(from,to)`。

Play 与 Replay 只呈现服务器投影的 `legalMoves`、排名和 Outcome，不在浏览器中搜索跳跃路径或推导权威结果。
