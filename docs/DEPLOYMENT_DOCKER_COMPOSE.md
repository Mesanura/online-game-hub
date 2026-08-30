# Docker Compose 单机部署

本文说明如何在一台机器上使用 Docker Compose 运行 Web、Game Server 和 PostgreSQL。该部署保持当前 V1 单实例边界：active room 仍在 Game Server 内存中，服务重启会终止 waiting/active 对局；已完成的 Match、replay 和 history 由 PostgreSQL 持久化。

## 服务拓扑

| Compose 服务  | 运行内容                                       | 默认宿主地址            | 就绪条件                               |
| ------------- | ---------------------------------------------- | ----------------------- | -------------------------------------- |
| `postgres`    | PostgreSQL 17.6                                | `127.0.0.1:5432`        | `pg_isready` 成功                      |
| `migrate`     | 现有 `@online-game-hub/database` migration CLI | 不暴露端口              | PostgreSQL healthy 后执行并以 `0` 退出 |
| `game-server` | Colyseus HTTP、matchmaking 和 WebSocket        | `http://localhost:2567` | `GET /health` 返回成功                 |
| `web`         | Next.js standalone production server           | `http://localhost:3000` | 首页返回成功                           |

`web` 和 `game-server` 使用 non-root Node 用户运行。CI 从同一个多阶段 Dockerfile 构建并向 Docker Hub 发布 Web、Game Server 和 database migrator 镜像；最终镜像只包含各服务的生产运行文件。部署主机无需 Node.js、pnpm 或项目源码。PostgreSQL 数据写入默认位于 `./data/postgres` 的宿主目录，便于直接备份和迁移。

浏览器直接访问 `GAME_SERVER_PUBLIC_URL`，不会经过 Next.js WebSocket 代理。该值必须是浏览器可访问的宿主地址，不能写成 Docker 内部的 `game-server` hostname。容器内部只有 PostgreSQL 连接使用 `postgres` 服务名。

## 前置要求

- Bash、curl、tar、awk、od 和常用 POSIX 工具；
- 可用的 Docker Engine；
- 通过 `docker compose` 调用的 Docker Compose plugin；
- 能够拉取 `.env` 指定的 Online Game Hub 镜像与 `postgres:17.6-alpine3.22`；
- 默认宿主端口可用，或已在 `.env` 中覆盖。

先确认运行环境：

```bash
docker version
docker compose version
docker info >/dev/null
```

下文使用 POSIX shell 命令示例，但部署不依赖特定宿主操作系统、桌面管理工具或源码目录布局。`docker info` 必须能够连接预期的 Docker daemon。

## 自动准备新机器

在希望保存项目的父目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Mesanura/online-game-hub/main/docker-deploy.sh | bash
cd online-game-hub
docker compose up -d
```

脚本只下载指定 GitHub ref 的 `docker-compose.yml` 和 `.env.example`；随后生成独立的 PostgreSQL、guest session 和 Game Server ticket 凭证，写入权限为 `0600` 的 `.env`，创建权限为 `0700` 的 `data/postgres`，并运行 `docker compose config`。完成时会在终端显示生成的凭证；请立即保存到受控的密码管理工具中。脚本只准备文件，不会自行启动服务，`docker compose up -d` 会直接拉取已发布镜像。

默认目标目录是当前目录下的 `online-game-hub`，且必须为空。可在运行 Bash 时覆盖源码 ref、目标目录或仓库，例如：

```bash
curl -fsSL https://raw.githubusercontent.com/Mesanura/online-game-hub/main/docker-deploy.sh | \
  ONLINE_GAME_HUB_REF=v1.0.0 \
  ONLINE_GAME_HUB_IMAGE_TAG=v1.0.0 \
  ONLINE_GAME_HUB_DIR=/srv/online-game-hub \
  bash
```

`ONLINE_GAME_HUB_IMAGE_NAMESPACE` 可覆盖默认 Docker Hub namespace `mesanura`。正式部署建议把脚本 URL、`ONLINE_GAME_HUB_REF` 和 `ONLINE_GAME_HUB_IMAGE_TAG` 同时固定到同一个已审查的版本 tag，而不是长期跟随 `main`/`latest`。目标父目录必须允许当前用户写入。

## 配置 `.env`

自动准备脚本已生成 `.env`，无需再次复制。手动部署时进入仓库并复制示例：

```bash
cd /path/to/online-game-hub
cp .env.example .env
```

至少替换以下三个占位值：

- `POSTGRES_PASSWORD`：使用 URL-safe 密码，因为 Compose 会把它嵌入 PostgreSQL URL；
- `GUEST_SESSION_SECRET`：Web guest cookie 的独立密钥，至少 32 bytes；
- `GAME_SERVER_TICKET_SECRET`：Web 与 Game Server 共享的 ticket 密钥，至少 32 bytes，不能与 guest secret 相同。

`DOCKER_IMAGE_NAMESPACE` 与 `DOCKER_IMAGE_TAG` 决定三个应用镜像的来源。默认使用 `mesanura/*:latest`；固定发布版本时应把 tag 改为对应的 `v*` tag。若镜像仓库是 private，启动前还必须先执行 `docker login`，一键匿名部署则要求三个仓库公开可拉取。

手动部署还需创建 PostgreSQL 数据目录：

```bash
mkdir -p ./data/postgres
chmod 700 ./data ./data/postgres
```

可使用 OpenSSL 生成示例值：

```bash
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
```

不要提交 `.env`。仓库只提交不含真实 credential 的 `.env.example`，Compose 在三个敏感变量缺失时 fail closed。

默认配置把端口绑定到 `127.0.0.1`，适合仅从部署主机访问的单机环境。生产构建镜像不等同于公网 TLS 配置：本地 loopback HTTP 使用 `APP_ENV=development` 和 `GUEST_COOKIE_SECURE=false`。对公网部署时必须在 Compose 外提供 TLS 终止，并同时设置：

```dotenv
APP_ENV=production
HOST_BIND_ADDRESS=0.0.0.0
WEB_PUBLIC_ORIGIN=https://games.example.com
GAME_SERVER_PUBLIC_URL=https://game-server.example.com
GUEST_COOKIE_SECURE=true
```

`WEB_PUBLIC_ORIGIN` 必须精确出现在 Game Server CORS allowlist 中；`GAME_SERVER_PUBLIC_URL` 必须指向浏览器实际访问的 HTTP(S)/WebSocket 入口。若修改 `WEB_PORT` 或 `GAME_SERVER_PORT`，也要同步修改这两个公开地址。

## 拉取与启动

先检查插值后的配置，再拉取并启动：

```bash
docker compose config
docker compose pull
docker compose up -d --wait
docker compose ps -a
docker compose logs --tail=200
```

`migrate` 显示 `Exited (0)` 是正常状态。它在 PostgreSQL healthy 后调用仓库现有 migration CLI；Game Server 和 Web 只在 migration 成功后启动。为覆盖整体 `docker compose restart` 时 PostgreSQL 与一次性任务并发恢复的短暂竞态，migrate 最多失败重试 5 次；实际 migration 错误仍会稳定失败并阻止应用启动。应用本身不会隐式创建或修改 schema。

日常最短启动命令是：

```bash
cd /path/to/online-game-hub
docker compose up -d
```

## 查看、停止与重建

查看状态和日志：

```bash
docker compose ps -a
docker compose logs --tail=200
docker compose logs -f web game-server postgres
```

重启现有容器并等待 healthcheck：

```bash
docker compose restart
docker compose ps -a
docker compose up -d --wait
docker compose ps -a
```

Compose 的 `restart` 命令本身不重新评估 `depends_on`；紧接着执行 `up -d --wait` 可以重新应用依赖条件并等待所有长期服务 healthy。

停止但保留容器：

```bash
docker compose stop
```

停止并删除容器和网络，但保留 PostgreSQL 数据目录：

```bash
docker compose down
```

拉取当前 `.env` 指定 tag 的最新镜像并重建容器：

```bash
docker compose pull
docker compose up -d --force-recreate --wait
```

只更新一个服务可使用 `docker compose pull web` 或 `docker compose pull game-server`，随后执行 `docker compose up -d --no-deps --force-recreate web` 或对应服务名。migration 与 schema 变化仍应通过完整 `docker compose up -d --wait` 应用依赖顺序。

## 从源码构建镜像

仓库中的 `docker-compose.build.yml` 是维护者使用的本地 overlay，不由快速部署脚本下载。在完整源码 checkout 中可运行：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --wait
```

overlay 只把三个已发布应用镜像替换为本地 Dockerfile targets；PostgreSQL、migration 顺序、healthcheck、端口和数据目录都继续复用生产 Compose。

## Docker Hub 镜像发布

`.github/workflows/ci.yml` 的 `publish-images` job 只在 `main` 或 `v*` tag 的 push 通过完整 `verify` job 后运行。它使用 Docker 官方 GitHub Actions、Buildx 和 QEMU，从现有 Dockerfile targets 构建 `linux/amd64`/`linux/arm64` 镜像并推送：

- `mesanura/online-game-hub-web`；
- `mesanura/online-game-hub-game-server`；
- `mesanura/online-game-hub-database-migrator`。

默认分支发布 `latest` 和 `sha-<short-sha>`；`v*` Git tag 发布同名版本 tag 和 `sha-<short-sha>`。发布前在 GitHub repository settings 中配置：

- Actions secret `DOCKERHUB_USERNAME`：有目标 namespace push 权限的 Docker Hub 用户；
- Actions secret `DOCKERHUB_TOKEN`：最小 read/write scope 的 access token，不使用账号密码；
- 可选 Actions variable `DOCKERHUB_NAMESPACE`：目标 namespace，缺省为 `mesanura`。

Docker Hub 中必须预先创建或允许 token 创建上述三个 repository。要支持脚本匿名一键部署，应将它们设为 public；若 namespace 不是 `mesanura`，还要通过脚本的 `ONLINE_GAME_HUB_IMAGE_NAMESPACE` 或生成后 `.env` 的 `DOCKER_IMAGE_NAMESPACE` 指向实际位置。

## 数据持久化与清理

PostgreSQL 数据默认位于部署目录下的 `./data/postgres`。可通过 `.env` 的 `POSTGRES_DATA_DIR` 改为其他绝对或相对路径；相对路径从 `docker-compose.yml` 所在目录解析。官方 PostgreSQL entrypoint 会把目录改为容器内 postgres UID 所有且限制权限，因此普通宿主用户可能不能直接读取。默认路径可通过同版本容器安全备份：

```bash
docker compose stop postgres
docker run --rm \
  -v "$(pwd)/data/postgres:/source:ro" \
  -v "$(pwd):/backup" \
  postgres:17.6-alpine3.22 \
  tar -czf /backup/postgres-data-backup.tar.gz -C /source .
docker compose start postgres
```

迁移时在 Compose 停止状态下，用同版本容器把备份解压到新机器配置的 `POSTGRES_DATA_DIR`，再启动 Compose。PostgreSQL 主版本必须与 `docker-compose.yml` 固定的版本兼容。若修改了 `POSTGRES_DATA_DIR`，备份命令中的宿主 source path 也必须同步修改并核对绝对路径。

`docker compose down` 不删除该宿主目录；重新 `up` 时 PostgreSQL 会复用原数据。可以在完成一局后记录行数，再执行 `down`/`up` 并比较：

```bash
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) from matches;" \
  -c "select count(*) from replays;" \
  -c "select count(*) from replay_actions;"'

docker compose down
docker compose up -d --wait

docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) from matches;" \
  -c "select count(*) from replays;" \
  -c "select count(*) from replay_actions;"'
```

`docker compose down -v` 不会删除 bind-mounted 数据目录。只有明确要永久清空本地数据库，并确认当前目录是该部署目录时，才执行：

```bash
docker compose down
test -f ./docker-compose.yml
docker run --rm \
  -v "$(pwd)/data:/data" \
  postgres:17.6-alpine3.22 \
  sh -c 'rm -rf -- /data/postgres'
```

最后一条命令以容器 root 权限删除默认数据目录中的全部 Match、replay、history 与 migration 数据，无法通过 Compose 恢复。若 `POSTGRES_DATA_DIR` 已被修改，应先核对实际绝对路径，不要照抄默认清理命令。

## 验证服务

在部署主机验证 Web、Game Server 和 PostgreSQL：

```bash
curl -fsS http://localhost:3000/ >/dev/null
curl -fsS http://localhost:2567/health
docker compose exec -T postgres sh -lc \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "select count(*) as applied_migrations from drizzle.__drizzle_migrations;"'
```

预期结果：Web 返回 HTTP 200；Game Server 返回 `{"status":"ok"}`；PostgreSQL 接受连接；migration 表至少包含 checked-in migration。

从能够访问 Web 公开地址的浏览器打开 `http://localhost:3000/games/tic-tac-toe`：

1. 在普通窗口创建房间，页面应显示“已连接”和 8 位房间码；
2. 在无痕窗口打开邀请链接，两边应变为“对局进行中”；
3. 完成一局，双方 revision 应同步且 history 出现 completed Match；
4. 在浏览器开发者工具的 Network/WS 中确认连接目标是 `ws://localhost:2567`，而不是 Docker hostname。

也可用四子棋重复同样流程。该验证同时覆盖 ticket API、matchmaking HTTP、CORS、浏览器公开地址和 WebSocket。

## 完整验收清单

每次发布部署配置时，在部署主机依次执行：

```bash
docker version
docker compose version
docker compose config
docker compose pull
docker compose up -d --wait
docker compose ps -a
docker compose logs --tail=200
docker compose restart
docker compose ps -a
docker compose up -d --wait
docker compose down
docker compose up -d --wait
docker compose ps -a
```

完成浏览器 WebSocket 流程和持久化行数对比后，使用 `docker compose down` 停止验收栈。该命令保留 `POSTGRES_DATA_DIR`。

## 常见故障

### 无法连接 Docker daemon

运行 `docker context ls` 和 `docker info`，确认当前 context 指向预期 daemon，并确认当前用户有访问 Docker socket 或远程 daemon 的权限。

### 拉取 Docker Hub 超时

确认 Docker daemon 能访问 registry；daemon 的代理配置可能独立于当前 shell 环境。更新代理或 registry mirror 后重启 daemon，再运行 `docker compose pull` 验证。若返回 denied/not found，核对 `DOCKER_IMAGE_NAMESPACE`、`DOCKER_IMAGE_TAG`、仓库可见性和 Docker Hub 登录状态。不要通过改成未固定版本的镜像规避网络问题。

### 端口已占用

修改 `.env` 中的宿主端口，例如 `POSTGRES_PORT=55432`。修改 Web/Game Server 宿主端口时必须同步 `WEB_PUBLIC_ORIGIN` 和 `GAME_SERVER_PUBLIC_URL`。可使用宿主系统提供的端口检查工具（例如 `ss`、`lsof` 或 `netstat`）查找占用。

### migration 失败

检查 `docker compose logs migrate postgres`。确认 PostgreSQL healthy、credential 一致，并且 `migrate` 最终为 `Exited (0)`。不要在容器入口中绕过或复制 migration 逻辑。

### Web 能打开但房间无法连接

依次检查：

- `GAME_SERVER_PUBLIC_URL` 是浏览器可访问的宿主 URL，不是 `http://game-server:2567`；
- `WEB_PUBLIC_ORIGIN` 与浏览器地址的 scheme、hostname、port 完全相同；
- Web 与 Game Server 的 ticket issuer/secret 完全一致；
- `curl http://localhost:2567/health` 成功；
- 浏览器控制台没有 mixed-content 或 CORS 错误。

### 本地 HTTP 配置被拒绝

`APP_ENV=production` 会强制 HTTPS origin、HTTPS Game Server public URL 和 Secure cookie。本地 loopback 验收应使用示例中的 `APP_ENV=development`；公网环境应正确配置 TLS，而不是放宽生产校验。

### Linux 权限、换行或大小写错误

容器使用 Linux userspace。仓库 `.gitattributes` 将文本固定为 LF，容器没有额外 shell entrypoint；Node 直接启动已编译入口。若新增脚本，必须使用 LF、设置可执行位，并确保容器内引用的路径大小写正确。
