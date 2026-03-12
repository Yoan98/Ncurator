# NCurator-Desktop AI 事件与契约

## 1. 事件族

- 运行级：`run_started / run_completed / run_failed / run_cancelled`
- 计划级：`plan_created / task_started / task_completed / task_failed / task_result`
- 步骤级：`tool_call_started / tool_call_result / human_step / human_diagnostic`
- 审批级：`workspace_required / approval_required / approval_decision`
- 来源级：`local_sources_status / non_local_permission_requested / runtime_issue`
- 答复级：`answer_token / answer_completed`

## 2. 关键约束

- `human_step` 面向 UI 和用户阅读，必须包含 `publicNarrative`
- `human_diagnostic` 只用于内部调试，不直接暴露给用户
- `answer_token / answer_completed` 只在 `finalize` 后流出
- 已移除的旧机制不再作为当前契约一部分，历史说明只留在 `openspec`

## 3. 运行事件与审阅契约边界

- AI 运行阶段负责 plan、steps、approval、artifact 和最终答复
- 草稿审阅与最终提交通过独立的 draft review 存储和 IPC 契约承载
- `draft_review_ready` 只能在整次运行完成后发出，不能作为运行中的逐块确认断点

## 4. 范围与来源语义

- `selectedDocumentIds`
  - 已准备文档的严格检索范围
- `selectedSourceScopes`
  - 用户显式选择的工作空间、目录、文件或网页资料范围
- `selectedScopeSummary`
  - 供 prompt 使用的可读范围摘要
- `allowNonLocal`
  - 用户是否允许在本地不足时使用非本地信息

## 5. 纯搜索模式

- `纯搜索` 不进入 main / human graph
- 纯搜索复用本地检索能力
- Renderer 通过投影层把纯搜索结果映射为统一时间线与检查器模型

## 6. 跨进程真相源

- IPC / 共享实体：`src/shared/types.ts`
- AI 运行态：`src/main/services/ai/types.ts`
- 草稿审阅存储：`src/main/services/storage/domains/DraftReviewStore.ts`
