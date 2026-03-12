---
name: Doc-Governance
description: 当任务涉及文档目录、canonical 文档、阅读路径、文档迁移、归档/废弃、AGENTS/skills/doc 同步时必须使用；先读 doc/reference/source-of-truth.md
---

必须先阅读：

- `doc/reference/source-of-truth.md`
- `doc/reference/change-checklist.md`

再按任务需要决定是否联动其他领域 skill：

- AI 文档：加载 `AI-Architecture`
- 数据库文档：加载 `Local-Database`
- 目录与模块边界：加载 `Directory-Structure`
- 测试文档：加载 `Testing`
- UI 规范文档：加载 `UI-Style`

本 skill 只负责：

- 决定文档属于哪一层
- 决定哪个文档是 canonical source
- 决定默认阅读入口
- 确保 `doc`、skill 与 `AGENTS.md` 同步

不要在这里重复抄写领域细节；领域规则继续留在各自文档与领域 skill 中。
