# Windows Docker 部署

完整安装步骤见 [INSTALL.md](./INSTALL.md)。

该目录用于在纯 Windows 服务器上通过 Docker Desktop 启动一套独立环境：

- 前端、API 和 MySQL 全部运行在 Docker。
- MySQL 使用独立的命名卷 `infinite-canvas-windows-mysql-data`。
- 画布文件保存在本目录下的 `data/canvas/`。
- 与 Linux 云端部署的数据和容器完全隔离。

## 前提

- 安装 Docker Desktop。
- 将 Docker Desktop 切换到 **Linux containers** 模式。
- 本目录中的源码构建依赖项目根目录下的 `Dockerfile`、`web/` 和 `server/`。

## 首次启动

在 PowerShell 中执行：

```powershell
cd C:\Users\lynn\Documents\GitHub\canvas\infinite-canvas\deploy\windows
Copy-Item .env.windows.example .env.windows
```

生成三个独立随机密码：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
-join ($bytes | ForEach-Object { $_.ToString("x2") })
```

编辑 `.env.windows`，至少替换：

```dotenv
MYSQL_PASSWORD=...
MYSQL_ROOT_PASSWORD=...
BOOTSTRAP_ADMIN_PASSWORD=...
SETTINGS_ENCRYPTION_KEY=...
```

`SETTINGS_ENCRYPTION_KEY` 必须长期保存。更换后，之前加密保存的全局配置将无法解密。

构建并启动：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d --build
docker compose --env-file .env.windows -f docker-compose.windows.yml ps
```

打开：

```text
http://localhost:3000
```

如果 3000 端口被占用，在 `.env.windows` 中修改：

```dotenv
APP_PORT=3001
```

## 初始化存储

管理员登录后会自动进入初始化页面，填写：

```text
/data/canvas/infinite-canvas
```

初始化后，宿主机文件位于：

```text
deploy/windows/data/canvas/infinite-canvas/
├── .infinite-canvas-storage
├── users/
└── .trash/
```

网页中填写的是容器路径 `/data/canvas/...`，不是 Windows 路径。

## 日常操作

查看状态：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml ps
```

查看日志：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml logs -f
```

停止服务但保留数据：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml down
```

重新启动：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml up -d
```

## 数据位置

画布和媒体：

```text
deploy/windows/data/canvas/
```

MySQL 数据：

```text
Docker named volume: infinite-canvas-windows-mysql-data
```

查看 MySQL 卷：

```powershell
docker volume inspect infinite-canvas-windows-mysql-data
```

## 完全重置

以下命令会永久删除 Windows 测试数据库，只能在确认不需要数据时执行：

```powershell
docker compose --env-file .env.windows -f docker-compose.windows.yml down -v
```

它不会自动删除 `data/canvas/`。如需彻底重来，请先确认目录内容，再手动处理该目录。
