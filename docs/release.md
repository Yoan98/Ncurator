# Chrome 与 Edge 商店发布

本页包含商店文案、宣传资源说明和自动发布方法。发布凭据只保存在本机 `.env`，禁止提交到 Git 或发送到公开渠道。

## 当前版本

- 插件版本：`1.0.0`
- Chrome：已提交审核
- Microsoft Edge：已提交审核

审核通过后，确认两个商店的线上版本均为 `1.0.0`。如果审核被拒绝，根据商店给出的具体原因修改后重新提交。

## 商店文案（简体中文）

### 名称

馆长: AI助手

### 简短说明

馆长是你的 AI 工作伙伴，帮你查资料、使用知识库和写文档。浏览器插件支持查看收藏夹并一键复制全部网址。

### 详细说明

馆长是你的 AI 工作伙伴。你安排任务，让馆长帮你查资料、使用本地知识库、整理信息和编写文档。

馆长的完整能力已经升级至 macOS 和 Windows 桌面端。在浏览器中，馆长提供一个简单、专注的收藏夹工具：查看浏览器收藏夹，并将全部网址一次复制到剪贴板。复制结果每行一个网址，方便保存、整理，或交给馆长继续处理。

浏览器插件功能：

- 查看收藏夹标题、文件夹路径和网址
- 一键复制全部收藏网址
- 保持浏览器中的原始排列顺序
- 支持多层收藏夹目录
- 所有收藏夹数据只在浏览器本地处理

隐私说明：

插件只读取收藏夹，不会创建、修改或删除任何收藏内容。收藏夹标题、目录和网址不会发送到馆长或任何第三方服务器。插件不包含广告、分析和跟踪代码。

访问官网，下载馆长桌面端，体验完整的 AI 工作伙伴能力。

### 审核资料

单一用途：读取并展示用户的浏览器收藏夹，将其中的网址按每行一个的格式复制到剪贴板。

`bookmarks` 权限说明：插件使用 `bookmarks` 权限读取收藏夹标题、目录和网址，以便用户查看并复制网址。插件不会创建、修改或删除收藏夹，所有处理均在浏览器本地完成。

远程代码：不使用远程代码。插件的全部可执行代码均包含在提交的扩展程序安装包中。

数据使用：插件会在本地访问收藏夹数据，但不会收集、保存、上传、出售或与第三方共享这些数据。

审核备注：此版本是原有浏览器扩展的全新轻量版本。旧版浏览器 AI 功能已迁移至桌面端，当前扩展只提供收藏夹网址查看和复制功能。新版删除了不再需要的网页访问、脚本注入和侧边栏权限，只保留读取收藏夹所必需的 `bookmarks` 权限。插件不修改收藏夹，不收集或上传用户数据，无需登录或测试账号。

测试步骤：

1. 安装扩展并点击浏览器工具栏中的馆长图标。
2. 弹窗会显示浏览器收藏夹中的网址数量和列表。
3. 点击“复制全部网址”。
4. 将剪贴板内容粘贴到文本编辑器，每个网址应单独占一行。

## Store copy (English)

### Name

Ncurator: AI Assistant

### Short description

Ncurator is your AI work partner for research, knowledge, and documents. The extension lets you view bookmarks and copy every URL in one click.

### Detailed description

Ncurator is your AI work partner. Give it a task and let it research, use your local knowledge base, organize information, and create documents.

The complete Ncurator experience is available on macOS and Windows. In your browser, Ncurator provides a simple, focused bookmark tool: view your browser bookmarks and copy every URL to the clipboard in one click. Each URL is placed on its own line, ready to save, organize, or continue working with in Ncurator.

Browser extension features:

- View bookmark titles, folder paths, and URLs
- Copy every bookmarked URL in one click
- Preserve the browser's original bookmark order
- Support nested bookmark folders
- Process all bookmark data locally in the browser

Privacy:

The extension only reads bookmarks. It never creates, changes, or deletes bookmark content. Bookmark titles, folders, and URLs are never sent to Ncurator or any third-party server. The extension contains no advertising, analytics, or tracking code.

Visit the official website to download Ncurator for desktop and access the complete AI work partner experience.

### Certification information

Single purpose: Read and display browser bookmarks, then copy their URLs to the clipboard with one URL per line.

`bookmarks` permission justification: The permission is used to read bookmark titles, folders, and URLs so users can review and copy them. The extension never creates, changes, or deletes bookmarks. All processing happens locally in the browser.

Remote code: No remote code is used. All executable code is included in the submitted extension package.

Data usage: The extension accesses bookmark data locally but does not collect, store, upload, sell, or share it with third parties.

Certification notes: This release is a new lightweight version of the existing browser extension. The previous browser-based AI features have moved to the desktop app. The current extension only displays bookmark URLs and copies them to the clipboard. This release removes unnecessary website access, script injection, and side-panel permissions, retaining only the `bookmarks` permission required for its core function. No login or test account is required.

Test steps:

1. Install the extension and click the Ncurator toolbar icon.
2. The popup displays the number and list of bookmarked URLs.
3. Click “Copy all URLs.”
4. Paste the clipboard into a text editor. Each URL should appear on its own line.

## 宣传资源

所有发布图片均为 PNG。可编辑的 HTML、公开产品截图和官方 SVG Logo 位于 `store-assets/source/`。

Chrome：

- `store-assets/chrome/icon-128.png`：128x128 商店图标
- `store-assets/chrome/screenshot-1280x800-01.png`：馆长产品概览
- `store-assets/chrome/screenshot-1280x800-02.png`：桌面端知识工作流程
- `store-assets/chrome/screenshot-1280x800-03.png`：浏览器收藏夹工具
- `store-assets/chrome/promo-440x280.png`：小宣传图
- `store-assets/chrome/marquee-1400x560.png`：大宣传图

Microsoft Edge：

- `store-assets/edge/logo-300x300.png`：商店 Logo
- `store-assets/edge/screenshot-1280x800-01.png`：馆长产品概览
- `store-assets/edge/screenshot-1280x800-02.png`：桌面端知识工作流程
- `store-assets/edge/screenshot-1280x800-03.png`：浏览器收藏夹工具
- `store-assets/edge/promo-440x280.png`：小宣传图
- `store-assets/edge/promo-1400x560.png`：大宣传图

## 构建发布包

先更新 `package.json` 中的版本号，然后执行：

```bash
npm install
npm run check
npm run zip:stores
```

Chrome 和 Edge 的 ZIP 文件会生成到 `.output/`。

## 配置发布凭据

首次配置：

```bash
cp .env.example .env
chmod 600 .env
```

需要填写的变量：

- Chrome：扩展 ID、发布者 ID、服务账号邮箱、服务账号私钥
- Edge：产品 ID、客户端 ID、API Key
- `STORE_PROXY_URL`：可选；目标电脑需要代理才能访问商店 API 时再填写

Chrome 服务账号必须已添加到对应的 Chrome Web Store 开发者账号。Edge API Key 到期后，需要在 Partner Center 创建新 Key 并更新 `.env`。

如果拿到新的 Google 服务账号 JSON 密钥，可以导入到 `.env`：

```bash
node scripts/import-chrome-key.mjs /绝对路径/service-account.json
```

`.env` 包含可直接发布商店版本的高敏感凭据。只通过安全方式在自己的设备间传输，不要上传到 Git、网盘公开链接、聊天群或工单。

## 自动发布

先执行只检查、不上传的命令：

```bash
npm run release:dry-run
```

分别发布：

```bash
npm run release:chrome
npm run release:edge
```

同时发布：

```bash
npm run release:stores
```

只上传 Edge 草稿、不提交审核：

```bash
npm run release:edge:draft
```

自动发布只上传安装包并提交审核。商店名称、说明、隐私声明和宣传图片发生变化时，仍应登录商店后台核对或更新。

## 新电脑发布

新电脑需要：

1. 获取本仓库代码并安装兼容版本的 Node.js 和 npm。
2. 通过安全方式复制 `.env` 到仓库根目录，并执行 `chmod 600 .env`。
3. 检查 `STORE_PROXY_URL` 是否适用于新电脑；不需要代理时留空。
4. 执行 `npm install` 和 `npm run release:dry-run`。
5. 检查无误后执行正式发布命令。

只要服务账号仍获授权、Edge API Key 未过期或撤销，原 `.env` 可以继续使用。每次发布仍需同步最新代码、更新版本号，并重新构建安装包。

## 公开仓库安全边界

可以提交到 GitHub：

- 插件源码、测试和构建配置
- 本文档中的公开产品介绍和官网链接
- 商店文案、Logo、宣传图片和公开产品截图
- `.env.example` 中不含真实凭据的变量模板

禁止提交：

- `.env` 和服务账号 JSON 文件
- Chrome 服务账号私钥
- Edge API Key 或其他访问令牌
- 未公开的桌面端源码、内部设计文档和用户数据

提交前可运行：

```bash
git status --short
git diff --cached
git check-ignore .env
```

最后一条应显示 `.env` 已被 `.gitignore` 忽略。
