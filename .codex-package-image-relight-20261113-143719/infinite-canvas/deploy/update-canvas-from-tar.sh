#!/usr/bin/env bash
set -Eeuo pipefail

# Usage:
#   sudo bash update-canvas-from-tar.sh /tmp/seedance-canvas-build-src.tar.gz
#
# Optional environment overrides:
#   CANVAS_DEPLOY_DIR=/opt/infinite-canvas-deploy
#   CANVAS_COMPOSE_FILE=docker-compose.external-mysql.yml
#   CANVAS_BUILD_ROOT=/tmp/infinite-canvas-builds
#   CANVAS_PUBLIC_BASE_URL_OVERRIDE=http://example.com:12345
#   CANVAS_NO_CACHE=1
#   CANVAS_APP_DOCKERFILE=Dockerfile
#   CANVAS_API_DOCKERFILE=server/Dockerfile

UPDATE_TAR="${1:-${CANVAS_UPDATE_TAR:-}}"
DEPLOY_DIR="${CANVAS_DEPLOY_DIR:-/opt/infinite-canvas-deploy}"
COMPOSE_FILE="${CANVAS_COMPOSE_FILE:-docker-compose.external-mysql.yml}"
BUILD_ROOT="${CANVAS_BUILD_ROOT:-/tmp/infinite-canvas-builds}"
APP_REPO="${CANVAS_APP_REPO:-ghcr.io/douxiyang-prog/infinite-canvas}"
API_REPO="${CANVAS_API_REPO:-ghcr.io/douxiyang-prog/infinite-canvas-api}"
HEALTH_URL="${CANVAS_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
FRONTEND_MARKER="${CANVAS_FRONTEND_MARKER:-reference_video}"
API_MARKER="${CANVAS_API_MARKER:-CANVAS_PUBLIC_BASE_URL}"
NO_CACHE="${CANVAS_NO_CACHE:-1}"
APP_DOCKERFILE="${CANVAS_APP_DOCKERFILE:-Dockerfile}"
API_DOCKERFILE="${CANVAS_API_DOCKERFILE:-server/Dockerfile}"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

die() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  sudo bash update-canvas-from-tar.sh <build-source.tar.gz>
  sudo bash update-canvas-from-tar.sh

The archive must be the full build source package containing:
  infinite-canvas/Dockerfile
  infinite-canvas/web
  infinite-canvas/server

Example:
  sudo bash update-canvas-from-tar.sh /tmp/seedance-canvas-build-src.tar.gz
EOF
}

if [[ "$UPDATE_TAR" == "-h" || "$UPDATE_TAR" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$UPDATE_TAR" ]]; then
  printf '\n请输入完整构建源码 TAR 的文件名或路径。\n'
  printf '例如：/tmp/seedance-canvas-build-src-20261104-r5.tar.gz\n\n'
  read -r -p "更新包路径: " UPDATE_TAR || true
  UPDATE_TAR="${UPDATE_TAR#\"}"
  UPDATE_TAR="${UPDATE_TAR%\"}"
  UPDATE_TAR="${UPDATE_TAR#\'}"
  UPDATE_TAR="${UPDATE_TAR%\'}"
fi

[[ -n "$UPDATE_TAR" ]] || die "未输入更新包路径"
[[ -f "$UPDATE_TAR" ]] || die "更新包不存在：$UPDATE_TAR"
[[ -d "$DEPLOY_DIR" ]] || die "部署目录不存在：$DEPLOY_DIR"
[[ -f "$DEPLOY_DIR/$COMPOSE_FILE" ]] || die "Compose 文件不存在：$DEPLOY_DIR/$COMPOSE_FILE"
[[ -f "$DEPLOY_DIR/.env" ]] || die "环境变量文件不存在：$DEPLOY_DIR/.env"

UPDATE_TAR="$(readlink -f "$UPDATE_TAR")"

if [[ "${EUID}" -eq 0 ]]; then
  DOCKER=(docker)
else
  DOCKER=(sudo docker)
fi

tar_members="$(tar -tf "$UPDATE_TAR")"
if grep -Eq '(^/|(^|/)\.\./)' <<< "$tar_members"; then
  die "更新包包含不安全路径"
fi
for required in \
  "infinite-canvas/Dockerfile" \
  "infinite-canvas/web/package.json" \
  "infinite-canvas/server/Dockerfile"; do
  grep -Fx "$required" <<< "$tar_members" >/dev/null ||
    die "更新包不是完整构建源码，缺少：$required"
done

mkdir -p "$BUILD_ROOT"
BUILD_DIR="$(mktemp -d "$BUILD_ROOT/update-$STAMP.XXXXXX")"
tar -xf "$UPDATE_TAR" -C "$BUILD_DIR"
SOURCE_DIR="$BUILD_DIR/infinite-canvas"
[[ -d "$SOURCE_DIR/web" && -d "$SOURCE_DIR/server" ]] ||
  die "解压后的源码目录结构不正确：$SOURCE_DIR"

log "更新包：$UPDATE_TAR"
log "构建目录：$SOURCE_DIR"

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp="${file}.tmp.${STAMP}"
  awk -v key="$key" -v value="$value" '
    BEGIN { written = 0 }
    index($0, key "=") == 1 {
      if (!written) {
        print key "=" value
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) print key "=" value
    }
  ' "$file" > "$temp"
  chmod --reference="$file" "$temp"
  mv "$temp" "$file"
}

if [[ -n "${CANVAS_PUBLIC_BASE_URL_OVERRIDE:-}" ]]; then
  cp -p "$DEPLOY_DIR/.env" "$DEPLOY_DIR/.env.backup-$STAMP"
  set_env_value "$DEPLOY_DIR/.env" "CANVAS_PUBLIC_BASE_URL" "$CANVAS_PUBLIC_BASE_URL_OVERRIDE"
  log "已更新 CANVAS_PUBLIC_BASE_URL"
fi

PUBLIC_BASE_URL="$(
  awk -F= '
    $1 == "CANVAS_PUBLIC_BASE_URL" {
      value = substr($0, index($0, "=") + 1)
      gsub(/\r/, "", value)
      gsub(/^"|"$/, "", value)
      print value
    }
  ' "$DEPLOY_DIR/.env" | tail -n 1
)"
[[ "$PUBLIC_BASE_URL" =~ ^https?:// ]] ||
  die "请在 $DEPLOY_DIR/.env 配置有效的 CANVAS_PUBLIC_BASE_URL"

APP_BACKUP=""
API_BACKUP=""
backup_image() {
  local repo="$1"
  local target="${repo}:backup-$STAMP"
  if "${DOCKER[@]}" image inspect "${repo}:latest" >/dev/null 2>&1; then
    "${DOCKER[@]}" tag "${repo}:latest" "$target"
    printf '%s\n' "$target"
  fi
}

APP_BACKUP="$(backup_image "$APP_REPO")"
API_BACKUP="$(backup_image "$API_REPO")"
NGINX_BACKUP=""

services_recreated=0
cleanup_on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    log "更新失败，构建目录保留在：$SOURCE_DIR"
  fi
  if [[ "$status" -ne 0 && "$services_recreated" -eq 1 && "${CANVAS_ROLLBACK_ON_FAILURE:-1}" == "1" ]]; then
    log "更新后检查失败，开始回滚"
    if [[ -n "$APP_BACKUP" ]]; then
      "${DOCKER[@]}" tag "$APP_BACKUP" "${APP_REPO}:latest"
    fi
    if [[ -n "$API_BACKUP" ]]; then
      "${DOCKER[@]}" tag "$API_BACKUP" "${API_REPO}:latest"
    fi
    if [[ -n "$NGINX_BACKUP" ]]; then
      cp -p "$NGINX_BACKUP" "$DEPLOY_DIR/nginx.conf"
      log "已恢复原部署 Nginx 配置"
    fi
    if [[ -n "$APP_BACKUP" || -n "$API_BACKUP" ]]; then
      (
        cd "$DEPLOY_DIR"
        "${DOCKER[@]}" compose -f "$COMPOSE_FILE" up -d --force-recreate api app
      ) || true
    fi
  fi
  exit "$status"
}
trap cleanup_on_exit EXIT

cd "$SOURCE_DIR"
[[ -f "web/src/services/api/video.ts" ]] || die "缺少前端视频请求源码"
[[ -f "server/src/config.ts" ]] || die "缺少 API 配置源码"

build_args=(build)
if [[ "$NO_CACHE" == "1" ]]; then
  build_args+=(--no-cache)
fi

log "构建前端镜像 ${APP_REPO}:latest"
"${DOCKER[@]}" "${build_args[@]}" \
  -t "${APP_REPO}:latest" \
  -f "$APP_DOCKERFILE" .

log "构建 API 镜像 ${API_REPO}:latest"
"${DOCKER[@]}" "${build_args[@]}" \
  -t "${API_REPO}:latest" \
  -f "$API_DOCKERFILE" ./server

log "验证新镜像包含必要代码"
"${DOCKER[@]}" run --rm -e "MARKER=$FRONTEND_MARKER" --entrypoint sh "${APP_REPO}:latest" \
  -c 'grep -R -F -q -- "$MARKER" /usr/share/nginx/html/assets'
"${DOCKER[@]}" run --rm -e "MARKER=$API_MARKER" --entrypoint sh "${API_REPO}:latest" \
  -c 'grep -R -F -q -- "$MARKER" /app/src'

if [[ -f "$SOURCE_DIR/deploy/nginx.conf" ]]; then
  log "验证部署 Nginx 配置"
  "${DOCKER[@]}" run --rm --add-host api:127.0.0.1 \
    -v "$SOURCE_DIR/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
    --entrypoint nginx "${APP_REPO}:latest" -t
  if [[ -f "$DEPLOY_DIR/nginx.conf" ]]; then
    NGINX_BACKUP="$DEPLOY_DIR/nginx.conf.backup-$STAMP"
    cp -p "$DEPLOY_DIR/nginx.conf" "$NGINX_BACKUP"
  fi
  install -m 0644 \
    "$SOURCE_DIR/deploy/nginx.conf" \
    "$DEPLOY_DIR/nginx.conf"
  log "已更新部署 Nginx 配置"
fi

log "重建 api 和 app 容器"
services_recreated=1
(
  cd "$DEPLOY_DIR"
  "${DOCKER[@]}" compose -f "$COMPOSE_FILE" up -d --force-recreate api app
)

log "等待健康检查"
healthy=0
for attempt in $(seq 1 30); do
  response="$(curl -sS --noproxy '*' --connect-timeout 3 --max-time 10 "$HEALTH_URL" 2>/dev/null || true)"
  if printf '%s' "$response" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" -eq 1 ]] || die "健康检查失败：$HEALTH_URL"

log "本机健康检查通过：$response"

PUBLIC_HEALTH="${PUBLIC_BASE_URL%/}/api/health"
public_response="$(curl -sS --noproxy '*' --connect-timeout 5 --max-time 15 "$PUBLIC_HEALTH" 2>/dev/null || true)"
if printf '%s' "$public_response" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
  log "公网健康检查通过：$PUBLIC_HEALTH"
else
  log "警告：公网健康检查未通过，请检查花生壳端口和映射：$PUBLIC_HEALTH"
fi

public_status="$(
  curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' \
    --connect-timeout 5 --max-time 15 \
    "${PUBLIC_BASE_URL%/}/api/public/files/video%3Ainvalid?token=v1.1.1.invalid" \
    2>/dev/null || true
)"
if [[ "$public_status" == "403" ]]; then
  log "签名文件接口检查通过"
else
  log "警告：签名文件接口返回 $public_status，预期 403"
fi

log "更新完成"
log "前端镜像：${APP_REPO}:latest"
log "API 镜像：${API_REPO}:latest"
log "回滚前端：${APP_BACKUP:-未创建}"
log "回滚 API：${API_BACKUP:-未创建}"
log "构建源码保留在：$SOURCE_DIR"
