# 产品命名（Brand）

## 命名层次

| 层         | 名称                         | 用途                                             |
| ---------- | ---------------------------- | ------------------------------------------------ |
| 中文界面   | 馆长                         | 简体中文界面的产品壳、标题、更新提示和通知文案   |
| 英文界面   | NCurator                     | 英文界面的产品壳、标题、更新提示和通知文案       |
| 国内发行包 | 馆长                         | 安装名称、快捷方式、卸载名称及国内下载文件名前缀 |
| 国际发行包 | NCurator                     | 安装名称、快捷方式、卸载名称及国际下载文件名前缀 |
| 技术标识   | ncurator / com.yoan.ncurator | 数据目录、协议、appId、缓存和发布内部标识        |

同一套代码提供国内和国际发行包，两者都内置简体中文与 English。界面品牌随有效语言显示，安装名称随发行包固定；切换界面语言或服务线路不会重命名已安装应用。伙伴名称仍优先使用用户填写的名称；界面占位的空名称按当前语言回落产品名。AI 提示词及其中的名称兜底保持原有契约，不随界面翻译改写。

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

界面语言、官方服务线路与发行包身份分别管理。发行标识只用于无有效配置时初始化服务线路；线路只有中国大陆和国际两个选项。国内包自动更新固定 COS，国际包固定 R2；不会因切换服务线路改变更新包身份。请求失败不跨线路重试。发布规则见[发布设计](deploy/design.md)与[发布流程](deploy/release.md)。
