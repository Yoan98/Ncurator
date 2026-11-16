# 产品命名（Brand）

## 命名层次

| 层         | 名称                         | 用途                                             |
| ---------- | ---------------------------- | ------------------------------------------------ |
| 中文界面   | 馆长                         | 简体中文界面的产品壳、标题、更新提示和通知文案   |
| 英文界面   | NCurator                     | 英文界面的产品壳、标题、更新提示和通知文案       |
| 国内发行包 | 馆长                         | 安装名称、快捷方式、卸载名称及国内下载文件名前缀 |
| 国际发行包 | NCurator                     | 安装名称、快捷方式、卸载名称及国际下载文件名前缀 |
| 技术标识   | ncurator / com.yoan.ncurator | 数据目录、协议、appId、缓存和发布内部标识        |

同一套代码提供国内和国际发行包，两者都内置简体中文与 English。界面品牌随有效语言显示，安装名称由发行包固定。伙伴名称优先使用用户填写的名称，界面占位的空名称按当前语言使用产品名。AI 提示词及其中的名称兜底遵循原有契约。

英文拼写统一为 `NCurator`，技术标识继续使用小写 `ncurator`。中英文 README 同步说明当前能力及语言支持。

## 下载与缓存命名

| 场景         | 国内发行包                     | 国际发行包                         |
| ------------ | ------------------------------ | ---------------------------------- |
| Windows 下载 | 馆长-{version}-Windows-x64.exe | NCurator-{version}-Windows-x64.exe |
| macOS 下载   | 馆长-{version}-macos-arm64.dmg | NCurator-{version}-macos-arm64.dmg |
| 安装后       | 馆长.exe / 馆长.app            | NCurator.exe / NCurator.app        |
| 发布位置     | COS 国内下载站                 | R2 国际下载站、GitHub Releases     |

公开 URL 末段使用对应用户可见下载名；浏览器保存名与之相同。本地构建和 fragment 的 `storageName` 保持 ASCII，例如 `Ncurator-mac-arm64.dmg`；每个发行包通过独立产物目录隔离，不为展示名改动更新 zip、blockmap 的内部命名。

## 技术标识约束

两种发行包视为同一应用，不设计同时安装。以下身份保持稳定：

- npm `name`、userData：`ncurator` / `ncurator-dev`。
- appId / AppUserModelID：`com.yoan.ncurator`。
- 更新缓存：`ncurator-updater`；工作区目录：`.ncurator`。
- 协议与浏览器 session：`ncurator://`、`persist:ncurator-browser`。
- 更新签名：`Ncurator Update Signing`。
- 环境变量前缀、存储桶和内部缓存标识中的 `ncurator`。

## 语言与发行边界

安装包的发行标识决定所属官网、官方 API 和自动更新渠道。语言独立选择。具体行为见[设置 PRD](prd/settings.md)和[发布设计](deploy/design.md)。
