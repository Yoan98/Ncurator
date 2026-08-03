# 馆长

<p align="center">
  <img src="./store-assets/source/logo/ncurator-logo.svg" alt="馆长" width="108" />
</p>

<p align="center">
  你的 AI 工作伙伴。你安排任务，让馆长帮你完成。
</p>

<p align="center">
  <a href="https://www.ncurator.com/zh">官网</a> ·
  <a href="https://www.ncurator.com/zh/manual">使用手册</a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://download.ncurator.com/downloads/latest/windows-x64.exe">下载 Windows</a> ·
  <a href="https://download.ncurator.com/downloads/latest/macos-arm64.dmg">下载 macOS（Apple 芯片）</a> ·
  <a href="https://download.ncurator.com/downloads/latest/macos-x64.dmg">下载 macOS（Intel 芯片）</a>
</p>

<div align="center">
  <video controls muted loop playsinline width="100%" poster="https://www.ncurator.com/media/ncurator-customer-meeting-poster.jpg" aria-label="馆长真实产品演示">
    <source src="https://www.ncurator.com/media/ncurator-customer-meeting.mp4" type="video/mp4" />
    你的浏览器不支持视频播放，请前往<a href="https://www.ncurator.com/zh">官网观看演示</a>。
  </video>
</div>

馆长是面向日常知识工作的桌面端 AI 助手。它可以在工作空间中查找资料、使用本地知识库、搜索网页、操作浏览器，并完成文档相关任务。桌面端支持 macOS 和 Windows。

> 本仓库只包含馆长浏览器插件的源码。

## 桌面端

### 交代任务，馆长执行

把任务和所需资料交给馆长，它会根据工作空间中的文件、知识库和网页信息推进工作。适合整理资料、提炼结论、查找信息和编写文件等场景。

### 使用你的本地知识库

工作空间可以配置本地目录，也可以按需加入网址。馆长会为这些资料建立索引，在回答和执行任务时查找相关内容，让结果更贴近你的工作上下文。资料或网址更新后，可以重新更新索引。

![馆长结合会议资料和本地知识库给出结论](./store-assets/source/media/desktop-knowledge.png)

### 自己选择模型和费用

桌面端免费使用。你配置自己的模型服务地址和 API Key，并按模型服务商的实际用量付费。使用本地知识库前，需要下载向量模型；知识库检索可减少馆长查阅本地资料时的 Token 消耗。

支持单独选择主模型和视觉模型。视觉模型可读取工作空间内的 JPG、JPEG、PNG、WebP、GIF 和 BMP 图片。

## 能力一览

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| AI 自主完成任务 | 已支持 | 在工作空间中执行你交代的任务 |
| 本地知识库 | 已支持 | 为本地目录和可选网址建立索引并检索 |
| 网页搜索 | 已支持 | 查找公开网页信息 |
| 浏览器操作 | 已支持 | 使用浏览器完成任务步骤 |
| DOCX | 已支持 | 读取和处理 Word 文档任务 |
| PPT | 已支持 | 处理演示文稿任务 |
| PDF | 只读 | 读取 PDF 内容 |
| Excel | 已支持 | 处理表格任务 |
| 协作记忆 | 开发中 | 能力仍在完善 |
| 浏览器收藏夹 | 需插件 | 安装下方浏览器插件后可读取 |

## 三步开始使用

1. 下载并安装适合自己设备的桌面端版本。
2. 在馆长中添加模型服务地址和 API Key。
3. 创建工作空间，配置可供馆长使用的本地目录；需要知识库时下载向量模型并更新索引。

完整配置、视觉模型和 macOS 安装说明见[官方使用手册](https://www.ncurator.com/zh/manual)。

## 浏览器插件

浏览器插件是一个轻量收藏夹工具，用来配合你的资料整理流程：

- 查看收藏夹标题、目录和网址，支持多层文件夹。
- 一键复制全部收藏网址，每行一个，并保持浏览器原有顺序。
- 仅申请 `bookmarks` 权限；不会创建、修改或删除收藏夹。
- 收藏夹数据只在浏览器本地处理，不上传、不跟踪，也不与桌面端交换数据。

<p>
  <a href="https://chromewebstore.google.com/detail/ncurator-knowledge-base-a/jdlfflbeekclkgcckcfombmfojmcdeio?hl=zh-CN">安装到 Chrome</a> ·
  <a href="https://microsoftedge.microsoft.com/addons/detail/hkdfdbpkmkpooopbkdghecbaipeoijpj">安装到 Microsoft Edge</a>
</p>

## 此仓库

这里维护馆长浏览器插件，目标浏览器为 Chrome 和 Microsoft Edge，使用 Manifest V3。插件不依赖桌面端，桌面端也不读取插件中的收藏夹数据。

### 本地开发

```bash
npm install
npm run dev
```

在 Chrome 扩展程序页面启用开发者模式后，加载 `.output/chrome-mv3`。Edge 使用：

```bash
npm run dev:edge
```

然后加载 `.output/edge-mv3`。

### 验证与构建

```bash
npm run check
npm run zip:stores
```

更多开发资料：

- [浏览器插件架构](./docs/architecture.md)
- [Chrome 与 Edge 商店发布](./docs/release.md)

## 友链

- [LinuxDo 社区](https://linux.do/)
