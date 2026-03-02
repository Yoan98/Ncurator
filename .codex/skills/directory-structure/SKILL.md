---
name: Directory-Structure
description: 当任务涉及目录规范、文件归位、目录重构或模块分层时，必须先阅读并遵守 doc/project-structure.md
---

必须先阅读 `doc/project-structure.md`。

适用场景：

- 新增目录或重构目录结构
- 文件在 `main/services/utils/shared/renderer` 之间迁移
- 判断“文件应该放哪里”
- 批量整理 import 路径与模块归属

执行规则：

1. 先判断目录职责，再迁移或新建。
2. Main 通用公共工具放在 `src/main/utils/**`。
3. AI 业务语义事件封装放在 `src/main/services/ai/events/**`。
4. 迁移后必须清理旧引用并执行 `typecheck`。
