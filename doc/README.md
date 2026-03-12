# NCurator-Desktop 工程文档入口

`doc/` 是本项目默认的工程入口，面向人类开发者与 AI 共同使用。

阅读原则：

- 先从本文件确认阅读顺序，再进入具体领域文档。
- `doc/` 承担当前真相源。
- `openspec/` 承担变更设计、规格和历史沉淀，不是默认入口。
- 当文档与当前实现不一致时，按该领域定义的代码真相源处理，并把文档同步纳入当前变更。

## 1. 阅读顺序

1. [architecture/README.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/README.md)
2. [reference/source-of-truth.md](/Users/test/work-space/NCurator-Desktop/doc/reference/source-of-truth.md)
3. 按任务进入对应领域文档

## 2. 按任务阅读

- AI 架构、LangGraph、事件流、tool/capability、审批和草稿审阅：
  - [architecture/ai/README.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/README.md)
- 数据库、存储层、LanceDB、索引、迁移、草稿审阅存储：
  - [architecture/database.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/database.md)
- 目录规范、模块边界、Main/Renderer/Shared 分层：
  - [architecture/project-structure.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/project-structure.md)
- 系统概览与主要数据流：
  - [architecture/system-overview.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/system-overview.md)
- UI 样式与交互风格：
  - [conventions/ui-style.md](/Users/test/work-space/NCurator-Desktop/doc/conventions/ui-style.md)
- 类型治理、跨层归属和边界解码：
  - [conventions/type-governance.md](/Users/test/work-space/NCurator-Desktop/doc/conventions/type-governance.md)
- 测试架构、阶段计划和测试汇总：
  - [testing/README.md](/Users/test/work-space/NCurator-Desktop/doc/testing/README.md)
- 文档治理、canonical source 和变更同步：
  - [reference/source-of-truth.md](/Users/test/work-space/NCurator-Desktop/doc/reference/source-of-truth.md)
  - [reference/change-checklist.md](/Users/test/work-space/NCurator-Desktop/doc/reference/change-checklist.md)

## 3. 维护约束

- 修改 canonical 文档时，必须同步检查相关 skill 与 [AGENTS.md](/Users/test/work-space/NCurator-Desktop/AGENTS.md)。
- 新增文档前，先决定它属于 `architecture / conventions / testing / reference` 中哪一层。
- 不把历史设计或临时讨论稿直接放进 `doc/` 根目录。
