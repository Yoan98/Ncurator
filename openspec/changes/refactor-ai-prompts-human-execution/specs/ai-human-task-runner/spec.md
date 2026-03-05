## MODIFIED Requirements

### Requirement: Execute single-task human graph with brain-driven loop
系统 MUST 为每个 plan 任务启动独立 human 运行实例，并在该实例内以 `brain -> tool_exec -> brain` 的步骤循环推进；human 最小输入契约 MUST 为 `taskId` 与 `objective`，不得依赖 `mode` 字段。

#### Scenario: One task one human run
- **WHEN** main graph 派发一个待执行任务到 human
- **THEN** runtime MUST 为该任务创建独立 human 运行上下文，并以 `taskId/objective` 作为输入开始步骤循环，最终以 `status/summary/resultCode/resultData` 返回任务结果

#### Scenario: Recoverable failure continues exploration
- **WHEN** human 步骤中的普通工具调用返回可恢复失败（如 `failed` 或 `invalid_input`）
- **THEN** runtime MUST 回到 brain 进入下一步探索，而不是立即以阻塞终态结束任务

#### Scenario: Task isolation across plan items
- **WHEN** plan 中存在多个任务
- **THEN** 每个任务在独立 human 实例中执行且不共享隐式运行态

### Requirement: Enforce canonical step actions
brain 每一步输出 MUST 仅允许 `invoke_tool`、`complete_task`、`block_task` 三类动作之一，且动作载荷 MUST 满足结构化 schema 校验；`complete_task` MUST 基于已满足目标的证据，`block_task` MUST 提供明确阻塞原因。

#### Scenario: Invoke tool action
- **WHEN** brain 判断需要执行外部能力
- **THEN** 输出 MUST 为 `invoke_tool`，并包含工具名与参数

#### Scenario: Complete task with objective evidence
- **WHEN** brain 判定任务目标已完成
- **THEN** 输出 MUST 为 `complete_task`，并在摘要中包含完成结论与关键证据

#### Scenario: Block task on unrecoverable condition
- **WHEN** brain 判断任务在当前约束下不可继续（例如 workspace/approval 门禁导致不可推进）
- **THEN** 输出 MUST 为 `block_task`，并返回阻塞原因与可定位信息
