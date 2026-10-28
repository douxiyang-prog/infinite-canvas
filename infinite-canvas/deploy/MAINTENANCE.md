# Infinite Canvas 维护手册

本文适用于当前 Ubuntu 部署方式：

- 前端和 API 使用本机 Docker 镜像。
- MySQL 使用 Ubuntu 上现有的数据库，不使用 Compose 内部 MySQL。
- 服务器只保留镜像、`.env` 和 Compose 配置，不保留源码。

## 目录与组成

```text
/opt/infinite-canvas-deploy/
├── .env
├── docker-compose.external-mysql.yml
├── docker-compose.yml
├── MAINTENANCE.md
└── README.md
```

必须使用 `docker-compose.external-mysql.yml`，不要误用 `docker-compose.yml`，否则会尝试启动一个新的 MySQL 容器。

运行关系：

```text
浏览器 :3000
    ↓
infinite-canvas（Nginx 前端容器）
    ↓ /api
infinite-canvas-api（API 容器）
    ↓ :3306
Ubuntu 现有 MySQL
```

## 日常检查

进入部署目录：

```bash
cd /opt/infinite-canvas-deploy
```

查看容器状态：

```bash
sudo docker compose -f docker-compose.external-mysql.yml ps
```

检查 API 和数据库连接：

```bash
curl http://127.0.0.1:3000/api/health
```

正常结果：

```json
{"ok":true}
```

访问地址：

```text
http://192.168.1.68:3000
```

## 启动与停止

启动或应用新配置：

```bash
sudo docker compose -f docker-compose.external-mysql.yml up -d
```

停止容器：

```bash
sudo docker compose -f docker-compose.external-mysql.yml stop
```

重新启动：

```bash
sudo docker compose -f docker-compose.external-mysql.yml restart app api
```

删除前端和 API 容器：

```bash
sudo docker compose -f docker-compose.external-mysql.yml down
```

`down` 不会删除 Docker 镜像，也不会删除外部 MySQL 数据。再次执行 `up -d` 即可恢复。

容器设置了 `restart: unless-stopped`。Ubuntu 重启后，只要 Docker 服务自动启动，Canvas 容器也会自动恢复。

## 查看日志

实时查看全部日志：

```bash
sudo docker compose -f docker-compose.external-mysql.yml logs -f
```

只看最近 200 行 API 日志：

```bash
sudo docker compose -f docker-compose.external-mysql.yml logs --tail=200 api
```

只看前端日志：

```bash
sudo docker compose -f docker-compose.external-mysql.yml logs --tail=200 app
```

## 修改运行配置

先备份当前配置：

```bash
cp .env .env.backup
chmod 600 .env .env.backup
```

编辑配置：

```bash
nano .env
```

配置修改后重建 API：

```bash
sudo docker compose -f docker-compose.external-mysql.yml up -d --force-recreate api
```

`.env` 包含数据库和管理员密码，不要上传到 Git，也不要通过公开渠道发送。

## 更新程序

当前没有 GHCR 镜像，更新时临时下载源码并重新构建。构建完成后可以删除源码。

创建临时目录：

```bash
mkdir -p /tmp/canvas-build
cd /tmp/canvas-build
```

下载最新源码：

```bash
curl -L https://github.com/douxiyang-prog/infinite-canvas/archive/refs/heads/main.tar.gz -o canvas.tar.gz
tar -xzf canvas.tar.gz
cd infinite-canvas-main/infinite-canvas
```

兼容旧版 Docker 构建器：

```bash
sed -i 's|RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache|RUN bun install|' Dockerfile
```

备份当前可运行镜像：

```bash
sudo docker save \
  ghcr.io/douxiyang-prog/infinite-canvas:latest \
  ghcr.io/douxiyang-prog/infinite-canvas-api:latest \
  -o /opt/infinite-canvas-images-backup.tar
```

构建新镜像：

```bash
sudo docker build -t ghcr.io/douxiyang-prog/infinite-canvas:latest -f Dockerfile .
sudo docker build -t ghcr.io/douxiyang-prog/infinite-canvas-api:latest -f server/Dockerfile ./server
```

重建容器：

```bash
cd /opt/infinite-canvas-deploy
sudo docker compose -f docker-compose.external-mysql.yml up -d --force-recreate
curl http://127.0.0.1:3000/api/health
```

确认页面、登录和 API 都正常后删除临时源码：

```bash
rm -rf -- /tmp/canvas-build
```

不要执行 `docker compose pull`，因为镜像只存在本机。

## 回滚镜像

从备份文件恢复镜像：

```bash
sudo docker load -i /opt/infinite-canvas-images-backup.tar
cd /opt/infinite-canvas-deploy
sudo docker compose -f docker-compose.external-mysql.yml up -d --force-recreate
```

## MySQL

数据库只保存用户和登录会话。画布、素材和生成记录保存在用户浏览器本地。

导出数据库：

```bash
mysqldump -h 192.168.1.68 -u infinite_canvas -p infinite_canvas \
  > /opt/infinite-canvas-mysql-$(date +%Y%m%d).sql
```

该命令会提示输入 `.env` 中的 `MYSQL_PASSWORD`。

API 容器目前通过 `172.19.%` 网段连接 MySQL。如果日志出现：

```text
Access denied for user 'infinite_canvas'@'172.x.x.x'
```

使用 MySQL 管理员账号补充对应网段授权，并保持密码与 `.env` 一致：

```sql
CREATE USER IF NOT EXISTS 'infinite_canvas'@'172.19.%'
  IDENTIFIED BY '与 .env 中 MYSQL_PASSWORD 相同的密码';
GRANT ALL PRIVILEGES ON infinite_canvas.* TO 'infinite_canvas'@'172.19.%';
FLUSH PRIVILEGES;
```

## 常见故障

前端返回 502：

```bash
sudo docker compose -f docker-compose.external-mysql.yml ps -a
sudo docker compose -f docker-compose.external-mysql.yml logs --tail=200 api
```

API 反复重启通常是 MySQL 无法连接。重点检查 `.env` 的地址、密码、数据库名，以及 MySQL 的 `172.19.%` 授权。

检查端口占用：

```bash
sudo ss -ltnp | grep -E ':(3000|3306)'
```

查看 Docker 磁盘占用：

```bash
sudo docker system df
```

不要执行 `docker system prune -a`，它会删除当前没有容器使用的 Canvas 镜像和备份基础镜像。
