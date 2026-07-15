# 桌面端构建与发布

本文是桌面端打包、签名、审计、上传和自动更新的唯一发布说明。

发布流程遵守两个原则：

1. 安装包只包含应用运行必须的文件。
2. 没有通过最终产物安全审计的文件不能上传到 R2。

向量模型由应用首次使用时单独下载，不属于安装包。本发布流程不修改模型名称、精度、下载文件或缓存逻辑。

## 打包安全边界

electron-builder 不再从项目根目录打包。`pnpm run build` 会重新创建：

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

staging 目录只包含：

- 压缩后的 main、preload 和 renderer；
- 从编译结果自动计算出的运行时依赖；
- 当前系统、当前架构的原生二进制；
- 只包含 headless Chromium 的网页抓取 sidecar；
- 最小化生产 `package.json`；
- 法律要求保留的第三方 License 和 Notice。

以下内容禁止进入 staging 和最终安装目录：

- 项目 `src`、`tests`、`scripts`、`doc`；
- `.claude`、`.codex`、`.github`；
- `.env`、锁文件、工作区配置、构建配置；
- TypeScript、Python、C/C++ 原始源码；
- Source Map；
- 测试日志、截图、Playwright trace、fixture；
- 完整 Chromium 和 Patchright；
- 错误系统或错误架构的原生二进制；
- 私钥、签名证书和高风险 Token。

`app.asar` 只是归档，不是加密。编译后的 JavaScript 是 Electron 运行必需内容，仍然可以被逆向分析。生产构建会压缩 JavaScript，但不能把客户端代码当作秘密存储位置。

## Source Map 和密钥

最终安装包内禁止 `.map`。如果以后接入错误监控：

1. 构建时生成 Source Map；
2. 上传到受访问控制的错误监控平台；
3. 从 staging 删除；
4. 再执行打包和最终审计。

Source Map 不能上传到公开 CDN，因为 `sourcesContent` 可能包含完整原始源码。

所有 `VITE_*` 环境变量都按公开信息处理。发布 Token、R2 凭据和签名证书只能保存在本机安全环境或 GitHub Actions Secret 中，不能写入 renderer、源码或打包配置。

## 构建流程

`pnpm run build` 依次执行：

1. TypeScript 类型检查；
2. 构建只含 Chromium headless shell 的 Python sidecar；
3. 导出 Electron 使用的 better-sqlite3 原生模块；
4. 构建并压缩 main、preload、renderer，禁止 Source Map；
5. 验证 main、worker 和 embedding 运行时边界；
6. 删除旧 `dist` 和旧 staging；
7. 根据编译产物生成最小生产 `package.json`；
8. 使用主锁文件离线安装运行时依赖；
9. 删除测试、文档、源码、Source Map 和错误平台二进制；
10. 执行 staging 安全审计。

electron-builder 完成后，`pnpm run package:audit` 会再次检查真实 `.app` 或 `win-unpacked`，而不是只检查构建配置。

最终审计会验证：

- `app.asar` 根目录只能有 `out`、`node_modules`、`package.json`；
- `package.json` 只能包含最小生产字段；
- `app.asar` 和外部 resources 都没有禁止文件；
- 没有绝对路径或逃出安装目录的符号链接；
- 没有私钥、AWS Access Key、GitHub Token 等高风险内容；
- sidecar 没有完整 Chromium、Patchright 和 Python 源码；
- ONNX Runtime 只包含当前平台和架构；
- 生成 `dist/package-audit.json`，记录安装目录、`app.asar` 和安装包体积。

体积硬性预算暂不启用。等 macOS arm64、macOS x64、Windows x64 都完成优化和回归后，再根据实测结果设置。

## 常用本地命令

只构建编译产物和 staging：

```bash
pnpm run build
```

构建未压缩安装目录并审计：

```bash
pnpm run build:unpack
```

构建当前 Mac 架构：

```bash
pnpm run build:mac:arm64
pnpm run build:mac:x64
```

重新执行最终安装目录审计：

```bash
pnpm run package:audit
pnpm run package:audit:summary
```

所有正式打包命令已经包含最终审计。审计失败时不能手工跳过并上传。

## 发布平台

- macOS arm64：在 Apple 芯片 Mac 本地构建。
- macOS x64：在同一台 Mac 的 Rosetta x64 Node/Python 环境构建。
- Windows x64：由 `.github/workflows/release.yml` 使用 GitHub Windows Runner 构建。
- GitHub Actions 不保存安装包 Artifact，也不执行 macOS 或 Linux 发布。

Windows 工作流顺序固定为：

1. 从 Tag 检出干净源码；
2. 安装锁定依赖；
3. 构建 Windows x64；
4. 审计 staging 和最终 `win-unpacked`；
5. 把体积报告写入 Workflow Summary；
6. 生成包含审计摘要的发布片段；
7. 上传 R2。

生成发布片段时必须存在匹配平台和架构的 `dist/package-audit.json`。因此即使有人绕过正常构建命令，也不能直接上传未审计安装包。

## R2 发布结构

桌面端安装包和自动更新文件统一由 Cloudflare R2 提供。GitHub Release 只保存版本说明和 R2 下载链接，不保存二进制文件。

```text
artifacts/vX.Y.Z/*             当前版本安装包和更新文件
release-status/vX.Y.Z/*.json   平台构建完成标记和审计摘要
updates/latest/latest.yml      Windows 自动更新元数据
updates/latest/latest-mac.yml  macOS 自动更新元数据
releases/latest.json           官网最新版下载清单
```

`latest.yml`、`latest-mac.yml` 和 `latest.json` 最后发布。它们更新前，新版本不会被应用或官网发现。

版本文件使用一年不可变缓存；最新版元数据使用 `no-store`。

## R2 保留和回滚

新版本发布并通过公网校验后，发布脚本会删除：

- 旧的 `artifacts/vX.Y.Z`；
- 旧的 `release-status/vX.Y.Z`；
- 旧逻辑产生的 `updates/vX.Y.Z`；
- 旧逻辑产生的 `releases/vX.Y.Z`；
- 旧逻辑产生的 `releases/latest/*` 安装包。

R2 稳态只保存最新版本。需要回滚时，从旧 annotated Tag 重新构建、审计并发布，不能复用未审计的本地旧产物。

## 一次性本地配置

Mac 需要：

- 在登录钥匙串安装并信任固定的 `Ncurator Update Signing` P12；
- 安装 arm64 Node.js、pnpm 和 Python；
- 安装 Rosetta x64 Node.js 和 Python；
- 安装 AWS CLI；
- 配置 R2 环境变量；
- 如需自动创建 GitHub Release，配置 `NCURATOR_RELEASE_TOKEN`。

发布配置读取项目根目录 `.env`。R2 可以使用：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL
```

脚本会把 R2 Key 映射为 AWS CLI 所需变量。`.env` 已被 Git 忽略，也被打包安全策略禁止，不能提交或复制到 staging。

默认本地工具目录是：

```text
~/.ncurator/release-tools
```

可以使用以下变量指定其他路径：

```text
NCURATOR_X64_NODE
NCURATOR_X64_PYTHON
NCURATOR_AWS_CLI
```

首次导入签名证书：

```bash
pnpm release:signing:setup
```

当前 macOS 使用项目自建的 `Ncurator Update Signing` 证书，并在
`electron-builder.yml` 中设置 `timestamp: none`，因为 Apple 时间戳服务不接受该证书。
这套签名用于保证两个架构的更新包来自同一发布方，当前不等同于 Apple Developer ID 公证。

自建证书没有 Apple Team ID。sidecar 需要加载内置 Python Framework，因此子进程使用
`build/entitlements.mac.inherit.plist` 关闭 library validation；顶层 App 不使用这个例外。
修改签名配置后必须实际运行打包后的 sidecar，不能只看 `codesign --verify`。

如果以后切换到 Apple Developer ID，必须一次性完成以下调整：

1. 替换签名证书和 CI Secret；
2. 删除 `timestamp: none`，恢复 Apple 可信时间戳；
3. 评估并移除子进程的 `disable-library-validation`；
4. 启用并配置 notarize；
5. 重新验证 arm64、x64、安装、Gatekeeper、sidecar 和自动更新。

## 正式发布

推荐使用发布准备命令创建提交和 annotated Tag：

```bash
pnpm release:prepare -- --version 0.1.4 --notes "版本说明"
```

也可以手工完成，但必须满足：

1. 在 `main` 修改 `package.json` 版本并提交；
2. 创建 annotated Tag，例如 `v0.1.4`；
3. Tag 必须与 `package.json` 版本一致；
4. 推送提交和 Tag。

Tag 会触发 Windows 构建、审计并上传 R2。然后在 Apple 芯片 Mac 执行：

```bash
pnpm release:mac -- --tag v0.1.4
```

本地命令会：

1. 从 Tag 导出两份干净源码；
2. 分别构建并审计 macOS arm64 和 x64；
3. 验证两个 App 使用相同稳定签名；
4. 上传 macOS 文件和审计摘要；
5. 等待 Windows 发布片段；
6. 校验 R2 文件大小和 sha512；
7. 生成并发布最新版元数据；
8. 创建只含 R2 链接的 GitHub Release；
9. 清理 R2 旧版本。

只重新执行最终汇总：

```bash
pnpm release:r2:finalize -- --tag v0.1.4
```

调试时可以添加 `--keep-old`，暂时不删除旧版本。它不会跳过安装包审计。

## 公网地址

官网读取：

```text
https://download.ncurator.com/releases/latest.json
```

应用自动更新读取：

```text
https://download.ncurator.com/updates/latest/latest.yml
https://download.ncurator.com/updates/latest/latest-mac.yml
```

实际安装文件来自：

```text
https://download.ncurator.com/artifacts/vX.Y.Z/*
```

## 发布前回归

基础检查：

```bash
pnpm lint
pnpm typecheck
pnpm test:update:unit
pnpm test:update:e2e
```

还必须验证：

- 应用启动、preload 和 IPC；
- SQLite、LanceDB 和 embedding；
- PDF/DOCX 读取与预览；
- 网页搜索和动态网页抓取；
- 安装、覆盖升级、卸载；
- 无网络启动；
- 自动更新下载、sha512、签名替换和用户数据保留。

真实自动更新测试只在明确需要时执行：

```bash
pnpm test:update:real -- --source-version 0.1.3 --expected-version 0.1.4
```

## 失败处理

- staging 审计失败：不要添加排除例外，先确认文件是否真的属于运行时必需内容。
- 最终审计失败：检查 `app.asar` 和外部 resources，不能只改 electron-builder glob。
- sidecar 缺浏览器：重新运行 `pnpm run build:sidecar`，确认只下载 headless shell。
- 运行时模块缺失：检查编译产物的外部 import 和生成的 staging `package.json`。
- 平台二进制缺失：检查构建所用 Node/Python 架构是否与目标一致。
- R2 汇总失败：保留现有 latest 元数据，修复后重新运行 finalize，不能发布部分平台。

任何失败都不能通过复制旧 `dist`、关闭审计或手工上传来绕过。
