# Infinite Canvas Windows Docker 安装指南

本文档适用于在纯 Windows 服务器上使用 Docker Desktop 部署一套全新的 Infinite Canvas 环境。

该部署包含：

- `infinite-canvas-windows-app`：React 前端和 Nginx。
- `infinite-canvas-windows-api`：Bun API。
- `infinite-canvas-windows-mysql`：MySQL 8.4。
- `infinite-canvas-windows-mysql-data`：独立 MySQL 命名卷。
- `deploy/windows/data/canvas/`：画布 JSON、输入素材和输出结果。

## 1. 环境要求

- Windows 10/11 或 Windows Server。
- Docker Desktop。
- Docker Desktop 必须切换到 **Linux containers** 模式。
- 建议至少 4 GB 可用内存和 20 GB 可用磁盘空间。
- 如果需要在局域网访问，需要放行前端端口，默认是 `3000`。

检查 Docker：

```powershell
docker version
docker compose version
```

两条命令都能正常返回版本号后再继续。

## 2. 进入部署目录

```powershell
cd C:\Users\lynn\Documents\GitHub\canvas\infinite-canvas\deploy\windows
```

确认目录中有：

```text
docker-compose.windows.yml
.env.windows.example
data/canvas/
```

## 3. 创建 Windows 环境配置

```powershell
Copy-Item .env.windows.example .env.windows
```

`.env.windows` 包含密码，不能上传到 Git，也不能发送给其他人。

## 4. 生成随机密钥

运行以下 PowerShell 代码三次，为数据库、管理员和配置加密分别生成不同的随机值：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
-join ($bytes | ForEach-Object { $_.ToString("x2") })
```

编辑配置：

```powershell
notepad .env.windows
```

至少修改：

```dotenv
MYSQL_PASSWORD=第一个随机值
MYSQL_ROOT_PASSWORD=第二个随机值
BOOTSTRAP_ADMIN_PASSWORD=第三个随机值
SETTINGS_ENCRYPTION_KEY=额外的第四组随机值
```

选择管理员用户名和显示名称：

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_DISPLAY_NAME=Admin
```

`SETTINGS_ENCRYPTION_KEY` 必须长期保存。修改或丢失后，已经加密保存的全局配置将无法解密。

## 5. 端口配置

默认访问端口：

```dotenv
APP_PORT=3000
```

如果 `3000` 已被占用，可改为：

```dotenv
APP_PORT=3001
```

容器内部仍然使用 `3000`，外部通过 `APP_PORT` 访问。

## 6. 构建并启动

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d --build
```

第一次启动需要下载 MySQL、Bun 和 Nginx 镜像，并构建前端和 API，时间取决于网络速度。

查看容器状态：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml ps
```

正常情况下三个服务都应处于运行状态，MySQL 应为 `healthy`。

检查 API：

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

返回：

```json
{"ok":true}
```

如果修改了 `APP_PORT`，地址也要同步修改。

## 7. 第一次登录

打开：

```text
http://localhost:3000
```

使用 `.env.windows` 中的配置登录：

```text
用户名：BOOTSTRAP_ADMIN_USERNAME
密码：BOOTSTRAP_ADMIN_PASSWORD
```

首次登录会进入系统初始化页面。

## 8. 初始化画布存储

初始化页面填写容器路径：

```text
/data/canvas/infinite-canvas
```

不要填写 Windows 路径，例如 `C:\...` 或 `X:\...`。

点击“检测路径”，必须全部通过：

- 独立挂载
- 目录存在或可以创建
- 可读写
- 可以初始化

然后点击“初始化存储”。

初始化完成后，Windows 宿主机上的实际位置是：

```text
C:\Users\lynn\Documents\GitHub\canvas\infinite-canvas\deploy\windows\data\canvas\infinite-canvas
```

目录结构：

```text
/data/canvas/infinite-canvas/
├── .infinite-canvas-storage
├── users/
└── .trash/
```

创建画布后，项目目录结构：

```text
users/{userId}/projects/{projectId}/
├── project.json
├── input/
└── output/
```

## 9. 数据位置

画布和媒体文件保存在：

```text
deploy/windows/data/canvas/
```

MySQL 数据保存在 Docker 命名卷：

```text
infinite-canvas-windows-mysql-data
```

查看 MySQL 卷位置：

```powershell
docker volume inspect infinite-canvas-windows-mysql-data
```

不要直接修改或移动 MySQL 卷中的文件。

## 10. 日常启停

停止容器但保留全部数据：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml down
```

重新启动：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d
```

查看日志：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml logs -f
```

只看 API 日志：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml logs -f api
```

## 11. 更新程序

更新源码后执行：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d --build
```

数据卷和 `data/canvas` 不会被删除。

## 12. 备份

至少备份以下两个位置：

1. `deploy/windows/data/canvas/`
2. Docker 卷 `infinite-canvas-windows-mysql-data`

画布目录可以直接使用 Windows 文件备份工具复制。MySQL 卷建议在停止 MySQL 容器后备份，或者使用 `mysqldump` 导出。

同时保存 `.env.windows`，尤其是 `SETTINGS_ENCRYPTION_KEY`。

## 13. 完全重置

以下命令会**永久删除 Windows 测试数据库卷**：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml down -v
```

该命令不会删除 `data/canvas/`。如果也要重新开始画布数据，请先确认目录内容，再手动清理。

不要在生产环境中执行该命令。

## 14. 局域网访问

默认只能通过本机访问：

```text
http://localhost:3000
```

如果需要局域网访问，以管理员身份打开 PowerShell，并放行端口：

```powershell
New-NetFirewallRule `
  -DisplayName "Infinite Canvas" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow
```

然后使用服务器 IP 访问，例如：

```text
http://192.168.1.x:3000
```

## 15. 常见问题

### Docker 提示 Linux 和 Windows 容器模式不匹配

在 Docker Desktop 系统托盘菜单中切换到 **Switch to Linux containers**。

### 3000 端口被占用

修改 `.env.windows`：

```dotenv
APP_PORT=3001
```

然后重新启动：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d
```

### API 无法连接 MySQL

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml ps
docker compose --env-file .env.windows -f docker-compose.windows.yml logs --tail=200 mysql
docker compose --env-file .env.windows -f docker-compose.windows.yml logs --tail=200 api
```

确认 `.env.windows` 中的 `MYSQL_HOST=mysql`，并确认 MySQL 状态为 `healthy`。

### 初始化提示目录不是独立挂载

确认使用的是 `/data/canvas/...` 容器路径，并检查：

```powershell
docker inspect infinite-canvas-windows-api `
  --format "{{range .Mounts}}{{println .Source `"->`" .Destination}}{{end}}"
```

应看到 `deploy/windows/data/canvas` 映射到 `/data/canvas`。

### 保存配置提示缺少加密密钥

在 `.env.windows` 中补充：

```dotenv
SETTINGS_ENCRYPTION_KEY=随机长密钥
```

然后重新创建 API：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d --force-recreate api
```
