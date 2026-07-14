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
- macOS 使用一张长期固定的自签名代码证书建立更新身份，不依赖付费 Developer ID。
- 用户也可以在 `设置 -> 应用更新` 手动检查。
- 找到新版本后，应用从 `https://download.ncurator.com/updates/latest` 下载更新包。
- 下载完成后，用户可以点击重启安装。

macOS 发布包必须满足以下条件：

- 不是 ad-hoc 签名。
- Intel 和 Apple 芯片版本使用同一张证书。
- 所有后续版本继续使用同一张证书和 `com.yoan.ncurator` Bundle ID。
- CI 中 `codesign --verify --deep --strict` 校验通过。
- designated requirement 不能退化成随版本变化的 `cdhash`。

不满足任一条件时 CI 会停止发布，应用运行时也会关闭 macOS 自动更新，不会先下载完整更新包再安装失败。

当前还没有公开用户，因此第一个公开版本必须直接使用这张固定证书。只要首版开始保持同一身份，就不需要设计旧版迁移流程。

## 8. 当前签名限制

- macOS 没有 Developer ID 和 Apple 公证，因此首次打开时仍可能需要用户右键选择“打开”或在系统设置中允许。
- 自签名证书只用于保证 Ncurator 新旧版本属于同一更新身份，不能让 Gatekeeper 把应用识别为受 Apple 信任的开发者。
- Windows 还没有代码签名证书，SmartScreen 可能提示未知发布者。
- 自动更新文件通过 HTTPS 从 R2 下载，并进行 `sha512` 与 macOS 代码签名双重校验；任一校验失败都不会安装。

## 9. macOS 自签名证书

在首个公开版本发布前，只创建一次长期证书：

1. 在 macOS“钥匙串访问 -> 证书助理 -> 创建证书”中创建自签名根证书。
2. 名称固定为 `Ncurator Update Signing`，证书类型选择“代码签名”，有效期建议设置为 20 年。
3. 导出包含私钥的 `.p12`，并设置强密码。
4. 另外导出不含私钥的公开 `.cer`。
5. 将 `.p12`、密码和公开证书写入 GitHub Actions Environment `ncuratore` 的 Secrets。

Secrets：

- `MAC_CSC_LINK`：`.p12` 的 base64 内容或安全下载地址。
- `MAC_CSC_KEY_PASSWORD`：证书密码。
- `MAC_CSC_CERT_BASE64`：公开 `.cer` 的 base64 内容。

`.p12` 和私钥禁止提交到仓库。公开 `.cer` 可以公开，但当前只通过 Secret 提供给临时 CI runner。

这张证书是现有安装进入后续自动更新的根身份：

- 不得重新生成同名证书替换。
- 不得丢失 `.p12` 和密码，必须离线备份。
- 两个 macOS 架构和所有版本必须使用同一个 `.p12`。
- 如果更换证书，已经安装的用户将无法直接自动更新，需要重新下载安装。

CI 会临时信任公开证书，让构建工具可以使用自签名身份；runner 销毁后不会留下证书。用户电脑不需要安装这张证书。

## 10. R2 自动更新目录

客户端只访问 Cloudflare R2，不从 GitHub 拉取更新：

- Windows 元数据：`https://download.ncurator.com/updates/latest/latest.yml`
- macOS 元数据：`https://download.ncurator.com/updates/latest/latest-mac.yml`
- 版本化更新包：`https://download.ncurator.com/updates/vX.Y.Z/*`

发布顺序固定为：

1. 上传带版本号的更新包到 `updates/vX.Y.Z`，使用长期不可变缓存。
2. 从公网地址校验文件大小。
3. 最后更新 `updates/latest` 元数据，使用 `no-store`。
4. 再从公网读取最新元数据，确认版本号和版本化下载地址正确。

`updates/latest` 只保存很小的入口元数据，实际安装包始终从不可变的版本目录下载，避免 CDN 缓存把新旧文件混在一起。

## 11. 自动更新测试

- 单元测试和模拟 E2E 可以随功能开发执行。
- 真实更新测试不设置成每次发版自动执行，只在明确要求测试时运行，例如 `pnpm test:update:real -- --source-version 0.1.1 --expected-version 0.1.2`。
- 真实测试必须使用固定自签名证书构建旧版本，并从 R2 下载已经发布的新版本。
- 真实测试验证版本发现、完整下载、`sha512`、签名替换、重启版本和用户数据保留。
