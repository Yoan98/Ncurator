# NCurator-Desktop AI 架构入口

本目录是当前 AI runtime 的默认真相源。历史设计、已废弃机制和旧路径说明留在 `openspec/`，不作为默认入口。

## 1. 什么时候读这里

- 修改 LangGraph / AI runtime
- 调整 Main Graph / Human Subgraph
- 修改 tool registry、skill cards、prompt registry 或事件流
- 调整 workspace / approval / draft review 相关边界
- 规划 AI 架构升级、重构或迁移

## 2. 阅读顺序

1. [runtime.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/runtime.md)
2. [event-contracts.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/event-contracts.md)
3. [extension-playbook.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/extension-playbook.md)
4. [upgrade-playbook.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/upgrade-playbook.md)
5. [glossary.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/glossary.md)

## 3. 文档分工

- `runtime.md`
  - 当前运行边界、状态机、状态字段与代码落点
- `event-contracts.md`
  - 事件族、审批语义、草稿审阅语义与运行/审阅边界
- `extension-playbook.md`
  - 新增 tool、prompt、state、skill card、测试时该改什么
- `upgrade-playbook.md`
  - AI 架构升级时必须同步的文档、skills、AGENTS、测试和 specs
- `glossary.md`
  - 统一术语，避免不同文档对同一概念使用不同名字

## 4. 代码真相源

文档不足或与实现冲突时，按以下顺序核对：

1. `src/main/services/ai/graph/*`
2. `src/main/services/ai/node/*`
3. `src/main/services/ai/state/stateSchemas.ts`
4. `src/main/services/ai/tools/*`
5. `src/shared/types.ts`
