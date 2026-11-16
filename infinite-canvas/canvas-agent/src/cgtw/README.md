# Canvas Agent 的 CGTW 接口

CGTW（CGTeamwork）只读接口，挂在 Canvas Agent 的 `/cgtw` 下，供画布网页的「CGTW 画布」页面使用：登录、任务检索、批注查看。不修改 CGTW 数据，不需要单独启动，随 Canvas Agent / Canvas Agent Manager 一起运行。

## 原理

浏览器不能直接连 CGTW：`api.php` 没有跨域头；CGTW 登录态只在本机客户端 WebSocket 里；批注附件要带登录 cookie；后续上传还要写本机映射盘。所以由本机 Agent 转发：

```
网页 ──(Agent token)──► 本机 Agent /cgtw ──► CGTW 客户端 WS（取登录 token）
                                         ├─► CGTW 服务器 api.php（任务、批注）
                                         └─► 附件代理（带 cookie 下载）
```

令牌、来源（Origin）校验和跨域头沿用 Agent 的全局中间件，所以网页连接 Agent 一次，CGTW 页面就直接可用。

## 登录方式

- **本机 CGTW 客户端登录态（优先）**：读取本机 CGTW 客户端 WebSocket（默认 `ws://127.0.0.1:64999`，可用环境变量 `CGTW_CLIENT_PORT` 修改）里的 token，不需要密码，要求客户端已启动并登录。
- **账号密码**：向 CGTW `api.php` 登录，密码只保存在 Agent 内存中，不落盘。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /cgtw/session`、`POST /cgtw/login`、`POST /cgtw/logout` | 登录态 |
| `GET /cgtw/projects` | 项目列表 |
| `GET /cgtw/facets?db=` | 集、环节、状态列表和状态颜色 |
| `GET /cgtw/tasks?db=&mine=&q=&eps=&pipeline=&status=&offset=&limit=` | 服务端过滤和分页，默认每页 50，最多 200 |
| `GET /cgtw/notes?db=&taskId=` | 任务批注（文字和附件） |
| `GET /cgtw/media?url=` | 批注附件代理，只允许当前 CGTW 服务器 `/upload/` 下的地址 |
| `GET /cgtw/submit/plan?db=&taskId=&kind=review\|render` | 提交规划：文件框目录、命名规则、已有文件、建议版本号、校验目标 |
| `POST /cgtw/submit?db=&taskId=&kind=&version=&ext=` | 提交小样/大样，请求体是文件本身（`application/octet-stream`），不限制大小，流式写盘 |
| `GET /cgtw/files?db=&taskId=&kind=review\|render` | 小样/大样目录里的文件和文件夹（按版本号倒序），带是否可导入画布 |
| `GET /cgtw/file?db=&taskId=&kind=&name=` | 取目录里的单个文件（支持 Range）；`.mov` 先转成 H.264 预览（浏览器播不了 ProRes），缓存在 `~/.infinite-canvas/cgtw-cache`，保留 7 天 |

文件接口只接受目录里已有的普通文件名（不含路径分隔符、不以 `.` 开头），目录来自 CGTW 文件框；可导入格式为 png/jpg/jpeg/webp/bmp/gif 和 mp4/m4v/webm/mov，其余格式（exr、tif、序列文件夹等）只列出不能导入。

## 提交小样 / 大样

逻辑移植自 KJ_PIPELINE 的 `upload_version`，目录和命名规则不读本地配置，直接取 CGTW 文件框（`task/get_sign_filebox`）：

1. 目标目录 = 文件框的 `path`（例如 `Y:/WMZB2/work/test/S001_0020/comp/review`）；小样用 `review` 文件框，大样用 `fullres`（回退 `render`）。
2. 文件名 = 文件框命名规则里的 `#` 换成补零版本号；规则带扩展名（如 `.mov`）时只接受该扩展名。
3. 建议版本号 = 目录里文件/文件夹名中 `_v###` 与 CGTW 版本里真实文件名版本号的最大值 + 1，制作者可修改；版本已存在直接拒绝（409）。
4. 视频先写入目录里的临时文件再校验，不符合直接删除并拒绝（422）：帧率（容差 0.05）、帧数（任务 `shot.frame`）、小样必须 1920x1080、大样不能是 1920x1080；图片不校验。
5. 通过后改名落盘，依次调用 `file/create` → `version/client_create`；小样且文件框 `is_submit=Y` 时再调用 `work_flow/submit`，并把任务 `task.leader_status` 和 `task.status` 改为 `review`；大样不触发提交流程也不改状态。
6. 落盘成功但 CGTW 回写失败时，结果里会带 warning，文件保留在存储盘。

### 转换为 ProRes .mov（可选）

视频可勾选“转换为 ProRes .mov”（扩展名不被文件框接受时默认勾选）：小样转 ProRes 422 LT 并缩放到 1920x1080（保持比例，补黑边），大样转 ProRes 4444 XQ 并保持原分辨率；同时按项目目标帧率重采样，保留音频（PCM）。还可勾选“超过任务帧数时截取前 N 帧”。转换后的文件仍会走上面的帧率、帧数、分辨率校验，不符合直接拒绝。转换用 `POST /cgtw/submit` 的 `convert=1`、`trim=1` 参数，不设超时。

ffmpeg 查找顺序：环境变量 `CANVAS_FFMPEG` → CGTW 客户端自带的 `C:\CgTeamWork_v7\bin\base\app\ffmpeg.exe`（v6 和 `C:\cgteamwork` 路径同理）→ PATH 里的 `ffmpeg`。

目标帧率 CGTW 不提供，默认 `proj_wmzb2` 为 25；其他项目或覆盖在 `~/.infinite-canvas/cgtw-settings.json` 里配置，例如 `{"fps": {"proj_wmzb2": 24, "proj_xxx": 25}}`，没配置的项目只校验帧数。

## 测试

```bash
npx tsx --test src/cgtw/client.test.ts
```
