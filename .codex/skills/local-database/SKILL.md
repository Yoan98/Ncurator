---
name: Local-Database
description: 当任务涉及 LanceDB、FTS、StorageService、LanceDbCore、DocumentsStore、WorkspaceStore、WebSourceStore、ChatStore、DraftReviewStore、表结构、索引、迁移或数据库文档同步时必须使用；先读 doc/architecture/database.md
---

必须先阅读 `doc/architecture/database.md`。

再按任务需要继续阅读：

- `references/source-of-truth.md`
  - 数据库文档不足时的代码真相源与核对顺序
- `references/change-checklist.md`
  - 调整表、索引、store 或 canonical 文档时的同步项

工作流约束：

- 优先遵守数据库文档中的分层与建表规则
- 若文档未覆盖当前实现，以 storage 代码为最终真相源
- 若本次变更修复了文档缺项，应在同一 change set 同步更新数据库文档

当任务涉及数据库文档迁移、默认阅读入口变化或文档/skill 路由调整时，必须同时加载 `Doc-Governance`。
