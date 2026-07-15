# NCurator Logo 资源包

这个目录是 NCurator 的 logo 成品包，可以直接复制到其他项目或设计资料里使用。

## 主要文件

- `ncurator-logo.svg`：主源文件，后续想继续调整 logo 时用它。
- `ncurator-logo-small.svg`：小尺寸专用源文件，适合生成 16-64px 小图标。
- `ncurator-logo-1024.png`：主 PNG 图标，适合应用内展示和高清场景。
- `ncurator-logo-windows-1024.png`：Windows 专用母版，有效图形占画布约 96%。
- `ncurator-logo.icns`：macOS 应用图标。
- `ncurator-logo.ico`：从 Windows 专用母版生成的多尺寸应用图标。

## PNG 尺寸

`png/` 目录里放的是不同尺寸的 PNG：

- `ncurator-logo-1024.png`
- `ncurator-logo-512.png`
- `ncurator-logo-256.png`
- `ncurator-logo-128.png`
- `ncurator-logo-64.png`
- `ncurator-logo-48.png`
- `ncurator-logo-32.png`
- `ncurator-logo-24.png`
- `ncurator-logo-16.png`

其中 16-64px 使用的是 `ncurator-logo-small.svg` 导出的简化版，避免小图标糊成一团。

## 当前项目使用位置

项目里这些文件已经替换成新版 logo：

- `resources/icon.png`：主进程窗口图标、应用内品牌图标。
- `build/icon.png`：Linux 打包图标。
- `build/icon.icns`：macOS 打包图标。
- `build/icon.ico`：Windows 打包图标。
- `src/renderer/src/assets/icon.png`：渲染层备用图标资源。

`electron-builder.yml` 已经显式指定：

- Windows 使用 `build/icon.ico`
- macOS 使用 `build/icon.icns`
- Linux 使用 `build/icon.png`

Windows 与 macOS 使用不同的安全留白比例。Windows ICO 包含 16、20、24、32、40、48、64、128 和 256px 图层，避免任务栏按带宽留白的 macOS 图标再次缩小。

## 设计说明

这版 logo 的核心是“憨厚可靠的工作伙伴”。

黑色圆形是稳定底座，代表工具的可靠性。帽檐和思考点轻微跳出圆形，表达产品里“俺想想”的气质：不是冷冰冰地正在处理，而是像一个会帮用户琢磨办法的伙伴。
