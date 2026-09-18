# 桌面端发布设计

## 1. 平台与构建

### Windows

本地 Windows x64：Node.js 22 x64、项目指定 pnpm、Python 3.12 x64、Git、tar；发 COS 时还需 AWS CLI 与 COS 存储配置。仅未来海外版才需要 R2 配置。`pnpm release:doctor` 检查本机条件。prepare / test / publish 只消费本机候选包。

### macOS

prepare 必须在 Apple Silicon Mac；需已信任的 `Ncurator Update Signing` P12（自建更新签名，`timestamp: none`、`notarize: false`，非 Apple Developer ID 公证）。候选包须完成正式包 E2E。不构建、测试或发布 Intel Mac。

### 构建与审计硬约束

`pnpm run build`：准备 native 与网页抓取 sidecar → 类型检查与应用构建 → 追踪生产依赖并生成最小化 `release-stage/app` → 真实验证关键读取/写入路径 → 混淆 `out/main` → 审计 staging → electron-builder 打安装包 → 审计真实 `win-unpacked` / `.app`（macOS 另做签名与启动验证）。

electron-builder 只从 `release-stage/app` 打包。安装包不得含源码、测试、文档、开发配置、`.env`、锁文件、Source Map、测试日志、fixture、私钥或错误平台文件。网页抓取 sidecar 须保留 Playwright 驱动 JS，不得含 Playwright Node、`.local-browsers` 或 `chromium_headless_shell-*`，解包体积 ≤ 400 MiB。被定向裁剪的 Node 目录属审计禁区；trace 若触达则删除前构建失败。`app.asar` 非加密，`VITE_*` 按公开信息处理。使用 `maximum` 压缩。候选 bundle 绑定 Tag、commit、fragment、安装包、更新文件与哈希；测试与发布前复验。

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

当前正式发布只写 COS：环境变量 `SecretId` / `SecretKey`（或 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`）。桶与公开地址已固化为 `ncurator-1324873382` / `ap-guangzhou` / `https://download.guanzhangai.cn`，无需写入 `.env`。CDN、DNS、资费与采购见 [`tencent-cdn-billing.md`](./tencent-cdn-billing.md)。发布子用户权限模板：[`scripts/release/cos/cam-policy.json`](../../scripts/release/cos/cam-policy.json)。

国内官网 / 下载：`https://www.guanzhangai.cn`、`https://download.guanzhangai.cn`。海外官网 `www.ncurator.com` 存在，但当前桌面端发行包与自动更新只走国内通道。国内 COS 发布完成后不要再同步同一 Tag 到 R2。

仅当有意发布未来海外版时才切 R2（非当前常规循环）：`RELEASE_STORAGE_TARGET=r2`，并设置 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_ACCOUNT_ID`、`R2_BUCKET_NAME`、`R2_PUBLIC_BASE_URL=https://download.ncurator.com`。

publish 上传候选与 fragment，更新该平台自动更新 metadata 与官网 manifest，验证公开 yml / 清单 / artifacts 的大小、sha512 与 manifest URL（安装包 URL 须以用户可见文件名结尾）。验证成功后标记 `published`，清理本地 `tests/logs/**`，并清理该平台更早 artifacts（含旧 `release-status/`）。失败、prepare-only、test-only 不清理 logs。

### 本地保留与清理

`~/.ncurator/release-work`：prepare/test 临时目录，阶段结束删除。`~/.ncurator/release-candidates`：发布并公开验证后只保留本平台最新候选及其 E2E 结果。`~/.ncurator/release-tools`：可复用构建缓存，不随发布删除。

## 3. 自动更新通道

公开地址：

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
  --source-version 0.1.68 \
  --expected-version 0.1.69 \
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
