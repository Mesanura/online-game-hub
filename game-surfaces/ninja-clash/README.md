# 像素忍战 Surface 1.0.2

独立 Phaser Setup/Play，通过 Bridge V2 消费 ninja-clash 1.0.0 的公开投影，record-only。规则见 [GAME_SPEC](../../games/ninja-clash/GAME_SPEC.md)。

## 操作与表现

A/D 或左右移动，Space 跳跃，J 攻击，K/Shift 滑行；长按动作键不重复触发。触屏使用左侧左右方向区及右侧跳跃/攻击/滑行三个多指按钮。按下任何操作解锁声音，可单独静音；失焦、断线和销毁停止声音与清理输入。倒计时操作不进入下一回合。

人物按脚底中心对齐，基础动作 26×23 帧，hit1 使用三帧 40×24 帧；按双倍像素绘制，使素材中约 12 像素高的角色与 24 像素受击框对齐。配色、编号及脚下标记绑定 stable slots。画面最近邻采样、固定全场镜头，死亡后旁观。减少动态效果关闭残影和闪动；无敌以常亮轮廓表达。Setup 使用服务器确认设置，提交期间禁用配置，拒绝与过期不自动重发。

## 素材

`assets/ninja` 来自用户提供的 2DNinja，`assets/environment` 来自 Sci-Fi Starter Pack（MarcoPG）。只复制本游戏实际使用资源，保留后者 README 许可；打包进游戏 artifact，不提供独立素材下载或素材包再分发。

## 开发与验证

从仓库根运行 `pnpm --filter @online-game-hub/ninja-clash-surface dev`；使用 Workbench 的公开 fixture 和对应 Setup/Play 入口。运行该包 test、typecheck、artifact:lock、contract-test，然后按 [测试策略](../../docs/TESTING.md) 完成 Surface verify/publish 与真实浏览器验证。
