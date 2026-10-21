# 桌面端发布设计

## 1. 平台与构建

### Windows

本地 Windows x64：Node.js 22 x64、项目指定 pnpm、Python 3.12 x64、Git、tar；发布时还需 AWS CLI、COS 和 R2 存储配置，以及已登录且具备公开仓库写权限的 GitHub CLI。`pnpm release:doctor` 检查本机条件。prepare / test / publish 只消费本机候选包。

### macOS

prepare 必须在 Apple Silicon Mac；需已信任的 `Ncurator Update Signing` P12（自建更新签名，`timestamp: none`、`notarize: false`，非 Apple Developer ID 公证）。候选包须完成正式包 E2E；发布时需 AWS CLI、COS 和 R2 存储配置及已登录的 GitHub CLI。不构建、测试或发布 Intel Mac。

### 构建与产物边界

`pnpm run build` 生成并审计 `release-stage/app`，包括 native 与 sidecar 准备、类型检查、应用构建、生产依赖追踪、关键读写路径验证和 Main 混淆。`build:win` / `build:mac:release:arm64` 随后调用 electron-builder 打包，并审计实际的 `win-unpacked` / `.app`；macOS 另做签名与启动验证。

- electron-builder 以 `release-stage/app` 为唯一应用输入，开发工作区不直接进入安装包。
- 安装包包含构建后的应用、生产依赖与运行资源，排除开发和测试资料、`.env`、私钥、Source Map 及其他平台文件。`app.asar` 与 `VITE_*` 可由用户读取，不作为凭证保护手段。
- 生产依赖按追踪结果裁剪，并验证关键读写路径；追踪触达待裁剪目录时构建失败，避免误删运行依赖。
- 网页抓取 sidecar 保留 Playwright 驱动 JS，复用 Electron 提供的 Node 与浏览器，不重复打包这些运行时。构建、缓存复用和打包后检查 sidecar 能否实际启动。
- 候选 bundle 绑定 Tag、commit、fragment、安装包、更新文件与哈希，测试和发布消费同一份可校验产物。

具体文件排除规则与体积预算由[构建审计脚本](../../scripts/build/package/content-policy.mjs)维护，打包参数见 [electron-builder 配置](../../electron-builder.yml)。

## 2. 对象存储与公开通道

每平台独立目录；只保留最新一份 `artifacts`；官网与自动更新共用同一 artifacts URL：

```text
artifacts/windows/windows-vX.Y.Z/*
artifacts/windows/windows-vX.Y.Z/fragment.json
artifacts/macos/mac-vX.Y.Z/*
artifacts/macos/mac-vX.Y.Z/fragment.json
updates/latest/latest.yml
updates/latest/latest-mac.yml
releases/latest/windows.json
releases/latest/macos.json
```

`fragment.json` 是该 Tag 的发版快照（文件清单、sha512、更新 YAML、审计），给 upload → finalize 使用，不是给官网或客户端的 live 指针。旧的顶层 `release-status/` 前缀在下一次该平台 finalize 时删除。

CDN 节点缓存遵循源站 `Cache-Control`：安装包为 `public, max-age=31536000, immutable`；`fragment.json`、`updates/latest` 与 `releases/latest` 为 `no-store`。控制台另保留 `/updates/latest`、`/releases/latest` 目录不缓存，作为源站头写错时的保险。`latest.yml` / `latest-mac.yml` 供 electron-updater；`releases/latest/*.json` 供官网 `fetch` 后导航到 artifacts。

公开对象键使用用户可见文件名（如 `馆长-X.Y.Z-macos-arm64.dmg` / `馆长-X.Y.Z-Windows-x64.exe`），官网 `/api/download/*` 仍 307 到该直链；浏览器保存名取自 URL 末段。本地构建产物与 fragment 的 `storageName` 可仍为 ASCII（如 `Ncurator-mac-arm64.dmg`），仅用于解析磁盘文件。

每次正式发布产出国内、国际两个发行包：国内包只写 COS，国际包只写 R2。二者共用同一构建的应用资源，记录相同的共用资源 SHA-256；安装包、签名与文件哈希分别登记。存储对象布局与缓存策略一致，公开 manifest 使用各自域名。COS 配置：环境变量 `SecretId` / `SecretKey`（或 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`）。桶与区域默认使用 `ncurator-1324873382` / `ap-guangzhou`，可通过 `COS_BUCKET` / `COS_REGION` 覆盖；公开地址必须为 `https://download.guanzhangai.cn`。使用默认配置时无需将这些值写入 `.env`。CDN、DNS、资费与采购见 [`tencent-cdn-billing.md`](./tencent-cdn-billing.md)。发布子用户权限模板：[`scripts/release/cos/cam-policy.json`](../../scripts/release/cos/cam-policy.json)。

国内官网／下载为 `https://www.guanzhangai.cn`、`https://download.guanzhangai.cn`，国际官网／下载为 `https://www.ncurator.com`、`https://download.ncurator.com`。国内发行包固定从 COS 自动更新，国际包固定从 R2 更新；设置中的官方服务线路只改变 API 和帮助请求，不改变更新源。两端分别更新对应发行包、metadata 与 manifest，不跨站镜像。

### GitHub Releases 手动下载

公开仓库 `Yoan98/Ncurator` 的 Releases 作为安装包下载镜像，由现有平台发布命令通过 GitHub CLI 自动上传与 R2 上线国际版相同的文件；国内包完成正式包回归，国际包通过共用资源一致性绑定该证据，不重新构建。GitHub 登录凭证由 CLI 管理，不新增项目密钥配置。Windows 与 macOS 沿用各自独立 Tag，每条 Release 包含对应平台的 EXE 或 DMG、`SHA256SUMS` 和版本说明；GitHub 安装包附件使用英文品牌 ASCII 文件名，命名见[品牌规范](../brand.md#下载名-vs-缓存名)，自动更新文件由各发行包固定的 COS／R2 通道提供。

Release 的公开 annotated Tag 必须与候选 bundle 的构建 commit 完全一致；公开源码后从该源码创建新的 Tag 和候选包。自动流程不代建 Tag，不把含凭证的私有历史推入公开仓库，也不处理历史包与公开快照的 commit 映射。GitHub 自动附带的 Source code 压缩包不替代安装包，也不替代核对完整对应源码的义务。

Windows 和 macOS 独立发布，GitHub 的 Latest 标记不能代表两个平台都已更新。README 使用仓库 Releases 列表作为 GitHub 下载入口，不依赖跨平台共用的 `releases/latest/download` 地址。具体上传与恢复操作见[发布流程](./release.md#31-github-releases-镜像)。

R2 发布配置为每次正式发布必需：设置 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ACCOUNT_ID`、`R2_BUCKET_NAME`、`R2_PUBLIC_BASE_URL=https://download.ncurator.com`。平台发布入口固定处理两个存储；`RELEASE_STORAGE_TARGET=cos|r2` 仅选择底层上传 / finalize 恢复目标，默认 COS。

publish 在写入前校验 COS / R2 配置与两个公开渠道的版本，再校验 GitHub 源码身份并准备草稿及附件；随后分别上传 COS 国内候选与 R2 国际候选及各自 fragment，分别更新该平台自动更新 metadata 与官网 manifest，验证公开 yml / 清单 / artifacts 的大小、sha512 与 manifest URL（安装包 URL 须以用户可见文件名结尾）；最后公开 GitHub Release，并通过匿名下载核对大小与 SHA-256。三个渠道成功后才标记 `published` 并清理本地 `tests/logs/**`；每个存储在自身公开验证完成后清理该平台更早 artifacts（含旧 `release-status/`）。失败、prepare-only、test-only 不清理 logs。跨服务发布不具备原子性；中断保留同一组双发行候选包，重跑 publish 时分别检查 COS 国内包及 R2 国际包的官网与更新通道状态、复验已完成渠道、补齐未完成渠道与 GitHub 草稿附件。已标记 `published` 的双候选包也可补齐各自缺失渠道；不重建、不覆盖已有附件，不把较新通道降级。

### 本地保留与清理

`~/.ncurator/release-work`（Windows）或系统临时目录（非 Windows）：prepare/test 临时目录，阶段结束删除。`~/.ncurator/release-candidates`：发布并公开验证后只保留本平台最新候选及其 E2E 结果。`~/.ncurator/release-tools`：可复用构建缓存，不随发布删除。

## 3. 自动更新通道

每个发行包内置固定更新地址；下列为国内 COS，国际包使用相同路径并将域名换为 `download.ncurator.com`。线路设置不参与更新地址解析。

```text
Windows 清单：https://download.guanzhangai.cn/releases/latest/windows.json
macOS 清单：https://download.guanzhangai.cn/releases/latest/macos.json
Windows 更新：https://download.guanzhangai.cn/updates/latest/latest.yml
macOS 更新：https://download.guanzhangai.cn/updates/latest/latest-mac.yml
```

官网下载页写死上述清单地址，`fetch` 后导航到 artifacts；不要 `fetch` 整包。

模拟更新 E2E（`sidebar-app-update`、`database-version-update-required` 与 `pnpm test:update*`）见 `doc/test-plan/workbench-test.md`，不证明真实安装成功。

## 4. Windows 真实覆盖升级测试

本测试验证已安装的 Windows 客户端真实覆盖升级与禁止降级，不属于日常 E2E 或发布回归门禁。它使用离线本地 feed，不接触生产更新通道。

### 执行命令

```bash
pnpm test:update:real:win -- \
  --source-installer <已发布旧版安装包.exe> \
  --source-version 1.0.3 \
  --expected-version 1.0.4 \
  --downgrade-installer <含禁止降级逻辑的较低版本候选包.exe>
```

### 测试边界

- 脚本为 `scripts/test/update-real-windows.mjs`，不在 `tests/case/**`，不进入 runner、`test:update` 或发布命令。
- 使用离线本地 HTTP feed 托管新版安装包与 `latest.yml`，不触碰生产通道。
- 使用独立安装目录和 user-data；结束后卸载测试版本并恢复缓存。
- `--source-installer` 应复现不含本次修复的已发布旧包；`--expected-version` 使用当前代码构建的更高版本。

### 通过条件

- 静默覆盖升级成功，不出现 `Failed to uninstall old application files`。
- 运行版本变为 `--expected-version`，升级前写入的 marker 保留。
- 提供 `--downgrade-installer` 时，升级后安装较低版本必须被拒绝，版本和 marker 均保持不变。
- 两个安装包都必须包含新版 NSIS 防降级保护，不能使用历史旧包替代。

报告写入：

```text
tests/logs/settings/update/real-windows/<运行时间>/report.json
```
