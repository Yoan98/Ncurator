# NCurator-Desktop AI 事件与契约

## 1. 事件族

- 运行级：`run_started / run_completed / run_failed / run_cancelled`
- 计划级：`plan_created / task_started / task_completed / task_failed / task_result`
- 交付级：`task_delivery_ready`
- 步骤级：`tool_call_started / tool_call_result / human_step / human_diagnostic`
- 审批级：`workspace_required / approval_required / approval_decision`
- 来源级：`local_sources_status / non_local_permission_requested / runtime_issue`
- 答复级：`answer_token / answer_completed`

## 2. 当前关键约束

- `answer_token / answer_completed` 由 `human_response` 发出
- direct human 与 synthesis human 可以发最终答复流
- plan 中间业务任务不得把 handoff 当作最终答复流发出
- `task_delivery_ready` 是任务正式交付的真相源事件
- `human_diagnostic` 只用于内部调试，不直接展示给用户

## 3. 事件顺序语义

### direct human

```text
run_started
-> task_started(direct-human)
-> human_step / tool events ...
-> answer_token*
-> answer_completed
-> task_delivery_ready
-> task_completed / task_result
-> run_completed
```

### plan + synthesis

```text
run_started
-> plan_created
-> task_started(task-1)
-> human_step / tool events ...
-> task_delivery_ready(task-1)
-> task_completed / task_result
-> ...
-> task_started(synthesis-human)
-> answer_token*
-> answer_completed
-> task_delivery_ready(synthesis-human)
-> task_completed / task_result
-> run_completed
```

## 4. `task_delivery_ready`

用途：

- UI 时间线展示任务交付
- 检查器查看完整 handoff markdown
- 测试与报告回放交付内容
- synthesis human 汇总时消费 plan 任务交付

负载最小字段：

- `runId`
- `taskId`
- `summary`
- `deliveryMarkdown`
- `createdAt`

约束：

- 中间任务也必须发
- 阻塞任务也必须发
- context human 可以发 `internal=true` 的交付事件

## 5. 最终答复流

最终答复流不再来自 IPC 对整段文本的后置切片。
当前要求是：

- 真实 token 流来自 `human_response`
- `answer_completed.text` 必须等于最终交付 markdown
- `answer_completed.taskId` 用于标记 `direct-human` 或 `synthesis-human`

## 6. 本地资料状态

- `local_sources_status`
  - 表示本轮最终交付对应的本地资料使用状态
- `non_local_permission_requested`
  - 仅当最终交付明确说明本地资料不足时发出

当前状态值：

- `used`
- `not_used`
- `insufficient`

## 7. 运行事件与审阅边界

- AI runtime 负责计划、步骤、审批、交付与最终答复
- 草稿审阅通过独立 draft review 存储与 IPC 契约承载
- `draft_review_ready` 仍然只能在 run 完成后发出

## 8. 范围与来源语义

- `selectedDocumentIds`
  - 已准备文档的严格检索范围
- `selectedSourceScopes`
  - 用户显式选择的工作空间、目录、文件或网页资料范围
- `selectedScopeSummary`
  - 给 prompt 的可读范围摘要
- `allowNonLocal`
  - 用户是否允许在本地不足时使用非本地信息

## 9. 跨进程真相源

- IPC / 共享实体：`src/shared/types.ts`
- AI 运行态：`src/main/services/ai/types.ts`
- 渲染投影：`src/renderer/src/utils/workbenchProjection.ts`
