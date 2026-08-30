#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

readonly DEFAULT_REPOSITORY="Mesanura/online-game-hub"
readonly DEFAULT_REF="main"

repository="${ONLINE_GAME_HUB_REPOSITORY:-${DEFAULT_REPOSITORY}}"
ref="${ONLINE_GAME_HUB_REF:-${DEFAULT_REF}}"
deploy_dir="${ONLINE_GAME_HUB_DIR:-${PWD}/online-game-hub}"
raw_base_url="${ONLINE_GAME_HUB_RAW_BASE_URL:-https://raw.githubusercontent.com/${repository}/${ref}}"

log() {
  printf '[online-game-hub] %s\n' "$*"
}

die() {
  printf '[online-game-hub] 错误：%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "未找到必需的命令：$1"
}

random_hex() {
  local byte_count="$1"
  local value

  value="$(od -An -N "${byte_count}" -tx1 /dev/urandom | tr -d '[:space:]')"
  [[ ${#value} -eq $((byte_count * 2)) ]] || die "生成安全随机值失败"
  printf '%s' "${value}"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local candidate="${work_dir}/env-${key}"

  if ! awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) exit 42 }
  ' "${deploy_dir}/.env" >"${candidate}"; then
    die ".env.example 中缺少 ${key}"
  fi

  mv -- "${candidate}" "${deploy_dir}/.env"
}

for command_name in awk curl docker od tr; do
  require_command "${command_name}"
done

[[ -r /dev/urandom ]] || die '/dev/urandom 不可读'
docker compose version >/dev/null 2>&1 || die '需要 Docker Compose V2（docker compose）'

if [[ -e "${deploy_dir}" ]]; then
  [[ -d "${deploy_dir}" ]] || die "部署路径已存在但不是目录：${deploy_dir}"
  shopt -s nullglob dotglob
  existing_entries=("${deploy_dir}"/*)
  shopt -u nullglob dotglob
  [[ ${#existing_entries[@]} -eq 0 ]] || die "部署目录必须为空：${deploy_dir}"
else
  mkdir -p -- "${deploy_dir}"
fi

deploy_dir="$(cd "${deploy_dir}" && pwd -P)"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "${work_dir}"' EXIT

log "正在从 ${repository}@${ref} 下载部署文件"
required_files=(docker-compose.yml .env.example)
for required_file in "${required_files[@]}"; do
  curl --fail --location --silent --show-error --retry 3 \
    --output "${work_dir}/${required_file}" \
    "${raw_base_url}/${required_file}"
  [[ -s "${work_dir}/${required_file}" ]] || die "下载的文件为空：${required_file}"
  mv -- "${work_dir}/${required_file}" "${deploy_dir}/${required_file}"
done
chmod 644 "${deploy_dir}/docker-compose.yml" "${deploy_dir}/.env.example"

postgres_password="$(random_hex 24)"
guest_session_secret="$(random_hex 32)"
game_server_ticket_secret="$(random_hex 32)"

cp -- "${deploy_dir}/.env.example" "${deploy_dir}/.env"
set_env_value POSTGRES_PASSWORD "${postgres_password}"
set_env_value GUEST_SESSION_SECRET "${guest_session_secret}"
set_env_value GAME_SERVER_TICKET_SECRET "${game_server_ticket_secret}"
if [[ -n "${ONLINE_GAME_HUB_IMAGE_NAMESPACE:-}" ]]; then
  set_env_value DOCKER_IMAGE_NAMESPACE "${ONLINE_GAME_HUB_IMAGE_NAMESPACE}"
fi
if [[ -n "${ONLINE_GAME_HUB_IMAGE_TAG:-}" ]]; then
  set_env_value DOCKER_IMAGE_TAG "${ONLINE_GAME_HUB_IMAGE_TAG}"
fi
chmod 600 "${deploy_dir}/.env"

mkdir -p -- "${deploy_dir}/data/postgres"
chmod 700 "${deploy_dir}/data" "${deploy_dir}/data/postgres"

log '正在验证生成的 Docker Compose 配置'
(
  cd "${deploy_dir}"
  docker compose config >/dev/null
)

printf '\n部署文件已准备就绪：%s\n' "${deploy_dir}"
printf 'PostgreSQL 数据目录：%s\n' "${deploy_dir}/data/postgres"
printf '\n生成的凭证（也已保存于 %s/.env）：\n' "${deploy_dir}"
printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
printf 'GUEST_SESSION_SECRET=%s\n' "${guest_session_secret}"
printf 'GAME_SERVER_TICKET_SECRET=%s\n' "${game_server_ticket_secret}"
printf '\n请妥善记录这些值。使用以下命令启动项目：\n'
printf '  cd %q\n' "${deploy_dir}"
printf '  docker compose up -d\n'
