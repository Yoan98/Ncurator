# 桌面端构建与发布

本文是桌面端打包、签名、安全审计、跨机器构建、R2 上传和自动更新的唯一发布说明。

整个发布由同一个 annotated Tag 驱动。Windows 与 macOS 可以在不同机器独立构建，但必须满足两个硬规则：

1. 安装包只包含运行必需内容。
2. 没有通过最终产物安全审计的文件不能生成发布片段，也不能上传到 R2。

向量模型由应用首次使用时单独下载，不属于安装包。本流程不修改模型名称、精度、下载文件或缓存逻辑。

## 打包安全边界

electron-builder 不从项目根目录打包。`pnpm run build` 每次都会重新创建：

```text
release-stage/app/
├── package.json
├── out/
│   ├── main/
│   ├── preload/
│   └── renderer/
├── node_modules/
└── resources/
    ├── native/
    └── web_crawler_sidecar/bin/
```

staging 只允许包含：

- 压缩后的 main、preload 和 renderer；
- 根据编译结果自动计算出的运行时依赖；
- 当前系统、当前架构的原生二进制；
- 只包含 Chromium headless shell 的网页抓取 sidecar；
- 最小化生产 `package.json`；
- 法律要求保留的第三方 License 和 Notice。

以下内容禁止进入 staging 和最终安装目录：

- 项目 `src`、`tests`、`scripts`、`doc`；
- `.git`、`.github`、`.claude`、`.codex`；
- `.env`、锁文件、工作区配置和构建配置；
- TypeScript、Python、C/C++ 等原始源码；
- Source Map 和残留 `sourceMappingURL` 指令；
- 测试日志、截图、fixture 和 Playwright trace；
- 完整 Chromium 和 Patchright；
- 错误系统或错误架构的原生二进制；
- 私钥、签名证书和高风险 Token。

`app.asar` 只是归档，不是加密。Electron 运行所需的编译后 JavaScript 仍可被逆向分析，因此客户端代码和所有 `VITE_*` 变量都必须按公开信息处理。

## Source Map 和密钥

正式安装包内禁止 `.map`。如果以后接入错误监控，固定流程是：

1. 构建时生成 Source Map；
2. 上传到受访问控制的错误监控平台；
3. 从 staging 删除 Source Map 和引用；
4. 执行 staging 审计；
5. 再打包并执行最终审计。

Source Map 不能上传到公开 CDN，因为 `sourcesContent` 可能包含完整源码。

R2 凭据、GitHub Token 和签名证书只能保存在本机安全环境或 GitHub Actions Secret 中，不能写入 renderer、仓库文件或打包配置。

## 构建和审计流程

`pnpm run build` 依次执行：

1. TypeScript 类型检查；
2. 构建或复用当前平台的网页抓取 sidecar；
3. 导出 Electron 使用的 better-sqlite3 原生模块；
4. 构建并压缩 main、preload、renderer，禁止 Source Map；
5. 验证 main、worker 和 embedding 运行时边界；
6. 删除旧 `dist` 和旧 staging；
7. 根据编译产物生成最小生产 `package.json`；
8. 使用主锁文件离线安装运行时依赖；
9. 删除测试、文档、源码、Source Map 和错误平台二进制；
10. 执行 staging 安全审计。

electron-builder 完成后，`pnpm run package:audit` 检查真实 `.app` 或 `win-unpacked`。最终审计会验证：

- `app.asar` 根目录只能有 `out`、`node_modules`、`package.json`；
- `package.json` 只能包含最小生产字段；
- `app.asar` 和外部 resources 没有禁止文件；
- 没有绝对路径或逃出安装目录的符号链接；
- 没有私钥和高风险 Token；
- sidecar 没有完整 Chromium、Patchright 和 Python 源码；
- ONNX Runtime 和 native prebuild 只保留当前平台与架构；
- 生成 `dist/package-audit.json`，记录安装目录、`app.asar` 和安装包体积。

所有正式构建命令都包含最终审计。体积硬预算暂不启用，等 macOS arm64、macOS x64、Windows x64 都完成实测后再设置。

常用构建命令：

```bash
pnpm run build
pnpm run build:unpack
pnpm run build:win
pnpm run build:mac:arm64
pnpm run build:mac:x64
pnpm run package:audit
pnpm run package:audit:summary
```

## 平台构建方式

- Windows x64：本地环境完整时优先本地构建，否则显式触发 GitHub Windows Runner。
- macOS arm64：在 Apple Silicon Mac 本地构建。
- macOS x64：在同一台 Mac 的 Rosetta x64 Node/Python 环境构建。
- GitHub Actions 不响应 Tag push，不保存安装包 Artifact，也不构建 macOS 或 Linux。

Windows GitHub Actions 只允许手动 `workflow_dispatch`，并按 Tag 设置 concurrency。工作流步骤固定为：

1. 检出输入的 annotated Tag；
2. 安装锁定依赖；
3. 准备 Windows electron-builder 工具缓存；
4. 构建 Windows x64；
5. 审计 staging 和最终 `win-unpacked`；
6. 把体积和安全结果写入 Workflow Summary；
7. 生成强制包含审计信息的 fragment；
8. 上传并校验 R2。

## 发布片段协议

跨机器状态通过 `release-status/vX.Y.Z/*.json` 交接。当前 fragment 使用 `schemaVersion: 2`，必须包含：

- Tag、版本、平台；
- 每个安装包的文件名、大小、sha512 和用途；
- 自动更新元数据；
- `package-audit.json` 的平台、架构、安装体积和 `app.asar` 摘要；
- macOS 稳定签名摘要。

以下位置都会重新验证 fragment：

- 上传脚本；
- Windows 重复构建检查；
- `release:status`；
- 三个平台最终汇总。

旧的 schema v1 或缺少审计的 fragment 不能被当成已完成发布。

## R2 发布结构

所有二进制和自动更新元数据由 Cloudflare R2 提供：

```text
artifacts/vX.Y.Z/*             当前版本安装包和更新文件
release-status/vX.Y.Z/*.json   三个平台的 v2 发布片段
updates/latest/latest.yml      Windows 自动更新元数据
updates/latest/latest-mac.yml  macOS 自动更新元数据
releases/latest.json           官网最新版下载清单
```

三个平台的 fragment 全部通过文件大小、R2 sha512 metadata 和审计校验后，才会更新三个 latest 文件。版本文件使用一年不可变缓存，latest 元数据使用 `no-store`。

GitHub Release 是可选展示层，只保存版本说明和 R2 下载链接，不保存二进制。它在 R2 latest 公开验证成功后才创建；没有 `NCURATOR_RELEASE_TOKEN` 时直接跳过，不影响正式发布。

## 一次性环境配置

本地发布配置统一从项目根目录 `.env` 读取。通用配置：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL=https://download.ncurator.com
```

`.env` 已被 Git 忽略，也被打包安全策略禁止，不能提交或复制到 staging。

### Windows 本地环境

Windows 本地发布需要：

- Windows x64；
- x64 Node.js 22；
- `package.json` 指定版本的 pnpm；
- x64 Python 3.12；
- Git 和 tar；
- AWS CLI；
- 上述 R2 配置。

可选配置：

```text
NCURATOR_SIDECAR_BUILD_PYTHON
NCURATOR_AWS_CLI
NCURATOR_RELEASE_WORK_ROOT
NCURATOR_SIDECAR_BROWSER_CACHE
```

默认 Windows 工作目录位于用户可写的 `%TEMP%/ncurator-release`。如需更短路径，可用 `NCURATOR_RELEASE_WORK_ROOT` 指定。未开启 Windows 开发者模式时，`build:win` 会准备经过固定 SHA512 校验的 winCodeSign 工具缓存，不需要管理员终端。

如果本机不能构建 Windows，Actions 兜底需要：

```text
NCURATOR_ACTIONS_TOKEN
RELEASE_REPOSITORY=owner/repo
```

Token 只需要目标仓库的 Actions 写入权限。

配置后可执行只读诊断：

```bash
pnpm release:doctor
```

### macOS 本地环境

Mac 需要：

- 登录钥匙串安装并信任固定的 `Ncurator Update Signing` P12；
- arm64 Node.js、pnpm 和 Python；
- Rosetta x64 Node.js 和 Python；
- AWS CLI 和 R2 配置。

可用以下变量覆盖默认工具路径：

```text
NCURATOR_X64_NODE
NCURATOR_X64_PYTHON
NCURATOR_AWS_CLI
```

首次导入签名证书：

```bash
pnpm release:signing:setup
```

当前 macOS 使用项目自建的 `Ncurator Update Signing`，并设置 `timestamp: none`，因为 Apple 时间戳服务不接受该证书。这套签名用于保证两个架构更新包来自同一发布方，不等同于 Apple Developer ID 公证。

自建证书没有 Apple Team ID。sidecar 需要加载内置 Python Framework，因此子进程使用 `build/entitlements.mac.inherit.plist` 关闭 library validation；顶层 App 不使用这个例外。修改签名后必须真实运行打包后的 sidecar，不能只看 `codesign --verify`。

以后迁移 Apple Developer ID 时必须一起完成：

1. 替换签名证书和 CI Secret；
2. 删除 `timestamp: none`；
3. 评估并移除子进程的 `disable-library-validation`；
4. 启用 notarize；
5. 重新验证 arm64、x64、Gatekeeper、sidecar 和自动更新。

## 正式发布

### 1. 创建版本并启动 Windows 阶段

在准备发版的机器执行：

```bash
pnpm release:start -- --version 0.1.4 --notes "Ncurator v0.1.4"
```

命令会：

1. 要求位于干净的 `main`；
2. fetch 远端并确认本地 `main` 与 `origin/main` 完全一致；
3. 检查版本递增、远端和本地都没有同名 Tag；
4. 确认 Windows 本地或 Actions 至少有一条路线可用；
5. 执行 `typecheck` 和更新后端契约测试；
6. 提交 `package.json` 版本并创建 annotated Tag；
7. 原子推送 `main` 和 Tag；
8. 本地构建 Windows，或显式 dispatch Actions。

路由参数：

```bash
# 本地环境不完整时直接失败
pnpm release:start -- --version 0.1.4 --local-only

# 无条件使用 GitHub Actions
pnpm release:start -- --version 0.1.4 --actions
```

Tag push 本身不会触发 Actions，避免本地构建时浪费 Runner。

### 2. 在 Mac 续跑 macOS 阶段

Windows 完成后，在 Apple Silicon Mac 获取同一个 Tag：

```bash
git fetch --tags
git checkout main
git pull --ff-only
pnpm release:mac -- --tag v0.1.4
```

Mac 命令会：

1. 从 Tag 导出两份干净源码；
2. 分别构建并审计 macOS arm64 和 x64；
3. 真实检查两个 App 的稳定签名；
4. 生成并上传两个带审计的 macOS fragment；
5. 等待并验证 Windows fragment；
6. 生成并公开验证 latest 元数据；
7. 可选创建只含 R2 链接的 GitHub Release；
8. 清理 R2 旧版本。

## 单阶段重试

版本创建后，各阶段都按不可变 Tag 重试，不能修改或重建 Tag：

```bash
# Windows 本地重试
pnpm release:win -- --tag v0.1.4

# Windows 本地或 Actions 自动路由
pnpm release:win:auto -- --tag v0.1.4

# 强制 Actions
pnpm release:win:auto -- --tag v0.1.4 --actions

# Mac 双架构重试
pnpm release:mac -- --tag v0.1.4

# 只重试最终汇总
pnpm release:r2:finalize -- --tag v0.1.4

# 查询三个平台状态
pnpm release:status -- --tag v0.1.4
```

Windows 失败时工作目录自动保留。`--reuse-work` 会重新导出干净 Tag，只复用 Python、pip 和 sidecar 生成缓存，不复用源码、`node_modules` 或旧 `dist`。缓存必须绑定同一个 Tag commit。成功后需要保留现场时使用 `--keep-work`。

最终汇总调试时可加 `--keep-old`，暂不删除旧 R2 对象。它不会跳过 fragment 和审计校验。

## 下载地址

```text
官网：https://download.ncurator.com/releases/latest.json
Windows 更新：https://download.ncurator.com/updates/latest/latest.yml
macOS 更新：https://download.ncurator.com/updates/latest/latest-mac.yml
安装包：https://download.ncurator.com/artifacts/vX.Y.Z/*
```

## R2 保留和回滚

新版本公开验证成功后，最终汇总会删除旧版本的 `artifacts`、`release-status` 和旧逻辑遗留目录。R2 稳态只保存最新版本。

需要回滚时，从旧 annotated Tag 重新构建、审计并发布，不能复用未审计的本地旧产物。

## 发布前回归

发布准备阶段执行：

```bash
pnpm typecheck
pnpm test:update:backend
```

模拟更新页面 E2E 仍然保留，用于验证按钮、进度、错误状态和 IPC，但不作为发布阻塞项：

```bash
pnpm test:update:e2e
```

还需要按风险验证：

- 应用启动、preload 和 IPC；
- SQLite、LanceDB 和 embedding；
- PDF/DOCX 读取与预览；
- 网页搜索和动态网页抓取；
- 安装、覆盖升级、卸载；
- 无网络启动；
- 自动更新下载、sha512、签名替换和用户数据保留。

真实自动更新只在明确需要时执行：

```bash
pnpm test:update:real -- --source-version 0.1.3 --expected-version 0.1.4
```

## 失败处理

- staging 审计失败：确认文件是否真的属于运行时必需内容，不能直接加白名单。
- 最终审计失败：检查真实 `app.asar` 和外部 resources，不能只改 electron-builder glob。
- Windows 工具缓存失败：检查 SHA512、写权限和 `ELECTRON_BUILDER_CACHE`。
- Windows 本地环境失败：运行 `pnpm release:doctor`，或显式使用 `--actions`。
- sidecar 缺浏览器：重新执行 `pnpm run build:sidecar`，确认只有 headless shell。
- 平台二进制缺失：确认 Node、Python 和目标架构一致。
- fragment v2 校验失败：不能复用旧 schema v1 状态，必须用当前 Tag 重新构建和审计。
- R2 汇总失败：保留现有 latest，修复后重新运行 finalize，不能发布部分平台。

任何失败都不能通过复制旧 `dist`、关闭审计、修改 Tag 或手工上传来绕过。
