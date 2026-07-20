# 脚本目录

脚本按用途分组，不再兼容旧路径。

- `build/native/`：准备 Electron 和 Node 使用的原生模块。
- `build/package/`：生成暂存包、混淆 main、审计暂存包和最终安装包。
- `build/runtime/`：检查 bundle 边界、递归追踪运行时依赖、验证暂存依赖。
- `build/sidecar/`：构建和检查网页爬虫 sidecar。
- `release/`：本地发布入口。
- `release/r2/`：R2 上传、元数据和发布收尾。
- `release/shared/`：发布流程共享能力。
- `test/`：测试工作流和真实更新测试。
- `postinstall.mjs`：安装完成后的唯一根级入口。

## 打包主流程

`pnpm run build` 最后调用 `build/package/prepare-stage.mjs`。该脚本固定按以下顺序执行：

1. 用 `@vercel/nft` 递归追踪 main 和 preload 的文件依赖。
2. 按追踪结果生成最小生产依赖并安装到 `release-stage/app`。
3. 使用暂存目录中的真实 `DocxLoader` 和 `PDFLoader` 读取测试文件。
4. 混淆 `out/main` 并验证输出哈希和受保护明文。
5. 执行暂存包内容审计。

追踪规则在 `build/runtime-trace-policy.json`。新增显式包含项时必须同时写清原因和对应测试；未知追踪告警会直接中止构建。

最终安装包由 `build/package/audit-app.mjs` 再次检查。它会核对追踪到的包和关键文件是否真的进入 `app.asar`。
