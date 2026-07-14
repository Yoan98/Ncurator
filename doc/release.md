# 桌面端发布说明

桌面端发布由同一个 annotated Tag 驱动，Windows 与 macOS 可以在不同机器独立构建。平台产物、自动更新元数据和官网最新版清单全部由 Cloudflare R2 提供，三个架构全部就绪后才切换最新版元数据。GitHub 只保存源码和 Tag，不创建 GitHub Release。

## 发布结构

- Windows x64：Windows 本地环境完整时优先本地构建；否则显式触发 GitHub Windows Runner。
- macOS arm64：在 Apple 芯片 Mac 本地构建。
- macOS x64：在同一台 Mac 的 Rosetta x64 Node/Python 环境构建。
- GitHub Actions 不响应 Tag push，不保存 Artifact，也不运行 macOS 或 Linux 发布任务。

R2 同时承担跨机器发布状态交接：

```text
artifacts/vX.Y.Z/*             当前版本的全部安装包和更新文件
release-status/vX.Y.Z/*.json   三个平台的构建完成标记
updates/latest/latest.yml      Windows 最新版自动更新元数据
updates/latest/latest-mac.yml  macOS 最新版自动更新元数据
releases/latest.json           官网最新版下载清单
```

`latest.yml`、`latest-mac.yml` 和 `latest.json` 最后发布。三个 fragment 没有全部通过远端校验时，新版本不会被应用或官网发现。

## 一次性本地配置

所有本地发布配置统一从项目根目录 `.env` 读取。R2 可以使用 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，脚本会自动映射成 AWS CLI 所需变量。

通用配置：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL=https://download.ncurator.com
```

GitHub Actions 兜底需要 `NCURATOR_ACTIONS_TOKEN`，Token 只需要对应仓库的 Actions 写入权限。本地 Windows 发布不依赖该 Token。仓库不是默认的 `Yoan98/Ncurator` 时，用 `RELEASE_REPOSITORY=owner/repo` 覆盖。

Windows 本地发布需要：

- Windows x64；
- Node.js 22；
- `package.json` 指定版本的 pnpm；
- x64 Python 3.10 或更高版本；
- AWS CLI；
- 上述 R2 配置。

可以用 `NCURATOR_SIDECAR_BUILD_PYTHON` 和 `NCURATOR_AWS_CLI` 指定 Python、AWS CLI 路径。
未开启 Windows 开发者模式时，`build:win` 会校验并准备一个跳过无关 macOS 符号链接的 electron-builder `winCodeSign` 缓存，因此不需要以管理员身份运行终端。

Mac 继续使用既有环境：

- 登录钥匙串中已安装并信任固定的 `Ncurator Update Signing` P12；
- arm64 Node.js、pnpm 和 Python；
- Rosetta x64 Node.js 和 Python；
- AWS CLI 和 R2 配置；
- 必要时使用 `NCURATOR_X64_NODE`、`NCURATOR_X64_PYTHON`、`NCURATOR_AWS_CLI` 覆盖默认工具路径。

首次导入 Mac 签名证书：

```bash
pnpm release:signing:setup
```

敏感值不得提交到仓库。

配置后可以执行只读诊断，不会构建或上传：

```bash
pnpm release:doctor
```

该命令检查 Windows、Node、pnpm、Python、AWS CLI、R2 环境变量和 R2 Bucket 访问权限；Actions Token 只作为可选兜底状态显示。

## 正式发布

### 1. 创建版本并完成 Windows 阶段

在准备发版的机器执行：

```bash
pnpm release:start -- --version 0.1.4 --notes "Ncurator v0.1.4"
```

命令会：

1. 要求位于干净的 `main` 工作区；
2. 检查版本递增且 Tag 不存在；
3. 执行 `typecheck` 和更新后端契约测试；
4. 提交 `package.json` 版本并创建 annotated Tag；
5. 推送 `main` 和 Tag；
6. 检查本机 Windows 发布环境；
7. 环境完整时本地构建并上传，否则通过 GitHub API 显式触发 Windows workflow。

可用参数：

```bash
# 禁止 Actions 兜底；本地环境不完整时直接失败
pnpm release:start -- --version 0.1.4 --local-only

# 无条件使用 GitHub Actions
pnpm release:start -- --version 0.1.4 --actions
```

Tag 推送本身不会再触发 Actions，因此本地构建不会浪费 GitHub Runner 额度。

### 2. 在 Mac 续跑 macOS 阶段

Windows 完成后，在 Apple Silicon Mac 获取同一个 Tag：

```bash
git fetch --tags
git checkout main
git pull --ff-only
pnpm release:mac -- --tag v0.1.4
```

Mac 命令的既有行为保持不变：

1. 从 Tag 导出两份干净源码；
2. 分别构建 arm64 和 Rosetta x64；
3. 验证两个 App 使用相同的稳定签名；
4. 上传两个 macOS fragment；
5. 等待并验证 Windows fragment；
6. 生成并发布最新版元数据；
7. 清理 R2 旧版本。

## 单阶段重试

版本创建后，各阶段都按 Tag 重试，不得修改或重建 Tag：

```bash
# Windows 本地重试
pnpm release:win -- --tag v0.1.4

# 自动选择本地或 Actions
pnpm release:win:auto -- --tag v0.1.4

# 强制 Actions
pnpm release:win:auto -- --tag v0.1.4 --actions

# Mac 双架构重试
pnpm release:mac -- --tag v0.1.4

# 只重试最终汇总
pnpm release:r2:finalize -- --tag v0.1.4
```

Windows fragment 已存在且远端文件完整时，本地和 Actions 共用的脚本会直接跳过重复构建。Windows 正式源码会导出到系统临时目录下的短路径，避免 Python 和 pnpm 深层依赖触发 Windows 路径长度限制。调试 Windows 临时源码时可以给 `release:win` 添加 `--keep-work`；调试最终汇总时可添加 `--keep-old`。

查询一个版本的跨平台状态：

```bash
pnpm release:status -- --tag v0.1.4
```

## R2 保留规则

新版本正式发布并通过公网校验后，最终汇总脚本会删除旧版本的 `artifacts`、`release-status` 以及旧逻辑遗留的版本目录。R2 稳态只保存最新版本。需要回滚时，从旧 Tag 重新构建并发布。

## 测试

发布准备阶段执行：

```bash
pnpm typecheck
pnpm test:update:backend
```

更新后端契约覆盖服务状态机、发布配置、R2 元数据和 release fragment，不包含模拟更新页面 E2E。真实自动更新只在明确需要时执行：

```bash
pnpm test:update:real -- --source-version 0.1.3 --expected-version 0.1.4
```

真实测试必须确认发现新版、R2 下载、sha512 校验、签名替换、重启版本和用户数据保留。
