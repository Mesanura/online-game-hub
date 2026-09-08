# 仓库开发工具

本目录拥有面向开发者、只在 workspace 中运行的仓库 CLI。仓库质量门禁本身仍由 `tooling/repository-check` 拥有。

## `tools/create-game`

`@online-game-hub/create-game` 生成 package 与显式登记骨架。当前模板仍基于早期回合制 Client Module，尚未支持 V6 Setup、独立 Surface 或 realtime；它不代表现行新游戏接入已经完成。

从 workspace root 使用 [package.json](../package.json) 固定的 pnpm 非交互运行：

```sh
pnpm create-game --game-id example-game
pnpm create-game --help
```

### 参数与退出码

- `--game-id <id>`：必填且只能出现一次；只接受以小写字母开头、由小写字母/数字和单个连字符组成的稳定 lowercase kebab-case。
- `--help`：打印稳定帮助文本，不读取或写入 workspace。
- 退出码 `0`：创建成功、同一输入幂等无变更，或显示帮助。
- 退出码 `1`：文件写入或固定 pnpm 的 lockfile-only 更新失败；CLI 会先尝试完整回滚，并打印只检查本轮目标路径的恢复提示。
- 退出码 `2`：参数、gameId、workspace 或冲突 preflight 失败；不会写入文件。

CLI 拒绝绝对路径、路径分隔符、`.`/`..`、空段、大小写不稳定形式、Windows 设备名，以及 `api`、`games`、`node_modules`、`src`、`tests` 等仓库保留名称。它还会检查 `@online-game-hub/<game-id>` workspace package、manifest gameId 和由 gameId 确定推导的 lower-camel export symbols 是否碰撞。例如 `sample-game` 固定推导为 `sampleGameManifest`、`sampleGameDefinition`、`sampleGameClientModule` 和 `loadSampleGameEntrypoint`；`a-1` 与 `a1` 因符号相同而冲突。

### 自动生成与登记

成功创建时仅生成：

- `games/<game-id>/package.json`，包含 `/manifest`、`/core`、`/client` public export map；
- `tsconfig.json`、`tsconfig.build.json`、`tests/tsconfig.json`；
- `src/core`、`src/client`、`tests/fixtures` 等必要目录；
- 明确标记“尚未达到 Definition of Done”的最小 `README.md`；
- `packages/game-registry/package.json` dependency；
- catalog manifest、lazy client loader、exact/current server definition 使用的显式 import/array entry；
- `apps/web/next.config.ts#transpilePackages`；
- 由 workspace root 固定 pnpm 以 `--lockfile-only --offline --ignore-scripts` 生成的 `pnpm-lock.yaml` importer。

所有登记继续是可见、可审查的静态条目，不扫描 `games/`，也不按目录约定在运行时发现插件。所有源文件和目标内容先完成全量 preflight，再开始写入。同一完整输入重复运行返回成功且零写入；已有文件内容冲突、只完成部分登记、重复登记或 symbol 碰撞都会 fail closed，生成器不会覆盖用户文件。pnpm 失败时会恢复本轮登记文件与原 lockfile，并且只删除本轮已确认由 CLI 创建的目标游戏目录。

### 不生成的内容

生成器不接受也不猜测 title、description、Config、人数或 replay capabilities；这些语义由游戏负责人定义。它不生成可玩的 Core、Setup、Surface、规则测试、golden 或纵切对局，也不登记 deployment artifact。

CLI 成功输出仍包含旧 Client Module/CSS 清单，不能作为当前实现方向。用于新游戏时，须调整生成的 legacy client 依赖与登记，补充 `/setup`、独立 Surface、exact deployment、显式 replay 模式和相应 tests；不要为满足旧清单把游戏 CSS 或 React 组件重新接入 Web。

现行完成条件以 [Game Plugin](../docs/GAME_PLUGIN_SPEC.md)、[Game Surface](../docs/GAME_SURFACE_SPEC.md) 和 [测试策略](../docs/TESTING.md) 为准。生成器本身的升级属于独立代码任务。
