# 桌面端发布说明

桌面端安装包和自动更新文件统一由 Cloudflare R2 提供。GitHub Release 只保存版本说明和 R2 下载链接，不保存二进制文件。

## 发布结构

- macOS arm64：在 Apple 芯片 Mac 本地构建。
- macOS x64：在同一台 Mac 的 Rosetta x64 Node/Python 环境构建。
- Windows x64：由 `.github/workflows/release.yml` 使用 GitHub Windows Runner 构建并直接上传 R2。
- GitHub Actions 不保存 Artifact，也不再运行 macOS 或 Linux 发布任务。

R2 目录：

```text
artifacts/vX.Y.Z/*             当前版本的全部安装包和更新文件
release-status/vX.Y.Z/*.json   三个平台的构建完成标记
updates/latest/latest.yml      Windows 最新版自动更新元数据
updates/latest/latest-mac.yml  macOS 最新版自动更新元数据
releases/latest.json           官网最新版下载清单
```

`latest.yml`、`latest-mac.yml` 和 `latest.json` 最后发布。它们更新之前，新版本不会被应用或官网发现。

版本文件使用一年不可变缓存，最新版元数据使用 `no-store`。

## R2 保留规则

新版本发布并通过公网校验后，发布脚本会删除：

- 旧的 `artifacts/vX.Y.Z`；
- 旧的 `release-status/vX.Y.Z`；
- 旧逻辑产生的 `updates/vX.Y.Z`；
- 旧逻辑产生的 `releases/vX.Y.Z` 和 `releases/latest/*` 安装包。

R2 稳态只保存最新版本。需要回滚时，从旧 Tag 重新构建并发布。

## 一次性本地配置

Mac 需要：

- 在登录钥匙串安装并信任固定的 `Ncurator Update Signing` P12；
- 安装 arm64 Node.js、pnpm 和 Python；
- 安装 Rosetta x64 Node.js 和 Python；
- 安装 AWS CLI；
- 配置 R2 环境变量；
- 如需自动创建 GitHub Release，配置 `NCURATOR_RELEASE_TOKEN`。

发布配置统一读取项目根目录 `.env`。R2 可以使用 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，脚本会自动映射成 AWS CLI 所需变量。`.env` 已加入 `.gitignore`，不得提交。

默认本地工具目录是 `~/.ncurator/release-tools`。也可以用 `NCURATOR_X64_NODE`、`NCURATOR_X64_PYTHON` 和 `NCURATOR_AWS_CLI` 指定其他路径。

首次导入签名证书：

```bash
pnpm release:signing:setup
```

敏感值不要写入仓库。

## 正式发布

1. 修改 `package.json` 版本并提交。
2. 创建带发布说明的 annotated Tag 并推送，例如 `v0.1.3`。
3. Tag 自动触发 Windows 构建并直传 R2。
4. 在 Mac 执行：

```bash
pnpm release:mac -- --tag v0.1.3
```

本地命令会：

1. 从 Tag 导出两份干净源码；
2. 分别构建 arm64 和 Rosetta x64；
3. 验证两个 App 使用相同的稳定签名；
4. 上传 macOS 文件；
5. 等待 Windows 文件；
6. 生成并发布最新元数据；
7. 创建只含 R2 链接的 GitHub Release；
8. 清理 R2 旧版本。

如果只想重新执行最后发布步骤：

```bash
pnpm release:r2:finalize -- --tag v0.1.3
```

调试时可以添加 `--keep-old` 暂时不删除旧版本。

## 下载地址

官网读取：

```text
https://download.ncurator.com/releases/latest.json
```

应用自动更新读取：

```text
https://download.ncurator.com/updates/latest/latest.yml
https://download.ncurator.com/updates/latest/latest-mac.yml
```

实际文件始终来自：

```text
https://download.ncurator.com/artifacts/vX.Y.Z/*
```

## 测试

基础测试：

```bash
pnpm typecheck
pnpm test:update:unit
pnpm test:update:e2e
```

真实自动更新只在明确需要时执行：

```bash
pnpm test:update:real -- --source-version 0.1.2 --expected-version 0.1.3
```

真实测试必须确认发现新版、R2 下载、sha512 校验、签名替换、重启版本和用户数据保留。
