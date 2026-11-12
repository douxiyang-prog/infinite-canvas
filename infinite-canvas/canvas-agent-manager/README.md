# Canvas Agent Manager

Windows 桌面管理器，用于启动、停止和重启 Infinite Canvas Agent。

## 功能

- 内置 Canvas Agent，不要求用户另外安装 Node.js 或执行 npm 命令。
- 启动、停止和重启子进程。
- 显示 Local URL、Connect token、端口和后端模式。
- 显示 Agent 实时日志并遮蔽 Token、`sk-` Key。
- 登录 Windows 后自动启动。
- 异常退出后自动重启。
- 关闭窗口时最小化到系统托盘。
- 配置 Canvas 网站地址并一键打开；打开时会自动注入本机 Agent URL 和临时连接 Token。
- 首次启动时检测并接管占用端口的旧 Canvas Agent。

## 开发

```powershell
npm install
npm start
```

开发模式使用 `../canvas-agent` 的构建产物。运行前先确保 Canvas Agent 已构建。

## 打包

```powershell
npm run dist:lite   # 精简版（npm run dist 等同于 dist:lite）
npm run dist:full   # 完整版
```

两个版本使用同一个应用 ID，可以互相覆盖安装，安装包分别命名为 `canvas-agent-manager-<版本>-lite-setup.exe` 和 `canvas-agent-manager-<版本>-full-setup.exe`：

- **精简版**：只内置火山原生 API 与 Canvas 渠道（约 18 MB、4 千多个依赖文件），安装很快。DeepSeek Harness 与 Codex 是 `canvas-agent` 的可选依赖，精简版不包含；选择 DSH 时会自动回退到 Canvas 渠道。
- **完整版**：额外内置 DeepSeek Harness 与 Codex（约 1.2 GB、8 万个文件），安装较慢。

构建脚本会：

1. 构建 `canvas-agent`。
2. 打包 Agent 并安装其生产依赖到 `resources/agent`（精简版使用 `--omit=optional`，并校验不含 DSH/Codex）。
3. 构建 Electron 主进程。
4. 生成 Windows NSIS 安装包到 `release/`。

## 升级

只分发一个 Windows 安装器。以后发布新版时提升 `canvas-agent-manager/package.json` 的版本号并重新生成安装器；用户直接运行新的 `setup.exe` 即可覆盖升级，不需要版本检测、更新清单或额外服务器。

安装包是当前 Windows 用户级安装。每个用户电脑安装一次；多个 Canvas 标签页可以共用同一个本机 Agent，但当前版本不支持多台电脑共用一个 Agent 实例。
