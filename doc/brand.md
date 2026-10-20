# 产品命名（Brand）

当前应用界面以中文为主；仓库提供中英文 README。用户可见名与工程标识分层，互不替代。

## 三层命名

| 层               | 名称                             | 用途                                                                                                                      | 当前阶段                             |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 用户可见（中文） | `馆长`                           | 窗口标题、侧边栏品牌、安装包 / 快捷方式 / 卸载名、更新 UI、公开下载文件名；伙伴名为空时的 AI 人设与 Composer/审批文案兜底 | **唯一对外品牌**                     |
| 英文品牌         | `NCurator`                       | 英文 README、海外资料、未来英文 UI                                                                                        | 英文文档可用；**中文版 UI 不得出现** |
| 技术标识         | `ncurator` / `com.yoan.ncurator` | npm name、userData、协议、env、签名、COS、发布 storageName                                                                | **冻结**                             |

规范：**中文版用户看见「馆长」；代码与磁盘认 `ncurator`；英文文档使用 `NCurator`。** 中文版 UI 出现 `NCurator` / `Ncurator` 视为缺陷。中文 README 使用「馆长」，英文 README 使用 `NCurator`，两版均需准确说明当前应用界面的语言支持范围。

会话层（当前伙伴）：Brain 系统提示自称、Composer 输入占位、审批「告诉…该怎么做」使用 `Partner.name`；名称为空时回落 `PRODUCT_NAME_ZH`。侧栏品牌行、更新提示、通知 logo、WPS 等产品壳文案仍用「馆长」，不跟伙伴名走。

代码常量：`PRODUCT_NAME_ZH` / `PRODUCT_NAME_EN`（`src/shared/constants.ts`）。中文版面向用户的字符串只使用 `PRODUCT_NAME_ZH`。

英文拼写统一为 **`NCurator`**；技术小写继续 `ncurator`。本地 artifact 历史名 `Ncurator-mac-*` 作为 storageName 可保留，不必为大小写强行改发布契约。

## 下载名 vs 缓存名

```text
用户下载看到的：  馆长-{version}-Windows-x64.exe / 馆长-{version}-macos-arm64.dmg
浏览器保存名：     同上（公开 URL 末段）
本地构建 / 磁盘：  馆长-{version}-Windows-x64.exe、Ncurator-mac-*.dmg（storageName，ASCII）
安装后应用名：     馆长.app / 馆长.exe
运行时数据目录：   …/ncurator（或 ncurator-dev）
更新缓存目录：     ncurator-updater
```

Windows / macOS **公开**安装包名与对象键均为「馆长-…」，与用户可见名一致。mac 本地 `electron-builder` 产物仍可为 `Ncurator-mac-*.dmg`，发布时映射到公开键；自动更新 zip / blockmap 继续走 ASCII storageName。

**不要**把 userData / updater 缓存改成「馆长」：已有用户目录，且中文路径更脆。

## 技术标识冻结清单

以下项**不得**为对齐中文品牌而改名（会丢用户数据或打断更新）：

- `package.json` `name` → userData（`ncurator` / `ncurator-dev`）
- `appId` / AppUserModelID：`com.yoan.ncurator`
- updater 缓存：`ncurator-updater`
- 工作区隐藏目录：`.ncurator`；开发者发布缓存：`~/.ncurator/…`
- 内嵌协议 / session：`ncurator://`、`persist:ncurator-browser` 等
- 本地构建与 fragment `storageName`（ASCII，如 `Ncurator-mac-*.dmg`）
- 更新签名证书 CN：`Ncurator Update Signing`
- COS 桶与 env 前缀：`ncurator-*`、`NCURATOR_*`

发布流程细节见 `doc/deploy/release.md`。`scripts/release/prepare.mjs` 里默认的 git tag `-m`（如 `Ncurator mac-v…`）只给发布同学看，不是用户可见品牌，可不改。

## 不做

- 当前未提供应用级 i18n；现有 UI 使用中文文案 + `PRODUCT_NAME_ZH`；中英文界面属于 README 中的后续规划
- 不把 mac / Windows 自动更新包的 storageName 改成中文文件名
- 不为显示名去改缓存目录或 appId
