# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

- 默认入口：`doc/README.md`
- 当涉及技术栈、整体架构、进程边界、本地优先约束或混合检索链路时，请阅读 `doc/architecture.md`
- 当涉及 AI 设计、Main/Human 工作流、context/plan 机制、LangGraph 节点流转或草稿审阅运行过程时，请阅读 `doc/ai-design.md`
- 当涉及数据库、LanceDB、表职责、存储分层或检索存储实现时，请阅读 `doc/database.md`
- 当涉及目录规范、文件归位、模块边界或工程结构时，请阅读 `doc/project-structure.md`
- 当涉及 UI 风格、布局规范或组件交互约束时，请阅读 `doc/ui-style.md`
- 当涉及测试相关内容时，请阅读 `doc/test.md`；其中约定了测试目录、基于 `meta.json`/`timeline.jsonl`/`artifacts.json` 的 raw log 契约、单 domain report 规则、report 示例与 Codex 后置分析流程
## 2. 注意事项

- 禁止使用 `any` 与 `unknown`
- 跨进程共享类型统一放在 `src/shared/types.ts` 或 `src/shared/types/*`
- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法
- 全局状态提示应统一放在 `App.tsx` 或 `MainLayout` 级别处理
- 文档入口或文档变更时，需同步更新 `doc/README.md` 与 `AGENTS.md`
