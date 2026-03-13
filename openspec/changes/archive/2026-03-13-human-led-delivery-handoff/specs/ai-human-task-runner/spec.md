## MODIFIED Requirements

### Requirement: Execute single-task human graph with brain-driven loop
系统 MUST 为每个被派发的任务启动独立 human 运行实例，并在该实例内以 `brain -> (skill_loader | tool_exec) -> brain` 的步骤循环推进；human 最小任务输入契约对模型仍 MUST 以 `objective` 为中心，对 runtime 输出则 MUST 收敛为 `status/summary/resultCode/deliveryMarkdown`，并允许保留辅助 `resultData`。

#### Scenario: One task one human run
- **WHEN** main graph 派发一个待执行任务到 human
- **THEN** runtime MUST 为该任务创建独立 human 运行上下文，并以 `taskId/objective` 作为最小运行输入开始步骤循环，最终返回包含 `deliveryMarkdown` 的任务结果

#### Scenario: Synthesis human is still a normal human run
- **WHEN** main 在计划执行结束后追加一个 synthesis human
- **THEN** runtime MUST 仍然以独立 human 运行实例执行该任务，而不是回退到 main 内部生成最终答复

#### Scenario: Task isolation across dispatched runs
- **WHEN** 运行中存在多个业务任务或一个业务任务加一个 synthesis 任务
- **THEN** 每个任务 MUST 在独立 human 实例中执行，且不共享隐式运行态

### Requirement: Enforce canonical step actions
brain 每一步输出 MUST 仅允许 `load_skill`、`invoke_tool`、`complete_task`、`block_task` 四类动作之一，且动作载荷 MUST 满足结构化 schema 校验；其中 `complete_task` 与 `block_task` MUST 触发任务交付生成，而不是由 brain 直接产出最终用户答复文本。

#### Scenario: Load skill action
- **WHEN** brain 判断当前缺少能力包
- **THEN** 输出 MUST 为 `load_skill`，并包含 `skillId`、`rationale` 与 `publicNarrative`

#### Scenario: Invoke tool action
- **WHEN** brain 判断需要执行外部能力
- **THEN** 输出 MUST 为 `invoke_tool`，并包含工具名、参数、`rationale` 与 `publicNarrative`

#### Scenario: Complete task enters delivery generation
- **WHEN** brain 判定任务目标已完成
- **THEN** 输出 MUST 为 `complete_task`，且 runtime MUST 在 terminal 决策后进入 delivery 生成阶段，而不是直接用 brain 的短摘要作为最终交付

#### Scenario: Block task enters delivery generation
- **WHEN** brain 判断任务在当前约束下不可继续
- **THEN** 输出 MUST 为 `block_task`，且 runtime MUST 继续生成正式交付，说明阻塞原因与可继续路径

## ADDED Requirements

### Requirement: Human MUST generate formal delivery through response node
每个 human 任务在进入终态后 MUST 通过独立的 response node 生成正式交付；该节点 MUST 基于 objective、step history、observation 与工具证据输出 `summary` 与 `deliveryMarkdown`。

#### Scenario: Completed task generates handoff delivery
- **WHEN** human 任务以完成终态结束
- **THEN** response node MUST 生成可供 UI、测试与后续任务消费的正式交付文档

#### Scenario: Blocked task generates explanatory delivery
- **WHEN** human 任务以阻塞终态结束
- **THEN** response node MUST 生成明确说明已完成项、阻塞点与建议后续步骤的交付文档

### Requirement: Human prompt contract MUST stay objective-centered
系统 MUST 通过编译后的 objective 表达 direct human、普通计划任务与 synthesis human 的任务语义；runtime MUST NOT 要求 human 在模型可见输入中依赖显式的 `taskRole`、`mode` 或等价固定模式字段。

#### Scenario: Direct human receives objective-centered instruction
- **WHEN** main 选择 direct human 路径
- **THEN** runtime MUST 通过 objective 明确“完成用户请求并直接输出最终答复”，而不是额外暴露固定模式字段

#### Scenario: Synthesis human receives objective-centered instruction
- **WHEN** main 追加 synthesis human
- **THEN** runtime MUST 通过 objective 明确“基于全部子任务交付总结最终答复”，而不是要求 human 消费结构化模式参数
