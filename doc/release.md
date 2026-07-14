# Ncurator 发版说明

## 1. 三个发布位置的职责

- 源码仓库 `Yoan98/Ncurator-Desktop`：保存源码、Tag 和 GitHub Actions。
- 公共 Release 仓库 `Yoan98/Ncurator`：保存完整发布归档，也作为 R2 同步来源。
- Cloudflare R2 `https://download.ncurator.com`：保存官网安装包和应用内自动更新文件。

官网安装包使用 R2 的 `releases/latest`，应用内自动更新使用 R2 的 `updates/latest`。

`NCURATOR_RELEASE_TOKEN` 只供 GitHub Actions 向公共 Release 仓库上传文件，不会被打进应用。

## 2. 发布产物

Windows：

- `Ncurator-windows-x64.exe`：官网安装包。
- `latest.yml` 和 `*.blockmap`：应用内自动更新文件。

macOS：

- `Ncurator-mac-x64.dmg`：Intel Mac 官网安装包。
- `Ncurator-mac-arm64.dmg`：Apple 芯片 Mac 官网安装包。
- `Ncurator-mac-x64.zip`、`Ncurator-mac-arm64.zip`、`latest-mac.yml` 和 `*.blockmap`：应用内自动更新文件。

macOS 的 `dmg` 用于首次安装，`zip` 用于应用内自动更新。CI 会分别构建 Intel 和 Apple 芯片版本，再合并更新信息。

## 3. 官网固定下载地址

官网始终使用下面三个地址，发布新版本后不用修改官网：

- Apple 芯片 Mac：`https://download.ncurator.com/releases/latest/Ncurator-mac-arm64.dmg`
- Intel 芯片 Mac：`https://download.ncurator.com/releases/latest/Ncurator-mac-x64.dmg`
- Windows 64 位：`https://download.ncurator.com/releases/latest/Ncurator-windows-x64.exe`

每个版本也有不会变化的独立地址，例如：

`https://download.ncurator.com/releases/v0.1.1/Ncurator-windows-x64.exe`

版本目录使用长期缓存，不能覆盖旧版本。`latest` 目录只缓存 5 分钟，可以指向新版本。

## 4. Release 文案

Release 文案不保存到仓库文件中。每次发布前由 Codex 根据本次改动生成简短、面向用户的中文文案。

文案保存在源码仓库的 Annotated Tag（带说明的 Tag）里。发布工作流会读取 Tag 正文，并创建或更新公共 Release 的标题和正文。

必须使用 Annotated Tag，普通 Tag 会被工作流拒绝。

示例：

```bash
git tag -a v0.1.1 -F /tmp/ncurator-v0.1.1-release-notes.md
git push origin v0.1.1
```

临时文案文件只用于创建 Tag，不提交到仓库。

## 5. 正常发版流程

1. 完成本次功能和测试。
2. 修改 `package.json` 的 `version`。
3. 提交并推送源码。
4. 生成本版本的中文用户文案。
5. 创建同版本的 Annotated Tag 并推送，例如 `package.json` 是 `0.1.1`，Tag 必须是 `v0.1.1`。
6. GitHub Actions 分别构建 macOS Intel、macOS Apple 芯片和 Windows 安装包。
7. CI 将完整安装包和更新文件发布到 `Yoan98/Ncurator`。
8. CI 先上传并验证 R2 的版本目录，验证成功后才更新并验证 `latest` 目录。

如果 Tag 版本、`package.json` 版本或 Tag 文案不符合要求，发布会直接停止。

## 6. R2 验证和回滚

上传后，CI 会检查三个安装包的文件大小和下载文件名。只有版本目录全部验证成功，才会更新官网的 `latest`。

如果正式发布流程中的 R2 同步失败，可以手动运行 `Sync Release to Cloudflare R2`，输入要恢复的 Tag。这个流程同样会先验证版本目录，再更新 `latest`。

需要回滚官网时，手动同步上一个正常版本的 Tag 即可。版本目录不会被删除，公共 GitHub Release 和应用内更新不会自动跟着回滚。

## 7. 应用内更新

- Windows 打包应用会自动检查更新。
- macOS 只有通过 Developer ID 正式签名后才启用自动更新。
- 用户也可以在 `设置 -> 应用更新` 手动检查。
- 找到新版本后，应用从 `https://download.ncurator.com/updates/latest` 下载更新包。
- 下载完成后，用户可以点击重启安装。

未签名的 macOS 构建会直接显示签名原因，不会先下载完整更新包再安装失败。

## 8. 当前签名限制

- macOS 还没有 Developer ID 签名和 Apple 公证，因此当前不会启用自动更新，首次打开时也可能需要用户在系统设置中允许。
- Windows 还没有代码签名证书，SmartScreen 可能提示未知发布者。
- 自动更新文件会通过 `sha512` 校验，校验失败不会安装。

启用 macOS 自动更新时，在 GitHub Actions Environment `ncuratore` 中配置：

- `MAC_CSC_LINK`：Developer ID Application 证书的 base64 内容或安全下载地址。
- `MAC_CSC_KEY_PASSWORD`：证书密码。

CI 检测到证书后会自动签名。应用运行时也会检查 Developer ID，签名有效才启用 macOS 自动更新。
