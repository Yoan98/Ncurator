---
name: AI-Architecture
description: 当任务涉及 AI 架构、LangGraph、Main/Human graph、human-led delivery、markdown handoff、tool registry、事件流、workspace/approval、draft review、AI 架构升级或相关文档同步时必须使用；先读 doc/architecture/ai/README.md
---

必须先阅读 `doc/architecture/ai/README.md`。

再按任务需要继续阅读：

- `doc/architecture/ai/runtime.md`
  - 当前运行边界、human-led delivery、main/human/synthesis 流程与代码落点
- `doc/architecture/ai/event-contracts.md`
  - 事件族、task delivery、最终答复流、审批语义与共享契约
- `doc/architecture/ai/extension-playbook.md`
  - 新增 tool / capability / prompt / delivery / state / 测试时的扩展步骤
- `doc/architecture/ai/upgrade-playbook.md`
  - 架构升级时必须同步的文档、skills、AGENTS 与测试
- `references/source-of-truth.md`
  - 文档不足时的代码真相源与核对顺序
- `references/change-checklist.md`
  - 修改 AI 入口、事件或运行边界时的同步检查项

当任务涉及新增、重命名或迁移 AI canonical 文档，或修改 AI 默认阅读入口与技能触发描述时，必须同时加载 `Doc-Governance`。
