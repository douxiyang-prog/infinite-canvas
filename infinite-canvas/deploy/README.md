# Ubuntu 镜像部署

这套部署只需要运行配置，不需要在 Ubuntu 上保存源码或安装 Bun：

```text
deploy/
├── .env
├── docker-compose.yml
├── docker-compose.external-mysql.yml
├── MAINTENANCE.md
└── README.md
```

默认配置会用 Docker 启动前端、API 和 MySQL；使用现有 MySQL 时则只启动前端和 API。

部署完成后的启停、日志、更新、备份和故障排查见 [维护手册](./MAINTENANCE.md)。

## 替换公司名称和 Logo

管理员登录后，从右上角账号菜单进入「管理 → 全局管理」，可以直接修改公司名称并上传 Logo。支持 PNG、JPEG、WebP，Logo 最大 2 MB；保存后登录页、首页和顶部导航会立即更新。

`.env` 中的以下配置作为数据库尚未设置品牌时的默认值：

```dotenv
COMPANY_NAME=你的公司名称
COMPANY_LOGO_URL=/brand/logo.svg
```

本地 Logo 放在 `deploy/brand/` 目录中，文件名需要与 `COMPANY_LOGO_URL` 一致。也可以填写完整的 `https://` 图片地址。

修改 `.env` 后重建前端容器即可生效，不需要重新构建镜像：

```bash
sudo docker compose -f docker-compose.external-mysql.yml up -d --force-recreate app
```

## 1. 在本机构建镜像

把代码推送到 `douxiyang-prog/infinite-canvas` 的 `main` 分支。GitHub Actions 会自动构建：

```text
ghcr.io/douxiyang-prog/infinite-canvas:latest
ghcr.io/douxiyang-prog/infinite-canvas-api:latest
```

也可以在 GitHub 仓库的 **Actions → Build Canvas deployment images → Run workflow** 中手动运行。

首次使用时，如果 GitHub Packages 中的镜像不是公开状态，可以在 Ubuntu 上登录：

```bash
echo "你的_GITHUB_TOKEN" | docker login ghcr.io -u douxiyang-prog --password-stdin
```

该 Token 需要 `read:packages` 权限。

## 2. 上传运行文件

在 Windows 本机的仓库根目录执行：

```powershell
scp .\infinite-canvas\deploy\docker-compose.yml lynn@192.168.1.68:/opt/infinite-canvas-deploy/
scp .\infinite-canvas\deploy\.env.example lynn@192.168.1.68:/opt/infinite-canvas-deploy/.env
```

如果目标目录不存在，先在 Ubuntu 上创建：

```bash
sudo mkdir -p /opt/infinite-canvas-deploy
sudo chown "$USER":"$USER" /opt/infinite-canvas-deploy
```

## 3. 配置并启动

在 Ubuntu 上编辑配置：

```bash
cd /opt/infinite-canvas-deploy
nano .env
```

必须修改两个数据库密码和初始管理员密码。可以使用以下命令生成随机密码：

```bash
openssl rand -hex 24
```

拉取镜像并启动全部服务：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

打开：

```text
http://192.168.1.68:3000
```

## 日常操作

查看日志：

```bash
docker compose logs -f
```

更新到最新镜像：

```bash
docker compose pull
docker compose up -d
```

停止服务：

```bash
docker compose down
```

`docker compose down` 不会删除数据库；只有显式执行 `docker compose down -v` 才会删除 MySQL 数据卷。画布、素材和生成记录仍保存在用户浏览器本地。

## 使用现有 MySQL

如果 Ubuntu 上已经有 MySQL，并且希望继续使用原来的数据库，不需要启动 Compose 中的 MySQL 容器。

先确认 MySQL 监听地址：

```bash
sudo ss -ltnp | grep ':3306'
```

API 在容器中运行，因此 MySQL 必须监听 `0.0.0.0:3306` 或服务器的局域网地址，不能只监听 `127.0.0.1:3306`。

在 MySQL 中创建或授权应用账号：

```sql
CREATE DATABASE IF NOT EXISTS infinite_canvas
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'infinite_canvas'@'%'
  IDENTIFIED BY '将这里替换为强密码';
GRANT ALL PRIVILEGES ON infinite_canvas.* TO 'infinite_canvas'@'%';
FLUSH PRIVILEGES;
```

编辑 `.env`，填写现有 MySQL 的局域网地址，并删除不需要的 `MYSQL_ROOT_PASSWORD`：

```dotenv
MYSQL_HOST=192.168.1.68
MYSQL_PORT=3306
MYSQL_DATABASE=infinite_canvas
MYSQL_USER=infinite_canvas
MYSQL_PASSWORD=将这里替换为同一个强密码
```

使用外部 MySQL 配置启动：

```bash
docker compose -f docker-compose.external-mysql.yml pull
docker compose -f docker-compose.external-mysql.yml up -d
docker compose -f docker-compose.external-mysql.yml ps
```

如果 MySQL 本身就是 Docker 容器，更安全的做法是让 API 容器和 MySQL 容器加入同一个 Docker 网络，并将 `MYSQL_HOST` 设置为 MySQL 的服务名，而不是开放宿主机的 `3306` 端口。
