# 桌面端构建与发布

本文是 Windows、macOS 打包、安全审计、R2 发布和自动更新的唯一说明。当前只发布 Windows x64、macOS arm64 和 macOS x64，不发布 Linux。

发布由 annotated Tag 驱动。Windows 和 macOS 可在不同机器独立构建、发布和回滚，互不等待。任何产物必须先通过最终包审计，才能生成发布片段并上传。

向量模型在应用内单独下载，不进入安装包。

## 打包边界

`pnpm run build` 会重建 `release-stage/`。electron-builder 只从 `release-stage/app` 打包，不直接打包项目根目录。

```text
release-stage/
├── runtime-trace-report.json
├── main-obfuscation-report.json
└── app/
    ├── package.json
    ├── out/{main,preload,renderer}/
    ├── node_modules/
    └── resources/{native,web_crawler_sidecar}/
```

安装包只允许包含编译结果、运行时依赖、当前平台原生二进制、网页抓取 sidecar 和必要 License。以下内容不得进入 staging 或安装包：

- `src`、`tests`、`scripts`、`doc` 和开发配置；
- `.env`、锁文件、测试日志、fixture、截图和 Source Map；
- TypeScript、Python、C/C++ 源码；
- 完整 Chromium、Patchright 和错误平台原生文件；
- 私钥、证书、Token 和其他敏感凭据。

`app.asar` 不是加密。客户端代码和所有 `VITE_*` 变量都按公开信息处理。当前只混淆 `out/main`，目的是提高直接阅读成本，不能代替密钥管理。

## 构建与审计

`pnpm run build` 固定执行：

1. 准备 native 模块并执行 TypeScript 类型检查。
2. 构建或复用当前平台的网页抓取 sidecar。
3. 构建 main、preload、renderer 并验证进程边界。
4. 用 `@vercel/nft` 追踪 main/preload 的运行时依赖。
5. 离线安装生产依赖闭包，移除开发内容和错误平台文件。
6. 用 staging 中的真实 Loader 验证 DOCX、PDF 和 PDF worker。
7. 混淆 `out/main`，执行语法、哈希、体积和明文检查。
8. 审计 staging。

无法自动追踪的依赖只能在 `build/runtime-trace-policy.json` 中显式声明原因和对应测试。未知告警或未使用的显式规则都会使构建失败。

electron-builder 完成后，`pnpm run package:audit` 检查真实 `.app` 或 `win-unpacked`：

- `app.asar` 目录和生产 `package.json` 是否最小化；
- 运行时依赖、native 文件、sidecar 和符号链接是否正确；
- 是否包含禁止文件、Source Map、敏感信息或受保护提示词明文；
- 平台、架构、安装体积和 `app.asar` 体积是否符合预算。

macOS 正式产物还必须通过稳定签名校验，并真实启动到窗口和 preload API 就绪。仅存在进程或通过 `codesign` 不算可发布。

常用命令：

```bash
pnpm run build
pnpm run build:unpack
pnpm run build:win
pnpm run build:mac:arm64
pnpm run build:mac:x64
pnpm run package:audit
pnpm run package:audit:summary
pnpm test:e2e:package -- --bundle <release-bundle.json>
```

`pnpm test:e2e:package` 校验并安装指定 release bundle 中已经构建完成的正式包，再连接真实安装程序执行 E2E。它不会重新构建，且不替代日常源码 E2E。

## 平台构建

- Windows x64：默认优先本地 Windows；本地环境不可用时回退到手动 dispatch 的 GitHub Actions。
- macOS arm64：Apple Silicon Mac 本地构建。
- macOS x64：同一台 Mac 使用 Rosetta x64 Node 和 Python 构建。
- GitHub Actions 不响应 Tag push，不保存安装包 Artifact，也不构建 macOS。

`--local-only` 强制 Windows 本地构建，本地条件不完整就失败。`--actions` 强制使用 Actions。两个参数不能同时使用。

## 发布片段

发布片段使用 `schemaVersion: 2`，包含 Tag、版本、平台、安装包大小、sha512、自动更新元数据和包审计摘要；macOS 片段还包含签名摘要。旧 schema 或缺少审计信息的片段不能发布。

上传、状态查询和 finalize 都会重新验证片段、公开文件大小与 R2 sha512 metadata。

## R2 目录

Windows 和 macOS 使用独立目录与 latest 清单：

```text
artifacts/windows/vX.Y.Z/*
artifacts/macos/vX.Y.Z/*
release-status/windows/vX.Y.Z.json
release-status/macos/vX.Y.Z/macos-arm64.json
release-status/macos/vX.Y.Z/macos-x64.json
updates/latest/latest.yml
updates/latest/latest-mac.yml
releases/latest/windows.json
releases/latest/macos.json
downloads/latest/windows-x64.exe
downloads/latest/macos-arm64.dmg
downloads/latest/macos-x64.dmg
```

每个平台 finalize 只更新本平台的元数据、官网清单和固定下载地址，也只清理本平台旧对象。版本产物使用长期不可变缓存，latest 和固定下载使用 `no-store`。固定下载通过 `Content-Disposition` 返回带“馆长”的文件名，R2 技术文件名保持 ASCII。

当前流程不创建 GitHub Release，官网和应用更新都读取 R2。

## 环境配置

本地发布从根目录 `.env` 读取：

```text
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_PUBLIC_BASE_URL=https://download.ncurator.com
```

`.env` 已被 Git 忽略且禁止进入安装包。

Windows 本地发布需要 Windows x64、x64 Node.js 22、pnpm、x64 Python 3.12、Git、tar、AWS CLI 和 R2 配置。Actions 方式额外需要：

```text
NCURATOR_ACTIONS_TOKEN
RELEASE_REPOSITORY=owner/repo
```

macOS 本地发布需要 Apple Silicon Mac、arm64 Node/Python、Rosetta x64 Node/Python、AWS CLI、R2 配置，以及已安装并信任的 `Ncurator Update Signing` P12。首次配置执行：

```bash
pnpm release:signing:setup
pnpm release:doctor
```

当前 macOS 使用项目自建更新签名，`timestamp: none`、`notarize: false`。它只用于确认更新来源一致，不等同于 Apple Developer ID 公证。切换到 Developer ID 时必须恢复时间戳、启用公证、复核 entitlement，并重测 arm64、x64、Gatekeeper、sidecar 和自动更新。

## 正式发布

### 1. 创建版本并发布 Windows

在干净且与 `origin/main` 一致的 `main` 上执行：

```bash
pnpm release:start -- --version X.Y.Z --notes "Ncurator vX.Y.Z"
```

命令会检查版本和发布路线，执行 `typecheck` 与更新后端测试，提交版本号，创建 annotated Tag，原子推送 `main` 和 Tag，再按默认路线发布 Windows。

```bash
# 强制本地 Windows
pnpm release:start -- --version X.Y.Z --local-only

# 强制 GitHub Actions
pnpm release:start -- --version X.Y.Z --actions

# 创建版本后对已构建 Windows 候选包执行正式包 E2E
pnpm release:start -- --version X.Y.Z --package-e2e
```

### 2. 在 Mac 发布 macOS

Windows 与 macOS 发布相互独立。Mac 只需获取同一不可变 Tag：

```bash
git fetch --tags
git checkout main
git pull --ff-only
pnpm release:mac -- --tag vX.Y.Z
```

命令分别从 Tag 导出干净源码，先完成 arm64 和 x64 的构建、签名、审计与 bundle 校验，再按参数执行可选正式包 E2E，最后上传两个片段并 finalize macOS 通道。

## 重试与状态

版本创建后只能基于原 Tag 重试，不能修改或重建 Tag：

```bash
pnpm release:win -- --tag vX.Y.Z
pnpm release:win -- --tag vX.Y.Z --actions
pnpm release:win -- --tag vX.Y.Z --package-e2e
pnpm release:mac -- --tag vX.Y.Z
pnpm release:r2:finalize -- --tag vX.Y.Z
pnpm release:status -- --tag vX.Y.Z
```

`release:r2:finalize` 依次重新 finalize Windows 和 macOS，只用于两个平台都已上传后的恢复；日常发布不依赖它。

`--keep-work` 保留发布工作目录用于排查；默认在流程结束后清理。Python、pip 和 sidecar 使用独立缓存，但不复用源码、`node_modules` 或旧 `dist`。`--keep-old` 暂不清理旧 R2 对象。这些参数都不会跳过 bundle、审计或签名验证。

## 下载地址

```text
Windows 清单：https://download.ncurator.com/releases/latest/windows.json
macOS 清单：https://download.ncurator.com/releases/latest/macos.json
Windows 固定下载：https://download.ncurator.com/downloads/latest/windows-x64.exe
macOS arm64 固定下载：https://download.ncurator.com/downloads/latest/macos-arm64.dmg
macOS x64 固定下载：https://download.ncurator.com/downloads/latest/macos-x64.dmg
Windows 更新：https://download.ncurator.com/updates/latest/latest.yml
macOS 更新：https://download.ncurator.com/updates/latest/latest-mac.yml
```

## 自动更新

- 启动 5 秒后静默检查，持续运行时每 4 小时检查一次。
- 发现新版本后不自动下载，工作台左下角显示“更新”。
- 用户点击后开始下载并显示进度。
- 下载完成后可立即重启或稍后处理；正常退出时仍会安装已下载更新。
- 设置页没有应用更新入口。

`sidebar-app-update.e2e.test.ts` 使用更新 fixture 验证按钮状态、进度、重启、重试和 API 调用。它不证明真实安装包下载或安装成功，不作为发布阻塞项。真实更新验证必须使用已发布的旧版本安装包，等待 `available` 后主动下载。

## 发布前验证

发布准备脚本固定执行：

```bash
pnpm typecheck
pnpm test:update:backend
```

发版前还应按风险执行 unit、Settings、Workbench、AI mock/tool 和源码 E2E，并检查应用启动、SQLite/LanceDB、embedding、PDF/DOCX、网页能力、安装、覆盖升级、卸载和无网络启动。仅在有真实模型配置且改动相关时执行 live AI 测试。

## 保留与回滚

### 正式包回归门

正式包 E2E 不是每次发布的强制步骤。默认发布只执行构建、审计、签名（macOS）、bundle 完整性校验和 R2 发布；改动风险较高时显式增加 `--package-e2e`：

```bash
pnpm release:win -- --tag vX.Y.Z --package-e2e
pnpm release:mac -- --tag vX.Y.Z --package-e2e
```

E2E 消费本次 tag 已生成的 `release-bundle-*.json`，不会再次构建。Windows 本地和 GitHub Actions 只负责选择构建位置，构建后的 bundle、可选回归和 R2 发布走同一套流程。macOS 必须先完成 arm64 和 x64 两个 bundle，再执行可选回归和上传；启用回归时两个架构都必须通过。

独立测试已构建候选包使用：

```bash
pnpm test:e2e:package -- --bundle <release-bundle.json>
```

发布前重新计算 bundle 中所有文件哈希。R2 中已存在且哈希不同的同 tag 对象禁止覆盖。

每个平台公开验证成功后，只删除该平台的旧 artifacts 和 release-status。需要回滚时，从旧 annotated Tag 重新构建、审计和发布，不能复用未审计的本地产物。

## 常见失败

- staging 审计失败：确认文件是否为运行必需内容，不要直接放宽规则。
- 运行时追踪失败：检查依赖可达性和生产依赖声明，再决定是否增加带原因和测试的策略。
- DOCX/PDF 探针失败：检查 staging 内的真实 Loader、worker 和 optional peer，不要改用根目录依赖绕过。
- macOS 签名或启动失败：停止上传该架构片段。
- fragment、R2 metadata 或公开下载校验失败：不要更新对应 latest 通道。
