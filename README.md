# 馆长: AI助手

[English](./README.en.md) · [官方网站](https://www.ncurator.com/zh)

Ncurator 桌面端的轻量浏览器配套工具。它读取并展示浏览器收藏夹，支持一键复制全部网址，每行一个。

## 隐私

收藏夹数据只在浏览器本地处理。插件不会修改、保存或上传收藏夹，也不包含分析和跟踪代码。

## 开发

```bash
npm install
npm run dev
```

Chrome 开发模式加载 `.output/chrome-mv3`。Edge 开发模式使用 `npm run dev:edge`，加载 `.output/edge-mv3`。

## 验证与构建

```bash
npm run typecheck
npm test
npm run build
npm run build:edge
npm run zip
npm run zip:edge
```

商店文案和发布检查表位于 [`docs`](./docs)，宣传资源位于 [`store-assets`](./store-assets)。
