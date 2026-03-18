# NCurator-Desktop（AI 项目规则）

## 1. 文档引用

- 默认入口：`doc/README.md`
- 当涉及技术栈、整体架构、进程边界、本地优先约束或混合检索链路时，请阅读 `doc/architecture.md`
- 当涉及 AI 设计、Main/Human 工作流、context/plan 机制、LangGraph 节点流转或草稿审阅运行过程时，请阅读 `doc/ai-design.md`
- 当涉及 AI workbench 测试方案、阶段划分、阶段目标、阶段用例、模型使用或 backend / e2e 测试边界时，请先阅读 `doc/ai-workbench-test/plan.md`；
- 当涉及 AI workbench 当前阶段推进、完成度、证据或下一阶段准入时，请同步阅读对应阶段的 todo 文档；当前至少包括 `doc/ai-workbench-test/todo-stage-1.md` 与 `doc/ai-workbench-test/todo-stage-2.md`，其中 Stage 2 关注 `backend/human` 的 review-handoff、safe-stop、no-redundant 与 refinement / long-task 落点
- 当涉及数据库、LanceDB、表职责、存储分层或检索存储实现时，请阅读 `doc/database.md`
- 当涉及目录规范、文件归位、模块边界或工程结构时，请阅读 `doc/project-structure.md`
- 当涉及 UI 风格、布局规范或组件交互约束时，请阅读 `doc/ui-style.md`
- 当涉及测试相关内容，包括测试目录、raw log、report 规则或历史总数据 / 最新总数据口径时，请阅读 `doc/test.md`；
## 2. 注意事项

- 禁止使用 `any` 与 `unknown`
- 跨进程共享类型统一放在 `src/shared/types.ts` 或 `src/shared/types/*`
- 禁止使用 `Modal.confirm`、`Modal.info` 等静态方法
- 文档入口或文档变更时，需同步更新 `doc/README.md` 与 `AGENTS.md`
- 编写文档引用相关时，只需要描述什么时候需要读该文档就足够，不要添加很多细节
