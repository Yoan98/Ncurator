# 馆长: AI助手

[English](./README.en.md) · [官方网站](https://www.ncurator.com/zh) · [隐私政策](https://www.ncurator.com/zh/privacy/browser-extension)

馆长是你的 AI 工作伙伴。你安排任务，让馆长帮你查资料、使用本地知识库、整理信息和编写文档。

完整能力已升级至 macOS 和 Windows 桌面端。

## 浏览器插件

浏览器插件提供一个简单、专注的收藏夹工具：

- 查看收藏夹标题、目录和网址
- 一键复制全部收藏网址，每行一个
- 支持多层收藏夹目录
- 保持浏览器中的原始排列顺序
- 所有收藏夹数据只在浏览器本地处理

插件只申请 `bookmarks` 权限，不会创建、修改或删除收藏夹，也不包含广告、分析或跟踪代码。

## 本地开发

```bash
npm install
npm run dev
```

在 Chrome 扩展程序页面加载 `.output/chrome-mv3`。Edge 使用 `npm run dev:edge`，加载 `.output/edge-mv3`。

## 验证与构建

```bash
npm run check
npm run zip:stores
```

更多资料：

- [插件架构](./docs/architecture.md)
- [商店发布](./docs/release.md)

宣传图片及其可编辑源文件位于 [`store-assets`](./store-assets)。商店发布凭据保存在本地 `.env`，不会提交到 Git。
