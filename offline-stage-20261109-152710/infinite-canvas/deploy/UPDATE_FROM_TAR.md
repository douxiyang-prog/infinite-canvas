# 使用 TAR 自动升级

`update-canvas-from-tar.sh` 用于从完整构建源码包更新 Canvas。脚本会备份当前镜像、强制重建前端和 API、验证镜像内代码、重启容器并执行健康检查；启动后检查失败时会自动回滚。

## 前提

- 服务器已安装 Docker 和 Docker Compose。
- 部署目录为 `/opt/infinite-canvas-deploy`。
- `.env` 已配置数据库、`SETTINGS_ENCRYPTION_KEY` 和 `CANVAS_PUBLIC_BASE_URL`。
- 更新包必须是 **完整构建源码包**，文件名通常以 `build-src` 结尾。`fix` 增量包不能单独用于构建。

## 安装脚本

将脚本放到部署目录：

```bash
sudo cp update-canvas-from-tar.sh /opt/infinite-canvas-deploy/
sudo chmod 755 /opt/infinite-canvas-deploy/update-canvas-from-tar.sh
```

## 每次升级

上传新的完整构建 tar，然后执行：

```bash
cd /opt/infinite-canvas-deploy

sudo bash update-canvas-from-tar.sh
```

脚本会暂停并提示：

```text
更新包路径:
```

此时输入或粘贴 TAR 文件名、相对路径或完整路径，按回车后开始自动升级。路径包含空格时可以直接粘贴，也可以自行加双引号。

也可以在命令后直接传参，适合无人值守执行：

```bash
sudo bash update-canvas-from-tar.sh \
  /tmp/seedance-canvas-build-src-20261104-r5.tar.gz
```

推荐交互输入，方便每次确认实际使用的更新包。

## 花生壳端口变化

如果外网端口变化，可以一次传入新地址：

```bash
sudo CANVAS_PUBLIC_BASE_URL_OVERRIDE=http://21ck25ls8690.vicp.fun:28623 \
  bash update-canvas-from-tar.sh \
  /tmp/seedance-canvas-build-src-20261104-r5.tar.gz
```

脚本会先备份 `.env`，再更新 `CANVAS_PUBLIC_BASE_URL`。

## 可配置变量

```bash
CANVAS_DEPLOY_DIR=/opt/infinite-canvas-deploy
CANVAS_COMPOSE_FILE=docker-compose.external-mysql.yml
CANVAS_BUILD_ROOT=/tmp/infinite-canvas-builds
CANVAS_PUBLIC_BASE_URL_OVERRIDE=
CANVAS_NO_CACHE=1
CANVAS_ROLLBACK_ON_FAILURE=1
```

示例：

```bash
sudo CANVAS_NO_CACHE=0 \
  bash update-canvas-from-tar.sh /tmp/new-canvas.tar.gz
```

## 脚本执行内容

1. 检查 tar 路径和压缩包目录结构。
2. 拒绝包含绝对路径或 `..` 的不安全压缩包。
3. 解压到 `/tmp/infinite-canvas-builds/update-*`。
4. 备份当前前端和 API 镜像。
5. 使用 `--no-cache` 构建前端和 API。
6. 检查新镜像中是否存在必要的更新标记。
7. 重建 `api` 和 `app` 容器。
8. 验证本机 `/api/health`。
9. 验证花生壳公网健康地址。
10. 验证签名文件接口返回 `403`。
11. 启动后检查失败时恢复备份镜像和容器。

## 手工回滚

脚本结束时会输出回滚标签，例如：

```text
ghcr.io/douxiyang-prog/infinite-canvas:backup-20261104-120000
ghcr.io/douxiyang-prog/infinite-canvas-api:backup-20261104-120000
```

手工回滚：

```bash
sudo docker tag \
  ghcr.io/douxiyang-prog/infinite-canvas:backup-20261104-120000 \
  ghcr.io/douxiyang-prog/infinite-canvas:latest

sudo docker tag \
  ghcr.io/douxiyang-prog/infinite-canvas-api:backup-20261104-120000 \
  ghcr.io/douxiyang-prog/infinite-canvas-api:latest

cd /opt/infinite-canvas-deploy
sudo docker compose -f docker-compose.external-mysql.yml \
  up -d --force-recreate api app
```

## 常见问题

### 提示不是完整构建源码

使用了 `fix` 增量包。改用文件名包含 `build-src` 的完整包。

### 构建后镜像仍是旧代码

确认当前目录包含 `Dockerfile`、`web/` 和 `server/`，并检查脚本输出的构建目录。不要从旧的解压目录执行构建。

### 公网健康检查失败

检查花生壳内网目标是否为 `192.168.1.68:3000`，外网端口是否变化，以及从公网能否打开 Canvas。

### 签名文件接口不是 403

API 镜像没有包含公网签名文件接口。确认使用的是包含 API 更新的完整构建包，并重新执行 `--no-cache` 构建。
