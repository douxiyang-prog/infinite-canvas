---
name: canvas-manual-upgrade
description: 'Use after completing infinite-canvas program changes, or when asked to package updates, generate deployment archives, upgrade the .68 and .69 servers manually, or provide scp/ssh update commands. Build current frontend assets, generate a .68 source archive and a .69 offline archive, verify both, and provide commands without deploying automatically.'
---

# Canvas 双机手动升级交付

## 适用范围

- 仅用于本工作区的 infinite-canvas 项目。
- 每次完成影响程序运行的源码、配置或静态资源修改后，默认执行此流程，不等用户再次要求打包。
- 用户明确要求本次不打包时遵循该要求。仅修改文档、skill 或开发指引时不需要重新打包程序。
- 这是生成部署包和提供手动命令的流程，不是正式发版本；不要因此提交 Git、打 tag 或修改版本号。
- 不自动执行 scp、ssh、服务器更新或重启。上传和升级由用户手动执行，除非用户另行明确授权。

## 路径和既有流程

- 工作区根目录下的 `infinite-canvas` 是程序源码目录，更新包保存在工作区根目录。
- 更新脚本及说明：`infinite-canvas/deploy/update-canvas-from-tar.sh`、`infinite-canvas/deploy/UPDATE_FROM_TAR.md`。
- `.68` 使用标准 `Dockerfile` 和 `server/Dockerfile`，在服务器构建源码。
- `.69` 使用预构建的 `web/dist`；包内以 `Dockerfile.69` 替换根 `Dockerfile`，以 `server/Dockerfile.69` 替换 `server/Dockerfile`。只替换压缩包内的内容，不改工作区原文件。
- `.69` 的离线方式依赖服务器已有的前端/API `latest` 基础镜像和依赖，不是包含 Docker 镜像的独立安装包。依赖清单或基础镜像变化时，先确认旧镜像能否复用，不能把缺少依赖的包标为可离线升级。

## 操作步骤

1. 检查当前工作区改动，保留用户已有修改；阅读当前更新脚本和 Dockerfile，确认本次仍适用既有流程。
2. 在程序的 `web` 目录运行 `npm run build`，生成最新前端产物。不得直接使用旧 `dist` 打包 `.69`。构建失败时明确报告并修复本次改动导致的问题，不交付成功外观的旧包。
3. 使用同一个本地时间戳和简短英文改动主题命名两个新包，不覆盖历史包：
   - `.68`：`canvas-build-src-YYYYMMDD-HHMMSS-<topic>-source.tar.gz`
   - `.69`：`canvas-build-src-YYYYMMDD-HHMMSS-<topic>-69-offline.tar.gz`
4. 两个包都包含完整当前源码及新生成的 `web/dist`，顶层目录必须为 `infinite-canvas/`。包含未提交和本次新增的相关源码，不要只打包 Git HEAD。
5. 优先从 Git 跟踪文件及未忽略的新源码生成清单，再显式加入新的 `web/dist`。排除 `.git`、`node_modules`、历史归档、日志、缓存、运行数据、私钥和真实 `.env`；保留所需锁文件、SQL、部署脚本和 `.env.example` 等配置样例。不要复制用户数据或凭据。
6. 核验两包可完整读取，路径无绝对路径或 `..`，至少包含：
   - `infinite-canvas/Dockerfile`
   - `infinite-canvas/server/Dockerfile`
   - `infinite-canvas/web/package.json`
   - `infinite-canvas/web/bun.lock`
   - `infinite-canvas/web/dist/index.html` 及其引用的资源
   - 当前后端源码、SQL 和更新脚本。
7. 核对本次修改确实进入源码和前端产物，核对 `.69` 包内两份 Dockerfile 的替换结果，计算两个包的 SHA256。检查文件内容而非仅依据文件名或时间。
8. 报告生成路径、验证结果及“尚未上传或部署”，给出下面四条可直接复制的命令。命令中必须替换为本次真实生成的文件名与本地绝对路径，不留下占位符。

## 手动操作命令模板

所有命令由用户在本机 Windows PowerShell 执行。SSH 私钥使用本机用户目录下的 `.ssh\canvas-deploy`；不读取或复制私钥内容。当前服务器和账号如下，用户提供新值时同步调整。

### 上传到 .68

```powershell
scp -i "$env:USERPROFILE\.ssh\canvas-deploy" "<源码包本地绝对路径>" lynn@192.168.1.68:/tmp/
```

### 上传到 .69

```powershell
scp -i "$env:USERPROFILE\.ssh\canvas-deploy" "<离线包本地绝对路径>" lynn@192.168.1.69:/tmp/
```

### 从本机更新 .68

```powershell
ssh -t -i "$env:USERPROFILE\.ssh\canvas-deploy" lynn@192.168.1.68 "cd /opt/infinite-canvas-deploy && sudo bash update-canvas-from-tar.sh /tmp/<本次源码包文件名>"
```

### 从本机更新 .69

```powershell
ssh -t -i "$env:USERPROFILE\.ssh\canvas-deploy" lynn@192.168.1.69 "cd /opt/infinite-canvas-deploy && sudo bash update-canvas-from-tar.sh /tmp/<本次离线包文件名>"
```

先上传成功再执行对应更新命令。`&&` 位于远端 Linux shell 的引号内，不是本机 PowerShell 运算符。提醒升级会重建并重启服务，分别确认最后输出“健康检查通过”和“更新完成”；本机构建和包校验通过不等于服务器已经升级成功。
