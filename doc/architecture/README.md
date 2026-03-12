# NCurator-Desktop 架构文档入口

本目录负责系统当前架构真相源，不存放历史变更过程。

## 1. 阅读顺序

1. [system-overview.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/system-overview.md)
2. 按任务进入以下领域：
   - [project-structure.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/project-structure.md)
   - [database.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/database.md)
   - [ai/README.md](/Users/test/work-space/NCurator-Desktop/doc/architecture/ai/README.md)

## 2. 目录职责

- `system-overview.md`
  - 统一描述 Main、Renderer、Shared、Storage 与 AI runtime 的整体边界。
- `project-structure.md`
  - 目录放置规则、模块边界、文件归位。
- `database.md`
  - LanceDB、storage layering、表结构与代码真相源。
- `ai/`
  - AI runtime、事件契约、扩展方式与升级流程。

## 3. 维护规则

- 当前架构变化先改这里，再考虑是否需要同步 `openspec`。
- 不把临时计划、风险追踪或历史回顾混入本目录；这类内容留在 `openspec` 或测试 journal。
