# 浏览器插件架构

本文只描述馆长浏览器插件。桌面端是独立产品，本仓库不包含、引用或说明其源码与内部实现。

## 产品范围

插件名称：

- 中文：馆长: AI助手
- 英文：Ncurator: AI Assistant

插件提供一个简单的收藏夹工具：

- 读取并展示浏览器收藏夹中的标题、目录和网址
- 支持多层收藏夹目录
- 保持浏览器中的原始排列顺序
- 一键复制全部网址，每行一个
- 引导用户前往[馆长官网](https://www.ncurator.com/zh)了解和下载桌面端

桌面端的公开介绍仅用于品牌展示。插件不依赖桌面端，也不与桌面端交换数据。

## 技术栈

- React：弹窗界面
- TypeScript：类型检查和业务逻辑
- Vite：前端构建
- WXT：浏览器扩展开发、Manifest 生成、打包和发布
- Tailwind CSS：界面样式
- Vitest：单元测试

目标浏览器为 Chrome 和 Microsoft Edge，使用 Manifest V3。

## 目录结构

```text
entrypoints/popup/       插件弹窗入口、界面和样式
lib/                     收藏夹整理、剪贴板和国际化逻辑
public/_locales/         中英文浏览器扩展文案
public/icons/            安装包图标
scripts/                 Chrome 与 Edge 发布脚本
store-assets/            商店宣传图片和可编辑源文件
docs/                    架构与发布文档
wxt.config.ts            WXT、Manifest 和权限配置
```

构建产物生成在 `.output/`，发布压缩包生成在 `.output/*.zip`。这些文件不会提交到 Git。

## 运行流程

1. 用户点击浏览器工具栏中的插件图标。
2. 弹窗通过浏览器 `bookmarks` API 读取收藏夹树。
3. `lib/bookmarks.ts` 递归整理目录路径、标题和网址。
4. React 界面展示整理后的收藏夹列表和网址数量。
5. 用户点击复制按钮后，`lib/clipboard.ts` 将全部网址组合成每行一个的纯文本，并写入剪贴板。

插件没有后台服务，不要求登录，也不会向馆长或第三方服务器发送收藏夹数据。

## 权限与隐私边界

插件只申请 `bookmarks` 权限，用于读取收藏夹标题、目录和网址。

- 不创建、修改或删除收藏夹
- 不申请网页访问、脚本注入或浏览历史权限
- 不收集、保存或上传收藏夹数据
- 不包含广告、分析或跟踪代码
- 不从远程服务器加载可执行代码

官网链接只在用户主动点击时打开公开网页。

## 开发与验证

```bash
npm install
npm run dev
```

Chrome 打开 `chrome://extensions`，启用开发者模式，加载 `.output/chrome-mv3`。

Edge 开发模式使用：

```bash
npm run dev:edge
```

然后在 `edge://extensions` 加载 `.output/edge-mv3`。

提交代码前运行：

```bash
npm run check
```

该命令依次执行 TypeScript 类型检查、单元测试，以及 Chrome 和 Edge 构建。
