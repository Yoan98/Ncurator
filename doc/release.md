# Ncurator 发版说明

## 1. 三个发布位置的职责

- 源码仓库 `Yoan98/Ncurator-Desktop`：保存源码、Tag 和 GitHub Actions。
- 公共 Release 仓库 `Yoan98/Ncurator`：保存安装包和自动更新文件，供应用内更新使用。
- Cloudflare R2 `https://download.ncurator.com`：保存官网安装包，供用户首次下载安装。

官网不直接使用 GitHub Release 下载链接。应用内自动更新目前仍然使用 GitHub Release，两者不要混用。

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

- 打包后的应用会自动检查更新。
- 用户也可以在 `设置 -> 应用更新` 手动检查。
- 找到新版本后，应用在后台下载 GitHub Release 中的更新包。
- 下载完成后，用户可以点击重启安装。

应用内更新仍走 GitHub，不走 `download.ncurator.com`。以后如果要迁移，必须同时修改 electron-builder 发布配置和更新服务，不能只替换官网链接。

## 8. 当前签名限制

- macOS 还没有 Apple 公证，首次打开时可能需要用户在系统设置中允许。
- Windows 还没有代码签名证书，SmartScreen 可能提示未知发布者。
- 自动更新文件会通过 `sha512` 校验，校验失败不会安装。
