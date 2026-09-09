# 仓库开发工具

本目录拥有面向开发者、只在 workspace 中运行的仓库 CLI。仓库质量门禁本身仍由 `tooling/repository-check` 拥有。

## `tools/create-game`

`@online-game-hub/create-game` 同时生成回合制游戏与独立 Surface 的开发草稿，使用纯 TypeScript Core、V6 Setup、Bridge V2 与 Vite。草稿能通过仓库检查，但不进入游戏目录或发布制品；首版不生成 realtime 骨架。

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

CLI 拒绝绝对路径、路径分隔符、`.`/`..`、空段、大小写不稳定形式、Windows 设备名，以及 `api`、`games`、`node_modules`、`src`、`tests` 等仓库保留名称。它检查整个 workspace（包括 `game-surfaces`）中的两个包名、manifest gameId 与推导符号冲突。`sample-game` 推导为 `sampleGameManifest`、`sampleGameDefinition`、`sampleGameSetupDefinition`；`a-1` 与 `a1` 因符号相同而冲突。已有 `@online-game-hub/sample-game-surface` 也会阻止同名 Surface 草稿生成。

### 生成内容与写入边界

成功创建时仅生成：

- `games/<game-id>`：`/manifest`、`/core`、`/setup` 对应的可编译空模块，TypeScript 配置、规则草案、开发约束与正式接入清单；
- `game-surfaces/<game-id>`：只依赖 Bridge 的 TypeScript/Vite 包，独立配置与明确标记未实现的 Setup/Play 静态页；
- 两个包的测试说明文件：保留未来测试与 golden 的位置，不生成虚假测试或空通过的测试命令；
- workspace 固定 pnpm 以 `--lockfile-only --offline --ignore-scripts --no-frozen-lockfile` 更新的两个 `pnpm-lock.yaml` importer。

游戏包提供 `build/typecheck`，Surface 另提供 `dev`。生成后运行 `pnpm install --frozen-lockfile` 链接新增依赖，再用 `pnpm --filter @online-game-hub/<game-id>-surface dev` 访问 `/setup/` 或 `/play/`。占位页没有房间连接与可提交的操作。

Surface 显式声明 `onlineGameHub.surfaceArtifact: false`，普通 build 只运行 Vite，不生成制品 manifest 或摘要锁；发布工具跳过该草稿。仓库检查通过只说明草稿结构有效，不代表满足正式接入条件。

写入仅限两个目标目录与 lockfile。生成器不修改 catalog、server/deployment registry、registry dependencies、Next 配置或 Dockerfile。所有目标先完成预检；两个目录、模板文件与两个 importer 完整一致时，重复运行成功且零写入。残缺目标、用户修改、目标或其模板路径中的链接、已有登记或命名冲突均拒绝写入。失败只删除本次创建的目录，并恢复本轮 lockfile 写入；预检后发现的其他写入会保留并报告。

程序接口 `CreateGameResult` 保留 `status`、`gameId`、`packageName`、`gameDirectory`、`changedFiles`，并增加 `surfacePackageName`、`surfaceDirectory`。`deriveGameSymbols` 提供 manifest/Core/Setup 命名，不再提供 Client 命名。格式化依赖由 create-game 持有，复用仓库固定的 Prettier 版本，保证生成文件符合根格式规则。

### 正式接入

生成器不猜测 title、description、Config、人数、规则版本或 replay capabilities。完成游戏自己的规则、Core、Setup、Surface 与真实测试后，按生成 README 的清单定义 Surface 版本、入口和制品配置，将发布标记切换为 `true`，补齐 finalize build、artifact lock 与 contract 脚本并生成锁。

随后显式添加 registry dependencies、catalog、exact Core/Setup resolver 与 deployment Surface 映射，按实际导入需要调整 Next `transpilePackages`。Dockerfile 的依赖安装阶段也需添加两个新包的 `package.json` COPY。没有自动注册或发布命令。

正式接入必须满足 [Game Plugin](../docs/GAME_PLUGIN_SPEC.md)、[Game Surface](../docs/GAME_SURFACE_SPEC.md) 与 [测试矩阵](../docs/TESTING.md)，包括 unit、golden、contract、权威 integration、临时 PostgreSQL 和浏览器验证。
