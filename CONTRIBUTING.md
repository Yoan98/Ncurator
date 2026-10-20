# 贡献指南

**简体中文** · [English](./CONTRIBUTING.en.md)

## 讨论与反馈

欢迎通过 [Issues](https://github.com/Yoan98/Ncurator/issues) 报告问题、提出需求。社区与联系入口统一见 [README](./README.md#参与项目)。

报告问题时说明应用版本、操作系统、模型服务商、复现步骤、预期与实际结果。截图和日志请移除 API Key、个人资料及其他敏感内容。较大的功能或架构改动，建议先开 Issue 对齐范围。

## 开发与验证

开发环境与启动步骤见[中文 README](./README.md#从源码运行)。项目协作规则见 [AGENTS.md](./AGENTS.md)，文档修改遵循[文档准则](./doc/doc-guidelines.md)。

使用 Node.js 22、pnpm 9.12.2、Python 3.12；原生模块需要本地编译时，安装 macOS Command Line Tools 或 Windows C++ Build Tools。首次启动会准备原生模块，并按需构建网页抓取 sidecar，需要联网。只开发桌面界面时可先使用 `pnpm dev:no-sidecar`。

| 命令                             | 用途                                                 |
| -------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                       | 启动桌面开发环境，按需准备原生模块和网页抓取 sidecar |
| `pnpm dev:no-sidecar`            | 暂不准备网页抓取 sidecar 的桌面开发入口              |
| `pnpm typecheck`                 | Main 与 Renderer 类型检查                            |
| `pnpm lint`                      | ESLint 检查                                          |
| `pnpm test:unit --suite <suite>` | 执行受影响的 Unit suite                              |
| `pnpm test:ai:non-live`          | AI 非 live backend 回归                              |
| `pnpm build:unpack`              | 构建并审计本机解包应用                               |
| `pnpm build:win`                 | 在 Windows 构建 Windows x64 安装包                   |
| `pnpm build:mac:arm64`           | 在 Apple Silicon Mac 构建 macOS arm64 安装包         |

根据改动执行对应检查，PR 中记录实际运行的命令和结果。测试分层、过滤参数和真实 E2E 规则见[测试文档](./doc/test.md)。新增测试文件前先与维护者确认分类；调整产品行为时同步相关 PRD 和测试计划。需要 live 模型的用例由贡献者在本机配置自己的凭证。

`.env-example` 只放变量名和非敏感示例。生产共享密钥、模型 Key、签名证书、用户数据库及测试日志均不应提交。普通开发不需要 COS / R2 上传权限或官方服务密钥；官方发布流程见[发布文档](./doc/deploy/release.md)。

## 提交 Pull Request

1. Fork 仓库，从主分支创建自己的工作分支。
2. 保持改动围绕一个问题，补充必要文档和验证。
3. 说明解决的问题、最终行为、验证结果及已知限制；界面变化附截图。
4. 使用 `git commit --signoff` 提交，在提交信息中加入 `Signed-off-by` 确认。

依赖升级、第三方代码和图片等素材须注明来源及许可证。

## 贡献许可

请先阅读项目的 [AGPL-3.0-only 许可证](./LICENSE)。提交贡献时，你确认有权提供相关内容，并同意贡献按该许可证提供；贡献者保留相应版权。通过 commit signoff 留下上述确认。

工作成果涉及雇主或其他权利人时，应先获得所需许可。第三方材料继续遵守原许可证。
