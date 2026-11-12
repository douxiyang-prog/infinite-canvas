# Infinite Canvas Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 启动

```bash
npx -y @basketikun/canvas-agent@latest
```

带上 `@latest` 是因为 npx 会缓存已下载的版本，不加就可能一直运行旧版本。

需要排查连接、线程、Codex app-server 或工具调用问题时，可开启 Debug 模式：

```bash
npx -y @basketikun/canvas-agent@latest --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.infinite-canvas/logs/canvas-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、线程、turn、Codex app-server 和工具调用事件，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

在画布右上角点击 `Agent`，填入地址和 token 后连接。

Codex app 插件会读取启动输出里的 Local URL 和 Connect token，并直接打开画布网页地址；Canvas Agent 不负责生成画布打开 URL。

Canvas Agent 默认只监听 `127.0.0.1`。网页第一次带正确 token 连接后，Canvas Agent 会记录该网页 Origin；之后其他 Origin 不能复用这个本地 Agent，除非用户清理 `~/.infinite-canvas/canvas-agent.json` 里的 `origins`。

## DeepSeek Harness

Canvas Agent 默认使用内置的 DeepSeek Harness，不再要求用户另开 DSH 页面。运行时通过官方 `@deepseek-ai/dsh-sdk-client` 管理 DSH 子进程，并复用画布右侧的 Agent 对话、历史和模型选择。

右侧连接设置提供三种可切换后端：

- **火山原生 API**：直接把聊天请求发送到火山方舟 Agent Plan Messages API，响应增量实时转发到画布。
- **DeepSeek Harness**：启动本地 DSH 子进程，保留 Harness 的工具运行时、会话与模型路由能力。
- **Canvas 渠道**：读取当前用户在画布全局设置中可用的文本渠道，把该渠道的 Base URL、API Key 和模型仅发送给本机 Canvas Agent，并通过 OpenAI 兼容的 `/v1/chat/completions` 接口聊天。New API 的 `sk-...` 文本渠道可直接使用。

要求 Node.js `>=24.9.0`。DeepSeek Harness（`@deepseek-ai/dsh-*`）与 Codex（`@openai/codex`）是可选依赖：`npx` 默认会安装；使用 `npm install --omit=optional` 或 Canvas Agent Manager 精简版时不包含，此时 Agent 自动使用 Canvas 渠道，并拒绝切换到 DSH。默认模型路由为火山方舟 Agent Plan：

```bash
export ARK_AGENT_PLAN_CN_API_KEY="..."
npx -y @basketikun/canvas-agent@latest
```

Windows PowerShell：

```powershell
$env:ARK_AGENT_PLAN_CN_API_KEY="..."
npx -y @basketikun/canvas-agent@latest
```

也可以先连接本地 Agent，再在右侧连接设置中填写 Ark Agent Plan API Key。密钥保存在本机 `~/.infinite-canvas/canvas-agent.json`，不会上传到 Canvas 网页服务。

可选环境变量：

```text
CANVAS_DSH_HOME              DSH 数据目录，默认 ~/.infinite-canvas/dsh
CANVAS_DSH_PROVIDER          DSH provider，默认 ark-agent-plan-cn
CANVAS_DSH_MODEL             默认模型，默认 deepseek-v4-pro
CANVAS_DSH_API_KEY           Ark Agent Plan API Key 的别名
CANVAS_AGENT_RUNTIME=ark     启动时默认使用火山原生 API
CANVAS_AGENT_RUNTIME=dsh     启动时默认使用 DeepSeek Harness
CANVAS_AGENT_RUNTIME=canvas  启动时默认使用 Canvas 文本渠道
CANVAS_AGENT_RUNTIME=codex   回退到原有 Codex 适配器
```

Canvas 渠道的凭证只保存在本机 Agent 内存中，不写入配置文件或日志；切换渠道或重启 Agent 后需要重新选择。它只支持 OpenAI Chat Completions 文本渠道，不会把图片、视频或 Anthropic Messages 渠道当作聊天后端。

Base URL 可以填写 `https://example.com` 或 `https://example.com/v1`；只填写域名时默认补全 `https://`，本机地址默认补全 `http://`。

画布渠道中的相对地址（例如 `/provider`）会先按当前 Canvas 网页域名解析成完整 URL，再发送给本机 Agent；本地 Agent 不接受未解析的相对路径。

Ark Agent Plan 路由不接受显式 reasoning effort；Canvas Agent 会使用模型默认档位。当前嵌入模式只开放聊天、模型选择、会话历史和图片输入；Codex Skill 草稿与 Skill 编辑仍需要切回 Codex 运行时或使用 DSH 自身界面。

## 发布

`canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。推送到 `main` 后，GitHub Actions 会检查 npm 上是否已经存在当前包版本；不存在时才发布 `@basketikun/canvas-agent`。

发布前需要在 GitHub 仓库 Secrets 中配置 `NPM_TOKEN`。

## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

直接运行 `npx -y @basketikun/canvas-agent@latest` 只启动本地 Agent 服务，不会安装 MCP，也不会增加 Codex 工具上下文。只有安装 Codex app 插件，或手动执行 `codex mcp add` 后，`infinite-canvas` 工具才会进入 Codex 上下文；由于工具较多，不使用时建议移除。

通过插件安装时移除插件：

```bash
codex plugin remove infinite-canvas
```

手动添加 MCP 时移除 MCP：

```bash
codex mcp remove infinite-canvas
```

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/infinite-canvas`。在 Codex app 中添加本仓库的 marketplace 后，可以安装 `Infinite Canvas` 插件；插件会注册同一个 `infinite-canvas` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

插件默认通过 npm 启动 MCP；这个命令只提供 MCP 工具，不会把 MCP 写入全局配置，也不会在退出时自动卸载：

```bash
npx -y @basketikun/canvas-agent@latest mcp
```

使用时可以直接在 Codex 里说“打开 Infinite Canvas”，插件会启动本地 Agent，读取 Local URL 和 Connect token，然后在右侧打开 `https://canvas.best/` 并自动新建、连接画布；只有明确要求使用本地项目时才会启动本地前端。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent@latest mcp
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.infinite-canvas]
command = "npx"
args = ["-y", "@basketikun/canvas-agent@latest", "mcp"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 Codex

本地面板会把提示词发送给 Canvas Agent。Canvas Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `infinite-canvas` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和命令输出增量，网页使用同一条消息持续更新，并把任务进度、计划、搜索、文件修改与工具操作整理为中文过程时间线。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- npx -y @basketikun/canvas-agent@latest mcp
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__infinite-canvas__*`，画布写操作仍由网页侧边栏确认。
