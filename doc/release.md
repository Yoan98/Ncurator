# Ncurator 发版说明

## 1. 发布仓库

- 发布仓库：`Yoan98/Ncurator`
- 发布仓库类型：公开仓库
- 源码仓库 GitHub Actions Secret：`NCURATOR_RELEASE_TOKEN`
- 应用内更新源：GitHub Releases

`NCURATOR_RELEASE_TOKEN` 只给 GitHub Actions 上传 Release 产物使用，不会被打进应用，也不会暴露给用户端。

## 2. 发布产物

Windows 发布：

- `Ncurator-<version>-setup-x64.exe`
- `latest.yml`
- `*.blockmap`

macOS 发布：

- `Ncurator-<version>-x64.dmg`
- `Ncurator-<version>-arm64.dmg`
- `Ncurator-<version>-mac-x64.zip`
- `Ncurator-<version>-mac-arm64.zip`
- `latest-mac.yml`
- `*.blockmap`

macOS 的 `dmg` 给用户首次安装使用，`zip` 给自动更新使用。Electron macOS 自动更新底层使用 Squirrel.Mac，它要求更新包是 zip，不使用 dmg 作为更新包。

macOS x64 和 arm64 在 CI 中分开打包，因为网页抓取 sidecar 会按 runner CPU 架构构建。发布 job 会在上传前合并两边生成的 `latest-mac.yml`，确保同一个更新元数据同时包含 Intel 与 Apple Silicon 产物。

## 3. 正常发版流程

1. 修改 `package.json` 的 `version`，例如改为 `0.1.1`。
2. 提交版本变更。
3. 创建并推送同版本 tag：

```bash
git tag v0.1.1
git push origin v0.1.1
```

4. GitHub Actions 自动构建 macOS 和 Windows 安装包。
5. 构建完成后，发布 workflow 会把所有产物上传到 `Yoan98/Ncurator` 的 GitHub Release。
6. 已安装旧版本的用户会通过应用内更新拿到新版本。

tag 版本必须和 `package.json` 里的版本一致，例如 `package.json` 是 `0.1.1`，tag 就用 `v0.1.1`。

## 4. 用户端更新流程

- 打包后的应用启动几秒后会自动检查更新。
- 用户也可以打开 `设置 -> 应用更新`，点击 `检查更新`。
- 如果发现新版本，应用会在后台下载更新包。
- 下载完成后，用户点击 `重启安装`，应用会退出并安装新版本。
- 如果更新已下载但用户没有立刻点击安装，退出应用时更新器也可以在退出阶段完成安装。

## 5. 当前免费发布方案的限制

- macOS 应用没有 Apple 公证，首次安装时可能需要用户在系统设置里手动允许打开。
- Windows 应用没有代码签名证书，SmartScreen 可能会显示未知发布者提示。
- 更新包会通过更新元数据中的 `sha512` 校验，下载内容被篡改时不会继续安装。
- 当前更新文件托管在 GitHub Releases。中国大陆网络环境下，下载速度和稳定性可能不如国内对象存储或 CDN。

## 6. 后续可升级方案

如果国内用户反馈 GitHub 下载不稳定，可以把更新源从 GitHub Releases 切到通用静态更新源：

- 阿里云 OSS + CDN
- 腾讯云 COS + CDN
- 七牛云对象存储
- 自己的服务器静态文件目录

这类方案仍然可以保留 GitHub Actions 打包，只是在最后一步把产物同步到国内存储，并把 `electron-builder.yml` 的 `publish` 改为 `generic` 更新源。

商业化后再补：

- Apple Developer ID + notarization
- Windows 代码签名证书
- 国内 CDN 正式更新通道
