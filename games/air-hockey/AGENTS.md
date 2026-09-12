# 气垫球约束

- `air-hockey@1.0.0` 使用 60 Hz 整数状态、归一化指针 intent 和扫掠圆碰撞。几何、速度、碰撞排序、量化、发球和输入有效期属于 replay 契约，改变重建结果须评估新 gameVersion。
- P1 始终为 Setup 固化的房主，蓝色；P2 橙色。客户端坐标只上下镜像，真实位置及碰撞由 Core 决定。
- 首球 P1 发球，此后失分方发球。等待时仅发球方有效接触能开球，整段发球 tick 忽略另一方；无自动发球、超时失分或自然阻力。
- Surface 位于独立包，只依赖 Bridge 与自身渲染栈；不从 Core 导入类型或实现。
- 仅 record-only，保留精确 verifier、账户比分与历史记录，不注册 Replay Surface。
